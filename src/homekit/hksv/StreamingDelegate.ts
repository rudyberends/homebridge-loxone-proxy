import { LoxonePlatform } from '../../LoxonePlatform';
import {
  AudioStreamingCodecType,
  AudioStreamingSamplerate,
  CameraController,
  CameraControllerOptions,
  CameraRecordingOptions,
  CameraStreamingDelegate,
  CameraStreamingOptions,
  EventTriggerOption,
  HAP,
  H264Level,
  H264Profile,
  MediaContainerType,
  PrepareStreamCallback,
  PrepareStreamRequest,
  Resolution,
  SnapshotRequest,
  SnapshotRequestCallback,
  SRTPCryptoSuites,
  StreamingRequest,
  StreamRequestCallback,
  PrepareStreamResponse,
  StartStreamRequest,
  CameraRecordingDelegate,
} from 'homebridge';

import {
  defaultFfmpegPath,
  reservePorts,
} from '@homebridge/camera-utils';

import { spawn } from 'child_process';
import { createSocket, Socket } from 'dgram';
import { FfmpegStreamingProcess, StreamingDelegate as FfmpegStreamingDelegate } from './FfmpegStreamingProcess';
import { RecordingDelegate } from './RecordingDelegate';

  interface SessionInfo {
      address: string; // address of the HAP controller
      addressVersion: 'ipv4' | 'ipv6';

      videoPort: number;
      videoIncomingPort: number;
      videoCryptoSuite: SRTPCryptoSuites; // should be saved if multiple suites are supported
      videoSRTP: Buffer; // key and salt concatenated
      videoSSRC: number; // rtp synchronisation source

      audioPort: number;
      audioIncomingPort: number;
      audioCryptoSuite: SRTPCryptoSuites;
      audioSRTP: Buffer;
      audioSSRC: number;
  }

  type ActiveSession = {
      mainProcess?: FfmpegStreamingProcess;
      returnProcess?: FfmpegStreamingProcess;
      timeout?: NodeJS.Timeout;
      socket?: Socket;
  };

export class streamingDelegate implements CameraStreamingDelegate, FfmpegStreamingDelegate {
  public readonly controller: CameraController;
  public readonly recordingDelegate: CameraRecordingDelegate;
  private readonly streamUrl;
  private readonly ip;
  private readonly base64auth;

  private pendingSessions: { [index: string]: SessionInfo } = {};
  private ongoingSessions: { [index: string]: ActiveSession } = {};

  private cachedSnapshot: Buffer | null = null;
  private cachedAt = 0;
  private readonly cacheTtlMs = 5000;

