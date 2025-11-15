import { LoxonePlatform } from '../../LoxonePlatform';
import { get } from 'http';
import {
  APIEvent,
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
  public readonly recordingDelegate: CameraRecordingDelegate | undefined;
  private readonly streamUrl;
  private readonly ip;
  private readonly base64auth;
  private readonly cameraName: string;

  private pendingSessions: { [index: string]: SessionInfo } = {};
  private ongoingSessions: { [index: string]: ActiveSession } = {};

  private cachedSnapshot: Buffer | null = null;
  private cachedAt = 0;
  private readonly cacheTtlMs = 5000;
  private isShuttingDown = false;

  //private readonly camera;
  private readonly hap: HAP;
  private snapshotUrl?: string;

  constructor(
      private readonly platform: LoxonePlatform,
      streamUrl: string,
      base64auth: string,
      cameraName: string,
      snapshotUrl?: string,
  ) {
    //this.camera = camera;
    this.hap = this.platform.api.hap;
    this.streamUrl = streamUrl;
    this.base64auth = base64auth;
    this.cameraName = cameraName;
    this.snapshotUrl = snapshotUrl;

    // Extract the IP address using a regular expression
    const ipAddressRegex = /http:\/\/([\d.]+)/;
    const match = streamUrl.match(ipAddressRegex);
    if (match && match[1]) {
      this.ip = match[1];
    }

    const enableHKSV = this.platform.config.enableHKSV ?? false;

    if (enableHKSV) {
      this.recordingDelegate = new RecordingDelegate(this.platform, this.streamUrl, this.base64auth, this.cameraName);
      this.platform.log.info(`[${this.cameraName}] HKSV is Activated for this configuration.`);
    } else {
      this.recordingDelegate = undefined;
      this.platform.log.info(`[${this.cameraName}] HKSV is Disabled for this configuration.`);
    }

    // Handle shutdown
    platform.api.on(APIEvent.SHUTDOWN, () => {
      this.isShuttingDown = true;
      this.platform.log.debug(`[${this.cameraName}] Streaming delegate is shutting down`);
    });


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
      ...(this.recordingDelegate
        ? {
          recording: {
            options: recordingOptions,
            delegate: this.recordingDelegate,
          },
        }
        : {}),
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
        this.platform.log.error(`[${this.cameraName}] Error occurred closing socket: ${error}`);
      }

      try {
        session.mainProcess?.stop();
      } catch (error) {
        this.platform.log.error(
          `[${this.cameraName}] Error occurred terminating main FFmpeg process: ${error}`,
        );
      }

      try {
        session.returnProcess?.stop();
      } catch (error) {
        this.platform.log.error(
          `[${this.cameraName}] Error occurred terminating two-way FFmpeg process: ${error}`,
        );
      }

      delete this.ongoingSessions[sessionId];

      this.platform.log.info(`[${this.cameraName}] Stopped video stream.`);
    }
  }

  forceStopStream(sessionId: string) {
    this.controller.forceStopStreamingSession(sessionId);
  }

  /** Public snapshot method with internal caching */
  public async getSnapshot(): Promise<Buffer | null> {
    const now = Date.now();

    if (this.cachedSnapshot && now - this.cachedAt < this.cacheTtlMs) {
      this.platform.log.debug(`[${this.cameraName}] Snapshot cache hit`);
      return this.cachedSnapshot;
    }

    return new Promise((resolve) => {
      this.handleSnapshotRequest({ width: 640, height: 360 }, (err, buffer) => {
        if (err || !buffer) {
          this.platform.log.warn(`[${this.cameraName}] Snapshot request failed`);
          return resolve(null);
        }

        this.cachedSnapshot = buffer;
        this.cachedAt = Date.now();
        resolve(buffer);
      });
    });
  }

  /**
   * Get snapshot via direct HTTP request (faster than FFmpeg)
   */
  private async getSnapshotViaHTTP(): Promise<Buffer | null> {
    if (!this.snapshotUrl) {
      return null;
    }

    return new Promise((resolve) => {
      const request = get(this.snapshotUrl!, {
        timeout: 500, // 500ms timeout for very fast response
        headers: {
          'Authorization': `Basic ${this.base64auth}`,
        },
      }, (response) => {
        if (response.statusCode !== 200) {
          this.platform.log.debug(`[${this.cameraName}] Snapshot HTTP request failed with status ${response.statusCode}`);
          response.destroy();
          resolve(null);
          return;
        }

        const buffers: Buffer[] = [];
        let hasError = false;

        response.on('data', (chunk) => {
          if (!hasError) {
            buffers.push(chunk);
          }
        });

        response.on('end', () => {
          if (!hasError) {
            resolve(Buffer.concat(buffers));
          } else {
            resolve(null);
          }
        });

        response.on('error', (error) => {
          hasError = true;
          this.platform.log.debug(`[${this.cameraName}] Snapshot HTTP response error: ${error.message}`);
          resolve(null);
        });
      });

      request.on('error', (error) => {
        this.platform.log.debug(`[${this.cameraName}] Snapshot HTTP request error: ${error.message}`);
        resolve(null);
      });

      request.on('timeout', () => {
        this.platform.log.debug(`[${this.cameraName}] Snapshot HTTP request timeout`);
        request.destroy();
        resolve(null);
      });
    });
  }

  async handleSnapshotRequest(
    request: SnapshotRequest,
    callback: SnapshotRequestCallback,
  ): Promise<void> {
    this.platform.log.debug(`[${this.cameraName}] Snapshot requested: ${request.width} x ${request.height}`);

    try {
      // Try HTTP snapshot first (faster than FFmpeg)
      let snapshot: Buffer | null = null;
      if (this.snapshotUrl) {
        try {
          snapshot = await this.getSnapshotViaHTTP();
          if (snapshot) {
            // Update cache for next request
            this.cachedSnapshot = snapshot;
            this.cachedAt = Date.now();
            this.platform.log.debug(`[${this.cameraName}] Successfully captured snapshot via HTTP at ${request.width}x${request.height}`);
            callback(undefined, snapshot);
            return;
          }
        } catch (error) {
          this.platform.log.debug(
            `[${this.cameraName}] HTTP snapshot failed, falling back to FFmpeg: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // Fallback to FFmpeg if HTTP failed or snapshotUrl not available
      snapshot = await this.fetchSnapshot();
      // Update cache for next request
      this.cachedSnapshot = snapshot;
      this.cachedAt = Date.now();
      this.platform.log.debug(`[${this.cameraName}] Successfully captured snapshot via FFmpeg at ${request.width}x${request.height}`);
      callback(undefined, snapshot);
    } catch (error) {
      this.platform.log.error(`[${this.cameraName}] Snapshot error: ${error instanceof Error ? error.message : String(error)}`);
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private fetchSnapshot(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-re',
        '-headers', `Authorization: Basic ${this.base64auth}\r\n`,
        '-i', `${this.streamUrl}`,
        '-frames:v', '1',
        '-update', '1',
        '-loglevel', 'error',
        '-f', 'image2',
        '-vcodec', 'mjpeg',
        '-',
      ], { env: process.env });

      let snapshotBuffer = Buffer.alloc(0);

      ffmpeg.stdout.on('data', (data) => {
        snapshotBuffer = Buffer.concat([snapshotBuffer, data]);
      });

      ffmpeg.on('error', (error: Error) => {
        reject(new Error(`FFmpeg process creation failed: ${error.message}`));
      });

      ffmpeg.stderr.on('data', (data) => {
        const line = data.toString();
        if (/error|failed|unable|not found/i.test(line)) {
          this.platform.log.error(`[${this.cameraName}] Snapshot error: ${line.trim()}`);
        }
      });

      ffmpeg.on('close', (code, signal) => {
        if (signal) {
          reject(new Error(`Snapshot process was killed with signal: ${signal}`));
        } else if (code === 0) {
          if (snapshotBuffer.length > 0) {
            resolve(snapshotBuffer);
          } else {
            reject(new Error('Failed to fetch snapshot: buffer is empty'));
          }
        } else {
          reject(new Error(`Snapshot process exited with code ${code}`));
        }
      });
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
        this.platform.log.info(
          // eslint-disable-next-line max-len
          `[${this.cameraName}] Started video stream: ${request.video.width}x${request.video.height}, ${request.video.fps} fps, ${request.video.max_bit_rate} kbps`,
        );

        await this.startStream(request, callback);
        break;
      }

      case this.hap.StreamRequestTypes.RECONFIGURE: {
        this.platform.log.debug(
          `[${this.cameraName}] Reconfigure stream requested:
          ${request.video.width}x${request.video.height}, ${request.video.fps} fps, ${request.video.max_bit_rate} kbps (Ignored)`,
        );

        callback();
        break;
      }

      case this.hap.StreamRequestTypes.STOP: {
        this.platform.log.debug(`[${this.cameraName}] Stop stream requested`);

        this.stopStream(request.sessionID);
        callback();
        break;
      }
    }
  }

  private async startStream(request: StartStreamRequest, callback: StreamRequestCallback) {
    const sessionInfo = this.pendingSessions[request.sessionID];

    if (!sessionInfo) {
      this.platform.log.error(`[${this.cameraName}] Error finding session information.`);
      callback(new Error('Error finding session information'));
    }

    //const vcodec = 'libx264';
    const mtu = 1316; // request.video.mtu is not used

    //const fps = request.video.fps;
    //const videoBitrate = request.video.max_bit_rate;

    const ffmpegArgs = [
      '-headers', `Authorization: Basic ${this.base64auth}\r\n`,
      '-use_wallclock_as_timestamps', '1',
      '-probesize', '32',
      '-analyzeduration', '0',
      '-fflags', 'nobuffer+igndts',
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
      '-f', 'rawvideo',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-crf', '22',
      // eslint-disable-next-line max-len
      '-filter:v', 'fps=25:round=down,scale=\'min(1280,iw)\':\'min(720,ih)\':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2',
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
      this.platform.log.error(`[${this.cameraName}] Socket error: ${err.message}`);
      this.stopStream(request.sessionID);
    });

    activeSession.socket.on('message', () => {
      if (activeSession.timeout) {
        clearTimeout(activeSession.timeout);
      }
      activeSession.timeout = setTimeout(() => {
        this.platform.log.info(`[${this.cameraName}] Device appears to be inactive. Stopping stream.`);
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