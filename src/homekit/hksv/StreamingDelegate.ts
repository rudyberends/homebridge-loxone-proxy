import { LoxonePlatform } from '../../LoxonePlatform';
import { get as httpGet } from 'http';
import { get as httpsGet } from 'https';
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
  ReturnAudioTranscoder,
  RtpSplitter,
} from '@homebridge/camera-utils';

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { createSocket, Socket } from 'dgram';
import { Readable } from 'stream';
import type { TwoWayAudioContext } from '../services/Camera';
import { FfmpegStreamingProcess, StreamingDelegate as FfmpegStreamingDelegate } from './FfmpegStreamingProcess';
import { LoxoneTalkbackSession } from './LoxoneTalkback';
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
      audioSRTPKey: Buffer;
      audioSRTPSalt: Buffer;
      audioSSRC: number;
      returnAudioSplitter?: RtpSplitter;
  }

  type ActiveSession = {
      mainProcess?: FfmpegStreamingProcess;
      homekitAudioProcess?: FfmpegStreamingProcess;
      returnProcess?: ReturnAudioTranscoder;
      timeout?: NodeJS.Timeout;
      socket?: Socket;
      loxoneTalkback?: LoxoneTalkbackSession;
      returnAudioStdout?: Readable;
      returnAudioStdoutHandler?: (chunk: Buffer) => void;
  };

type TwoWayAudioMode = 'disabled' | 'custom-args' | 'loxone-intercom-v2';

