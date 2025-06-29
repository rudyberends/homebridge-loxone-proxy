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

interface SessionInfo {
  address: string;
  addressVersion: 'ipv4' | 'ipv6';
  videoPort: number;
  videoIncomingPort: number;
  videoCryptoSuite: SRTPCryptoSuites;
  videoSRTP: Buffer;
  videoSSRC: number;
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
  private readonly hap: HAP;
  private readonly streamUrl: string;
  private readonly ip: string;
  private readonly base64auth: string;

  private readonly recordingDelegate?: CameraRecordingDelegate;

  private readonly pendingSessions: { [sessionId: string]: SessionInfo } = {};
  private readonly ongoingSessions: { [sessionId: string]: ActiveSession } = {};

  private cachedSnapshot: Buffer | null = null;
  private cachedAt = 0;
  private readonly cacheTtlMs = 5000;

  constructor(
    private readonly platform: LoxonePlatform,
    streamUrl: string,
    base64auth: string,
    recordingDelegate: CameraRecordingDelegate | undefined,
    enableHKSV: boolean,
  ) {
    this.hap = platform.api.hap;
    this.streamUrl = streamUrl;
    this.base64auth = base64auth;
    this.recordingDelegate = recordingDelegate;

    const ipMatch = streamUrl.match(/http:\/\/([\d.]+)/);
    this.ip = ipMatch?.[1] ?? 'unknown';

    const resolutions: Resolution[] = [
      [320, 180, 30],
      [320, 240, 15],
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
        resolutions,
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

    const options: CameraControllerOptions = {
      cameraStreamCount: 5,
      delegate: this,
      streamingOptions,
    };

    if (enableHKSV && this.recordingDelegate) {
      const recordingOptions: CameraRecordingOptions = {
        overrideEventTriggerOptions: [
          EventTriggerOption.MOTION,
          EventTriggerOption.DOORBELL,
        ],
        prebufferLength: 4000,
        mediaContainerConfiguration: [
          {
            type: MediaContainerType.FRAGMENTED_MP4,
            fragmentLength: 4000,
          },
        ],
        video: {
          parameters: {
            profiles: [H264Profile.BASELINE, H264Profile.MAIN, H264Profile.HIGH],
            levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
          },
          resolutions,
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

      options.recording = {
        options: recordingOptions,
        delegate: this.recordingDelegate,
      };
    }

    this.controller = new this.hap.CameraController(options);
  }

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

  async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback) {
    this.platform.log.debug(`Snapshot requested: ${request.width} x ${request.height}`, this.ip);

    const ffmpeg = spawn('ffmpeg', [
      '-re',
      '-headers', `Authorization: Basic ${this.base64auth}\r\n`,
      '-i', this.streamUrl,
      '-frames:v', '1',
      '-update', '1',
      '-loglevel', 'info',
      '-f', 'image2',
      '-vcodec', 'mjpeg',
      '-',
    ], { env: process.env });

    const snapshotBuffers: Buffer[] = [];
    ffmpeg.stdout.on('data', data => snapshotBuffers.push(data));
    ffmpeg.stderr.on('data', data => this.platform.log.info('SNAPSHOT: ' + String(data)));

    ffmpeg.on('exit', (code, signal) => {
      if (signal) {
        this.platform.log.debug('Snapshot process was killed with signal: ' + signal);
        return callback(new Error('Snapshot killed by signal: ' + signal));
      } else if (code === 0) {
        this.platform.log.debug('Successfully captured snapshot');
        return callback(undefined, Buffer.concat(snapshotBuffers));
      } else {
        this.platform.log.error('Snapshot process exited with code ' + code);
        return callback(new Error('Snapshot process exited with code ' + code));
      }
    });

    ffmpeg.on('error', (error) => {
      this.platform.log.error('Snapshot error: ' + error.message);
      callback(error);
    });
  }

  async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback) {
    const [videoPort] = await reservePorts({ count: 1 });
    const [audioPort] = await reservePorts({ count: 1 });
    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();
    const audioSSRC = this.hap.CameraController.generateSynchronisationSource();

    const sessionInfo: SessionInfo = {
      address: request.targetAddress,
      addressVersion: request.addressVersion,
      videoPort: request.video.port,
      videoIncomingPort: videoPort,
      videoCryptoSuite: request.video.srtpCryptoSuite,
      videoSRTP: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
      videoSSRC,
      audioPort: request.audio.port,
      audioIncomingPort: audioPort,
      audioCryptoSuite: request.audio.srtpCryptoSuite,
      audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
      audioSSRC,
    };

    this.pendingSessions[request.sessionID] = sessionInfo;

    const response: PrepareStreamResponse = {
      video: {
        port: videoPort,
        ssrc: videoSSRC,
        srtp_key: request.video.srtp_key,
        srtp_salt: request.video.srtp_salt,
      },
      audio: {
        port: audioPort,
        ssrc: audioSSRC,
        srtp_key: request.audio.srtp_key,
        srtp_salt: request.audio.srtp_salt,
      },
    };

    callback(undefined, response);
  }

  async handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback) {
    switch (request.type) {
      case this.hap.StreamRequestTypes.START:
        await this.startStream(request, callback);
        break;
      case this.hap.StreamRequestTypes.RECONFIGURE:
        callback();
        break;
      case this.hap.StreamRequestTypes.STOP:
        this.stopStream(request.sessionID);
        callback();
        break;
    }
  }

  private async startStream(request: StartStreamRequest, callback: StreamRequestCallback) {
    const sessionInfo = this.pendingSessions[request.sessionID];
    if (!sessionInfo) {
      return callback(new Error('Missing session info'));
    }

    const ffmpegArgs = [
      '-headers', `Authorization: Basic ${this.base64auth}\r\n`,
      '-use_wallclock_as_timestamps', '1',
      '-probesize', '32',
      '-analyzeduration', '0',
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-max_delay', '0',
      '-re',
      '-i', this.streamUrl,
      '-an',
      '-sn',
      '-dn',
      '-codec:v', 'libx264',
      '-pix_fmt', 'yuv420p',
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
      `srtp://${sessionInfo.address}:${sessionInfo.videoPort}?rtcpport=${sessionInfo.videoPort}&pkt_size=1316`,
      '-progress', 'pipe:1',
    ];

    const activeSession: ActiveSession = {};
    activeSession.socket = createSocket(sessionInfo.addressVersion === 'ipv6' ? 'udp6' : 'udp4');

    activeSession.socket.on('error', (err: Error) => {
      this.platform.log.error('Socket error: ' + err.message);
      this.stopStream(request.sessionID);
    });

    activeSession.socket.on('message', () => {
      if (activeSession.timeout) {
        clearTimeout(activeSession.timeout);
      }
      activeSession.timeout = setTimeout(() => {
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

  public stopStream(sessionId: string): void {
    const session = this.ongoingSessions[sessionId];
    if (!session) {
      return;
    }

    if (session.timeout) {
      clearTimeout(session.timeout);
    }
    try {
      session.socket?.close();
    } catch {
      // intentionally ignored
    }
    try {
      session.mainProcess?.stop();
    } catch {
      // intentionally ignored
    }

    delete this.ongoingSessions[sessionId];
  }

  public forceStopStream(sessionId: string): void {
    this.controller.forceStopStreamingSession(sessionId);
  }
}