  //private readonly camera;
  private readonly hap: HAP;
  constructor(
      private readonly platform: LoxonePlatform,
      streamUrl: string,
      base64auth: string,
  ) {
    //this.camera = camera;
    this.hap = this.platform.api.hap;
    this.streamUrl = streamUrl;
    this.base64auth = base64auth;

    // Extract the IP address using a regular expression
    const ipAddressRegex = /http:\/\/([\d.]+)/;
    const match = streamUrl.match(ipAddressRegex);
    if (match && match[1]) {
      this.ip = match[1];
    }

    this.recordingDelegate = new RecordingDelegate(this.platform, this.streamUrl, this.base64auth);

    const resolutions: Resolution[] = [
      [320, 180, 30],
      [320, 240, 15],   // Apple Watch requires this configuration (Apple Watch also seems to required OPUS @16K)
      [320, 240, 30],
      [480, 270, 30],
      [480, 360, 30],
      [640, 360, 30],
      [640, 480, 30],
      [1024, 768, 30],
      [1280, 720, 30],
    ];

    const streamingOptions: CameraStreamingOptions = {
      supportedCryptoSuites: [SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
      video: {
        codec: {
          profiles: [H264Profile.BASELINE, H264Profile.MAIN, H264Profile.HIGH],
          levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
        },
        resolutions: resolutions,
      },
      audio: {
        twoWayAudio: false,
        codecs: [
          {
            type: AudioStreamingCodecType.AAC_ELD,
            samplerate: AudioStreamingSamplerate.KHZ_16,
          },
        ],
      },
    };

    const recordingOptions: CameraRecordingOptions = {
      overrideEventTriggerOptions: [
        EventTriggerOption.MOTION,
        EventTriggerOption.DOORBELL,
      ],
      prebufferLength: 4 * 1000, // prebufferLength always remains 4s ?
      mediaContainerConfiguration: [
        {
          type: MediaContainerType.FRAGMENTED_MP4,
          fragmentLength: 4000,
        },
      ],
      video: {
        parameters: {
          profiles: [
            H264Profile.BASELINE,
            H264Profile.MAIN,
            H264Profile.HIGH,
          ],
          levels: [
            H264Level.LEVEL3_1,
            H264Level.LEVEL3_2,
            H264Level.LEVEL4_0,
          ],
        },
        resolutions: resolutions,
        type: this.hap.VideoCodecType.H264,
      },
      audio: {
        codecs: [
          {
            samplerate: this.hap.AudioRecordingSamplerate.KHZ_32,
            type: this.hap.AudioRecordingCodecType.AAC_LC,
          },
        ],
      },
    };

    const options: CameraControllerOptions = {
      cameraStreamCount: 5,
      delegate: this,
      streamingOptions: streamingOptions,
      recording: {
        options: recordingOptions,
        delegate: this.recordingDelegate,
      },
    };

    this.controller = new this.hap.CameraController(options);
  }

  stopStream(sessionId: string): void {
    const session = this.ongoingSessions[sessionId];

    if (session) {
      if (session.timeout) {
        clearTimeout(session.timeout);
      }

      try {
        session.socket?.close();
      } catch (error) {
        this.platform.log.error(`Error occurred closing socket: ${error}`, this.ip, 'Homebridge');
      }

      try {
        session.mainProcess?.stop();
      } catch (error) {
        this.platform.log.error(
          `Error occurred terminating main FFmpeg process: ${error}`,
          this.ip,
          'Homebridge',
        );
      }

      try {
        session.returnProcess?.stop();
      } catch (error) {
        this.platform.log.error(
          `Error occurred terminating two-way FFmpeg process: ${error}`,
          this.ip,
          'Homebridge',
        );
      }

      delete this.ongoingSessions[sessionId];

      this.platform.log.info('Stopped video stream.', this.ip);
    }
  }

  forceStopStream(sessionId: string) {
    this.controller.forceStopStreamingSession(sessionId);
  }

  /** Public snapshot method with internal caching */
  public async getSnapshot(): Promise<Buffer | null> {
    const now = Date.now();

    if (this.cachedSnapshot && now - this.cachedAt < this.cacheTtlMs) {
      this.platform.log.debug(`[${this.ip}] Snapshot cache hit`);
      return this.cachedSnapshot;
    }

    return new Promise((resolve) => {
      this.handleSnapshotRequest({ width: 640, height: 360 }, (err, buffer) => {
        if (err || !buffer) {
          this.platform.log.warn(`[${this.ip}] Snapshot request failed`);
          return resolve(null);
        }

        this.cachedSnapshot = buffer;
        this.cachedAt = Date.now();
        resolve(buffer);
      });
    });
  }

  async handleSnapshotRequest(
    request: SnapshotRequest,
    callback: SnapshotRequestCallback,
  ) {
    this.platform.log.debug(`Snapshot requested: ${request.width} x ${request.height}`, this.ip);

    // Spawn an ffmpeg process to capture a snapshot from the camera
    const ffmpeg = spawn('ffmpeg', [
      '-re',
      '-headers', `Authorization: Basic ${this.base64auth}\r\n`,
      '-i', `${this.streamUrl}`,
      '-frames:v', '1',
      '-update', '1',                      // Ensures only one frame is written
      '-loglevel', 'info',
      '-f', 'image2',
      '-vcodec', 'mjpeg',                 // Explicit JPEG output
      '-',                                // Output to stdout
    ],
    { env: process.env });

    const snapshotBuffers: Buffer[] = [];

    // Collect the snapshot data from ffmpeg's stdout
    ffmpeg.stdout.on('data', data => snapshotBuffers.push(data));

    // Log ffmpeg's stderr for diagnostics
    ffmpeg.stderr.on('data', data => {
      this.platform.log.info('SNAPSHOT: ' + String(data));
    });

    // Handle process exit
    ffmpeg.on('exit', (code, signal) => {
      if (signal) {
        this.platform.log.debug('Snapshot process was killed with signal: ' + signal);
        callback(new Error('Snapshot process was killed with signal: ' + signal));
      } else if (code === 0) {
        this.platform.log.debug(`Successfully captured snapshot at ${request.width}x${request.height}`);
        callback(undefined, Buffer.concat(snapshotBuffers));
      } else {
        this.platform.log.error('Snapshot process exited with code ' + code, this.ip);
        callback(new Error('Snapshot process exited with code ' + code));
      }
    });

    // Handle unexpected errors
    ffmpeg.on('error', (error) => {
      this.platform.log.error('Error while capturing snapshot: ' + error.message, this.ip);
      callback(error);
    });
  }

  async prepareStream(
    request: PrepareStreamRequest,
    callback: PrepareStreamCallback,
  ) {
    const videoIncomingPort = await reservePorts({
      count: 1,
    });
    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();

    const audioIncomingPort = await reservePorts({
      count: 1,
    });
    const audioSSRC = this.hap.CameraController.generateSynchronisationSource();

    const sessionInfo: SessionInfo = {
      address: request.targetAddress,
      addressVersion: request.addressVersion,

      audioCryptoSuite: request.audio.srtpCryptoSuite,
      audioPort: request.audio.port,
      audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
      audioSSRC: audioSSRC,
      audioIncomingPort: audioIncomingPort[0],

      videoCryptoSuite: request.video.srtpCryptoSuite,
      videoPort: request.video.port,
      videoSRTP: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
      videoSSRC: videoSSRC,
      videoIncomingPort: videoIncomingPort[0],
    };

    const response: PrepareStreamResponse = {
      video: {
        port: sessionInfo.videoIncomingPort,
        ssrc: videoSSRC,
        srtp_key: request.video.srtp_key,
        srtp_salt: request.video.srtp_salt,
      },
      audio: {
        port: sessionInfo.audioIncomingPort,
        ssrc: audioSSRC,
        srtp_key: request.audio.srtp_key,
        srtp_salt: request.audio.srtp_salt,
      },
    };

    this.pendingSessions[request.sessionID] = sessionInfo;
    callback(undefined, response);
  }

  async handleStreamRequest(
    request: StreamingRequest,
    callback: StreamRequestCallback,
  ) {
    switch (request.type) {
      case this.hap.StreamRequestTypes.START: {
        this.platform.log.debug(
          `Start stream requested:
          ${request.video.width}x${request.video.height}, ${request.video.fps} fps, ${request.video.max_bit_rate} kbps`,
          this.ip,
        );

        await this.startStream(request, callback);
        break;
      }

      case this.hap.StreamRequestTypes.RECONFIGURE: {
        this.platform.log.debug(
          `Reconfigure stream requested:
          ${request.video.width}x${request.video.height}, ${request.video.fps} fps, ${request.video.max_bit_rate} kbps (Ignored)`,
          this.ip,
        );

        callback();
        break;
      }

      case this.hap.StreamRequestTypes.STOP: {
        this.platform.log.debug('Stop stream requested', this.ip);

        this.stopStream(request.sessionID);
        callback();
        break;
      }
    }
  }

  private async startStream(request: StartStreamRequest, callback: StreamRequestCallback) {
    const sessionInfo = this.pendingSessions[request.sessionID];

    if (!sessionInfo) {
      this.platform.log.error('Error finding session information.', this.ip);
      callback(new Error('Error finding session information'));
    }

    //const vcodec = 'libx264';
    const mtu = 1316; // request.video.mtu is not used

    //const fps = request.video.fps;
    //const videoBitrate = request.video.max_bit_rate;

    const ffmpegArgs: string[] = [
      '-headers', `Authorization: Basic ${this.base64auth}\r\n`,
      '-use_wallclock_as_timestamps', '1',
      '-probesize', '32',
      '-analyzeduration', '0',
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-max_delay', '0',
      '-re',
      '-i', `${this.streamUrl}`,
      '-an',
      '-sn',
      '-dn',
      '-codec:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-color_range', 'mpeg',
      '-r', '25',
      '-f', 'rawvideo',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-crf', '22',
      '-filter:v', 'scale=\'min(1280,iw)\':\'min(720,ih)\':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-b:v', '299k',
      '-payload_type', '99',
      '-ssrc', `${sessionInfo.videoSSRC}`,
      '-f', 'rtp',
      '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
      '-srtp_out_params', sessionInfo.videoSRTP.toString('base64'),
      `srtp://${sessionInfo.address}:${sessionInfo.videoPort}?rtcpport=${sessionInfo.videoPort}&pkt_size=${mtu}`,
    ];

    // Setting up audio
    /*
    if (
      request.audio.codec === AudioStreamingCodecType.OPUS ||
              request.audio.codec === AudioStreamingCodecType.AAC_ELD
    ) {
      ffmpegArgs.push('-vn', '-sn', '-dn');

      if (request.audio.codec === AudioStreamingCodecType.OPUS) {
        ffmpegArgs.push('-acodec', 'libopus', '-application', 'lowdelay');
      } else {
        ffmpegArgs.push('-acodec', 'libfdk_aac', '-profile:a', 'aac_eld');
      }

      ffmpegArgs.push(
        '-flags', '+global_header',
        '-f', 'null',
        '-ar', `${request.audio.sample_rate}k`,
        '-b:a', `${request.audio.max_bit_rate}k`,
        '-ac', `${request.audio.channel}`,
        '-payload_type', `${request.audio.pt}`,
        '-ssrc', `${sessionInfo.audioSSRC}`,
        '-f', 'rtp',
        '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
        '-srtp_out_params', sessionInfo.audioSRTP.toString('base64'),
        `srtp://${sessionInfo.address}:${sessionInfo.audioPort}?rtcpport=${sessionInfo.audioPort}&pkt_size=188`,
      );
    } else {
      this.platform.log.error(
        `Unsupported audio codec requested: ${request.audio.codec}`,
        this.ip,
        'Homebridge',
      );
    }*/

    ffmpegArgs.push('-progress', 'pipe:1');

    const activeSession: ActiveSession = {};

    activeSession.socket = createSocket(sessionInfo.addressVersion === 'ipv6' ? 'udp6' : 'udp4');

    activeSession.socket.on('error', (err: Error) => {
      this.platform.log.error('Socket error: ' + err.message, this.ip);
      this.stopStream(request.sessionID);
    });

    activeSession.socket.on('message', () => {
      if (activeSession.timeout) {
        clearTimeout(activeSession.timeout);
      }
      activeSession.timeout = setTimeout(() => {
        this.platform.log.info('Device appears to be inactive. Stopping stream.', this.ip);
        this.controller.forceStopStreamingSession(request.sessionID);
        this.stopStream(request.sessionID);
      }, request.video.rtcp_interval * 5 * 1000);
    });

    activeSession.socket.bind(sessionInfo.videoIncomingPort);

    activeSession.mainProcess = new FfmpegStreamingProcess(
      this.ip,
      request.sessionID,
      defaultFfmpegPath,
      ffmpegArgs,
      this.platform.log,
      true,
      this,
      callback,
    );

    this.ongoingSessions[request.sessionID] = activeSession;
    delete this.pendingSessions[request.sessionID];
  }
}