export class streamingDelegate implements CameraStreamingDelegate, FfmpegStreamingDelegate {
  public readonly controller: CameraController;
  public readonly recordingDelegate: CameraRecordingDelegate | undefined;
  private readonly streamUrl: string;
  private readonly base64auth: string;
  private readonly cameraName: string;
  private readonly twoWayAudioEnabled: boolean;
  private readonly twoWayAudioMode: TwoWayAudioMode;
  private readonly twoWayAudioOutputArgs?: string;
  private readonly twoWayAudioTemplateVars?: Record<string, string>;
  private readonly twoWayAudioContext?: TwoWayAudioContext;

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
      twoWayAudioTemplateVars?: Record<string, string>,
      twoWayAudioContext?: TwoWayAudioContext,
  ) {
    //this.camera = camera;
    this.hap = this.platform.api.hap;
    this.streamUrl = streamUrl;
    this.base64auth = base64auth;
    this.cameraName = cameraName;
    this.snapshotUrl = snapshotUrl;
    this.twoWayAudioTemplateVars = twoWayAudioTemplateVars;
    this.twoWayAudioContext = twoWayAudioContext;
    this.twoWayAudioOutputArgs = this.platform.config?.Advanced?.TwoWayAudioOutputArgs;
    const isTwoWayEnabledInConfig = this.platform.config?.Advanced?.EnableTwoWayAudio ?? false;
    const useLoxoneAutoMode = isTwoWayEnabledInConfig && this.twoWayAudioContext?.mode === 'loxone-intercom-v2';
    const useCustomArgsMode = isTwoWayEnabledInConfig && !!this.twoWayAudioOutputArgs;

    if (useLoxoneAutoMode) {
      this.twoWayAudioMode = 'loxone-intercom-v2';
      this.twoWayAudioEnabled = true;
      this.platform.log.info(`[${this.cameraName}] Two-way audio enabled (automatic Loxone mode).`);
    } else if (useCustomArgsMode) {
      this.twoWayAudioMode = 'custom-args';
      this.twoWayAudioEnabled = true;
      this.platform.log.info(`[${this.cameraName}] Two-way audio enabled (custom FFmpeg output args).`);
    } else {
      this.twoWayAudioMode = 'disabled';
      this.twoWayAudioEnabled = false;
      if (isTwoWayEnabledInConfig) {
        this.platform.log.warn(
          `[${this.cameraName}] Two-way audio requested, but no compatible mode is available. ` +
          'For non-Loxone cameras set Advanced.TwoWayAudioOutputArgs.',
        );
      }
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
      Object.keys(this.ongoingSessions).forEach((sessionId) => this.stopStream(sessionId));
      Object.values(this.pendingSessions).forEach((session) => session.returnAudioSplitter?.close());
      this.pendingSessions = {};
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
        twoWayAudio: this.twoWayAudioEnabled,
        codecs: [
          {
            type: AudioStreamingCodecType.AAC_ELD,
            samplerate: AudioStreamingSamplerate.KHZ_16,
          },
          {
            type: AudioStreamingCodecType.OPUS,
            samplerate: AudioStreamingSamplerate.KHZ_24,
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
        session.homekitAudioProcess?.stop();
      } catch (error) {
        this.platform.log.error(
          `[${this.cameraName}] Error occurred terminating HomeKit audio process: ${error}`,
        );
      }

      this.detachReturnAudioStdout(session);

      try {
        session.loxoneTalkback?.stop();
      } catch (error) {
        this.platform.log.error(
          `[${this.cameraName}] Error occurred terminating Loxone talkback session: ${error}`,
        );
      }

      try {
        session.returnProcess?.stop();
      } catch (error) {
        this.platform.log.error(
          `[${this.cameraName}] Error occurred terminating two-way audio process: ${error}`,
        );
      }

      delete this.ongoingSessions[sessionId];
      delete this.pendingSessions[sessionId];

      this.platform.log.info(`[${this.cameraName}] Stopped video stream.`);
      return;
    }

    const pendingSession = this.pendingSessions[sessionId];
    if (pendingSession?.returnAudioSplitter) {
      pendingSession.returnAudioSplitter.close();
    }
    delete this.pendingSessions[sessionId];
  }

  forceStopStream(sessionId: string) {
    this.controller.forceStopStreamingSession(sessionId);
  }

  /** Public snapshot method with internal caching */
  public async getSnapshot(useCache = true): Promise<Buffer | null> {
    const now = Date.now();

    if (useCache && this.cachedSnapshot && now - this.cachedAt < this.cacheTtlMs) {
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
    const snapshotUrl = this.snapshotUrl;
    if (!snapshotUrl) {
      return null;
    }

    return new Promise((resolve) => {
      const requestHeaders: Record<string, string> = {};
      if (this.base64auth) {
        requestHeaders.Authorization = `Basic ${this.base64auth}`;
      }

      const requestFn = snapshotUrl.startsWith('https://') ? httpsGet : httpGet;
      const request = requestFn(snapshotUrl, {
        timeout: 2000,
        headers: requestHeaders,
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
      snapshot = await this.fetchSnapshot(request.width, request.height);
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

  private fetchSnapshot(width: number, height: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'error',
      ];

      if (this.base64auth) {
        ffmpegArgs.push('-headers', `Authorization: Basic ${this.base64auth}\r\n`);
      }

      ffmpegArgs.push(
        '-i', `${this.streamUrl}`,
        '-frames:v', '1',
        '-an',
        '-sn',
        '-dn',
        '-vf', this.buildSnapshotFilter(width, height),
        '-f', 'image2',
        '-vcodec', 'mjpeg',
        '-',
      );

      const ffmpeg = spawn(defaultFfmpegPath, ffmpegArgs, { env: process.env });

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

    let audioIncomingPort = await reservePorts({
      count: 1,
    });
    const audioSSRC = this.hap.CameraController.generateSynchronisationSource();

    let returnAudioSplitter: RtpSplitter | undefined;
    if (this.twoWayAudioEnabled) {
      returnAudioSplitter = new RtpSplitter();
      audioIncomingPort = [await returnAudioSplitter.portPromise];
    }

    const sessionInfo: SessionInfo = {
      address: request.targetAddress,
      addressVersion: request.addressVersion,

      audioCryptoSuite: request.audio.srtpCryptoSuite,
      audioPort: request.audio.port,
      audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
      audioSRTPKey: request.audio.srtp_key,
      audioSRTPSalt: request.audio.srtp_salt,
      audioSSRC: audioSSRC,
      audioIncomingPort: audioIncomingPort[0],
      returnAudioSplitter,

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
      return;
    }

    const mtu = request.video.mtu > 0 ? request.video.mtu : 1316;
    const fps = this.clamp(Math.round(request.video.fps || 25), 2, 30);
    const targetWidth = this.clamp(Math.round(request.video.width || 1280), 320, 1920);
    const targetHeight = this.clamp(Math.round(request.video.height || 720), 180, 1080);
    const videoBitrate = this.clamp(Math.round(request.video.max_bit_rate || 299), 150, 4096);
    const payloadType = request.video.pt || 99;
    const keyframeInterval = Math.max(1, fps);

    const ffmpegArgs = this.buildAuthArgs();
    ffmpegArgs.push(
      '-hide_banner',
      '-use_wallclock_as_timestamps', '1',
      '-probesize', '32',
      '-analyzeduration', '0',
      '-fflags', '+genpts+nobuffer+igndts',
      '-flags', 'low_delay',
      '-max_delay', '0',
      '-i', `${this.streamUrl}`,
      '-an',
      '-sn',
      '-dn',
      '-codec:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-color_range', 'mpeg',
      '-crf', '22',
      '-r', `${fps}`,
      '-g', `${keyframeInterval}`,
      '-keyint_min', `${keyframeInterval}`,
      '-sc_threshold', '0',
      '-bf', '0',
      // eslint-disable-next-line max-len
      '-filter:v', `fps=${fps}:round=down,scale='min(${targetWidth},iw)':'min(${targetHeight},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      '-b:v', `${videoBitrate}k`,
      '-maxrate', `${videoBitrate}k`,
      '-bufsize', `${videoBitrate * 2}k`,
      '-payload_type', `${payloadType}`,
      '-ssrc', `${sessionInfo.videoSSRC}`,
      '-f', 'rtp',
      '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
      '-srtp_out_params', sessionInfo.videoSRTP.toString('base64'),
      `srtp://${sessionInfo.address}:${sessionInfo.videoPort}?rtcpport=${sessionInfo.videoPort}&pkt_size=${mtu}`,
      '-progress', 'pipe:1',
    );

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
      this.cameraName,
      request.sessionID,
      defaultFfmpegPath,
      ffmpegArgs,
      this.platform.log,
      true,
      this,
      callback,
    );

    if (this.twoWayAudioEnabled) {
      this.startTwoWayAudio(activeSession, sessionInfo, request);
    }

    this.ongoingSessions[request.sessionID] = activeSession;
    delete this.pendingSessions[request.sessionID];
  }

  private startTwoWayAudio(
    activeSession: ActiveSession,
    sessionInfo: SessionInfo,
    request: StartStreamRequest,
  ): void {
    if (!sessionInfo.returnAudioSplitter) {
      this.platform.log.warn(`[${this.cameraName}] No RTP splitter available for two-way audio. Skipping talkback setup.`);
      return;
    }

    if (this.twoWayAudioMode === 'loxone-intercom-v2') {
      this.startLoxoneTwoWayAudio(activeSession, sessionInfo, request);
      return;
    }

    this.startCustomTwoWayAudio(activeSession, sessionInfo, request);
  }

  private startCustomTwoWayAudio(
    activeSession: ActiveSession,
    sessionInfo: SessionInfo,
    request: StartStreamRequest,
  ): void {
    const outputArgs = this.buildTwoWayAudioOutputArgs();
    if (!outputArgs.length) {
      this.platform.log.warn(`[${this.cameraName}] Two-way audio output args are empty. Skipping talkback setup.`);
      return;
    }

    try {
      activeSession.returnProcess = this.createReturnAudioTranscoder(
        sessionInfo,
        request,
        outputArgs,
      );

      void activeSession.returnProcess.start()
        .then((splitterPort) => {
          this.platform.log.info(
            `[${this.cameraName}] Two-way audio started (RTP splitter on port ${splitterPort}).`,
          );
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.platform.log.error(`[${this.cameraName}] Failed to start two-way audio: ${message}`);
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error(`[${this.cameraName}] Could not initialize two-way audio: ${message}`);
    }
  }

  private startLoxoneTwoWayAudio(
    activeSession: ActiveSession,
    sessionInfo: SessionInfo,
    request: StartStreamRequest,
  ): void {
    const signalingBaseUrl = this.resolveLoxoneSignalingBaseUrl();
    if (!signalingBaseUrl) {
      this.platform.log.warn(
        `[${this.cameraName}] Could not resolve Loxone signaling URL. Skipping two-way audio.`,
      );
      return;
    }

    try {
      const outputArgs = [
        '-f', 's16le',
        '-acodec', 'pcm_s16le',
        '-ac', '1',
        '-ar', '48000',
        'pipe:1',
      ];

      activeSession.returnProcess = this.createReturnAudioTranscoder(
        sessionInfo,
        request,
        outputArgs,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error(`[${this.cameraName}] Could not initialize Loxone return-audio transcoder: ${message}`);
      return;
    }

    void activeSession.returnProcess.start()
      .then(async (splitterPort) => {
        this.platform.log.info(
          `[${this.cameraName}] Loxone return-audio transcoder started (RTP splitter on port ${splitterPort}).`,
        );

        const stdout = this.getReturnAudioStdout(activeSession.returnProcess);
        if (!stdout) {
          throw new Error('Unable to read PCM output from return-audio transcoder');
        }

        const talkback = new LoxoneTalkbackSession({
          platform: this.platform,
          cameraName: this.cameraName,
          signalingBaseUrl,
          username: this.platform.config.username,
          getToken: () => this.platform.LoxoneHandler?.getActiveCommunicationToken(),
          onIncomingPcm: (chunk: Buffer) => this.feedHomeKitIncomingAudio(activeSession, chunk),
        });

        activeSession.homekitAudioProcess = this.createLoxoneIncomingAudioBridge(
          request.sessionID,
          sessionInfo,
          request,
        );

        activeSession.loxoneTalkback = talkback;
        activeSession.returnAudioStdout = stdout;
        activeSession.returnAudioStdoutHandler = (chunk: Buffer) => talkback.pushPcmChunk(chunk);
        stdout.on('data', activeSession.returnAudioStdoutHandler);

        await talkback.start();
        this.platform.log.info(`[${this.cameraName}] Two-way audio started (Loxone WebRTC talkback).`);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        const sessionStillActive = this.ongoingSessions[request.sessionID] === activeSession;

        if (!sessionStillActive || this.isShuttingDown) {
          this.platform.log.debug(`[${this.cameraName}] Loxone two-way audio startup cancelled: ${message}`);
          return;
        }

        this.detachReturnAudioStdout(activeSession);
        activeSession.loxoneTalkback?.stop();
        activeSession.loxoneTalkback = undefined;
        activeSession.homekitAudioProcess?.stop();
        activeSession.homekitAudioProcess = undefined;
        activeSession.returnProcess?.stop();
        activeSession.returnProcess = undefined;
        this.platform.log.error(`[${this.cameraName}] Failed to start Loxone two-way audio: ${message}`);
      });
  }

  private createLoxoneIncomingAudioBridge(
    sessionId: string,
    sessionInfo: SessionInfo,
    request: StartStreamRequest,
  ): FfmpegStreamingProcess | undefined {
    const audioCodec = this.getAudioCodecArgs(request);
    if (!audioCodec) {
      this.platform.log.debug(
        `[${this.cameraName}] Unsupported HomeKit audio codec for inbound bridge: ${request.audio.codec}`,
      );
      return undefined;
    }

    const sampleRateKhz = this.resolveAudioSampleRateKhz(request.audio.sample_rate);
    const audioBitrate = Math.max(16, Math.round(request.audio.max_bit_rate || 24));
    const channels = Math.max(1, request.audio.channel || 1);

    const ffmpegArgs = [
      '-hide_banner',
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      '-ac', '1',
      '-ar', '48000',
      '-i', 'pipe:0',
      '-vn',
      '-sn',
      '-dn',
      ...audioCodec,
      '-ar', `${sampleRateKhz}k`,
      '-ac', `${channels}`,
      '-b:a', `${audioBitrate}k`,
      '-payload_type', `${request.audio.pt}`,
      '-ssrc', `${sessionInfo.audioSSRC}`,
      '-f', 'rtp',
      '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
      '-srtp_out_params', sessionInfo.audioSRTP.toString('base64'),
      `srtp://${sessionInfo.address}:${sessionInfo.audioPort}?rtcpport=${sessionInfo.audioPort}&pkt_size=188`,
      '-progress', 'pipe:1',
    ];

    this.platform.log.info(`[${this.cameraName}] Starting Loxone inbound audio bridge to HomeKit.`);

    return new FfmpegStreamingProcess(
      `${this.cameraName}-audio`,
      sessionId,
      defaultFfmpegPath,
      ffmpegArgs,
      this.platform.log,
      true,
      this,
      undefined,
      false,
    );
  }

  private getAudioCodecArgs(request: StartStreamRequest): string[] | undefined {
    switch (request.audio.codec) {
      case AudioStreamingCodecType.OPUS:
        return [
          '-codec:a', 'libopus',
          '-application', 'lowdelay',
          '-frame_duration', '20',
          '-flags', '+global_header',
        ];
      case AudioStreamingCodecType.AAC_ELD:
        return [
          '-codec:a', 'libfdk_aac',
          '-profile:a', 'aac_eld',
          '-flags', '+global_header',
        ];
      default:
        return undefined;
    }
  }

  private resolveAudioSampleRateKhz(value: number): number {
    switch (value) {
      case AudioStreamingSamplerate.KHZ_8:
        return 8;
      case AudioStreamingSamplerate.KHZ_16:
        return 16;
      case AudioStreamingSamplerate.KHZ_24:
      default:
        return 24;
    }
  }

  private feedHomeKitIncomingAudio(session: ActiveSession, chunk: Buffer): void {
    const stdin = session.homekitAudioProcess?.getStdin();
    if (!stdin || stdin.destroyed || !chunk.length) {
      return;
    }

    try {
      stdin.write(chunk);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.debug(`[${this.cameraName}] Failed to write inbound PCM to HomeKit bridge: ${message}`);
    }
  }

  private createReturnAudioTranscoder(
    sessionInfo: SessionInfo,
    request: StartStreamRequest,
    outputArgs: string[],
  ): ReturnAudioTranscoder {
    return new ReturnAudioTranscoder({
      ffmpegPath: defaultFfmpegPath,
      logger: {
        error: (log: string): void => this.platform.log.error(`[${this.cameraName}] [Talkback] ${log}`),
        info: (log: string): void => this.platform.log.debug(`[${this.cameraName}] [Talkback] ${log}`),
      },
      logLabel: `${this.cameraName}-talkback`,
      outputArgs,
      returnAudioSplitter: sessionInfo.returnAudioSplitter,
      prepareStreamRequest: {
        targetAddress: sessionInfo.address,
        addressVersion: sessionInfo.addressVersion,
        audio: {
          srtp_key: sessionInfo.audioSRTPKey,
          srtp_salt: sessionInfo.audioSRTPSalt,
        },
      },
      incomingAudioOptions: {
        ssrc: sessionInfo.audioSSRC,
        rtcpPort: sessionInfo.audioPort,
      },
      startStreamRequest: {
        audio: {
          codec: request.audio.codec,
          channel: request.audio.channel,
          sample_rate: request.audio.sample_rate,
          pt: request.audio.pt,
        },
      },
    });
  }

  private getReturnAudioStdout(returnProcess?: ReturnAudioTranscoder): Readable | undefined {
    if (!returnProcess) {
      return undefined;
    }

    const ffmpegProcess = returnProcess as unknown as {
      ffmpegProcess?: { ff?: ChildProcessWithoutNullStreams };
    };
    return ffmpegProcess.ffmpegProcess?.ff?.stdout;
  }

  private detachReturnAudioStdout(session: ActiveSession): void {
    if (session.returnAudioStdout && session.returnAudioStdoutHandler) {
      session.returnAudioStdout.off('data', session.returnAudioStdoutHandler);
    }
    session.returnAudioStdout = undefined;
    session.returnAudioStdoutHandler = undefined;
  }

  private resolveLoxoneSignalingBaseUrl(): string | undefined {
    const contextUrl = this.twoWayAudioContext?.signalingBaseUrl;
    if (contextUrl) {
      return contextUrl;
    }

    try {
      const parsed = new URL(this.streamUrl);
      return parsed.origin;
    } catch {
      return undefined;
    }
  }

  private buildAuthArgs(): string[] {
    if (!this.base64auth) {
      return [];
    }

    return ['-headers', `Authorization: Basic ${this.base64auth}\r\n`];
  }

  private buildSnapshotFilter(width: number, height: number): string {
    const safeWidth = this.clamp(Math.round(width || 640), 64, 4096);
    const safeHeight = this.clamp(Math.round(height || 360), 64, 2160);
    return `scale='min(${safeWidth},iw)':'min(${safeHeight},ih)':force_original_aspect_ratio=decrease`;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private buildTwoWayAudioOutputArgs(): string[] {
    const raw = this.twoWayAudioOutputArgs;
    if (!raw) {
      return [];
    }

    const cameraHost = this.extractHost(this.streamUrl);
    const expanded = raw
      .replace(/{camera_host}/g, cameraHost ?? '')
      .replace(/{stream_url}/g, this.streamUrl);

    const withTemplateVars = Object.entries(this.twoWayAudioTemplateVars ?? {})
      .reduce((acc, [key, value]) => acc.replace(new RegExp(`\\{${key}\\}`, 'g'), value), expanded);

    return this.tokenizeFfmpegArgs(withTemplateVars);
  }

  private extractHost(url: string): string | null {
    try {
      return new URL(url).host;
    } catch {
      return null;
    }
  }

  private tokenizeFfmpegArgs(command: string): string[] {
    const args: string[] = [];
    const re = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(command)) !== null) {
      args.push(match[1] ?? match[2] ?? match[0]);
    }
    return args;
  }
}
