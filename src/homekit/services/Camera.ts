/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  PlatformAccessory,
  CameraController,
  CameraControllerOptions,
  CameraStreamingDelegate,
  CameraRecordingDelegate,
  HAP,
  HDSProtocolSpecificErrorReason,
  PrepareStreamRequest,
  PrepareStreamResponse,
  RecordingPacket,
  SnapshotRequest,
  SnapshotRequestCallback,
  StreamingRequest,
  StreamRequestCallback,
  StreamRequestTypes,
  MediaContainerType,
  H264Profile,
  H264Level,
  StartStreamRequest,
  AudioRecordingCodecType,
} from 'homebridge';
import { ChildProcess, spawn } from 'child_process';
import { createSocket, Socket } from 'node:dgram';
import { Readable } from 'stream';
import { LoxonePlatform } from '../../LoxonePlatform';
import { pickPort } from 'pick-port';

interface PreBufferEntry {
  data: Buffer;
  timestamp: number;
  isKeyFrame: boolean;
}

interface ActiveSession {
  mainProcess?: ChildProcess;
  socket?: Socket;
  timeout?: NodeJS.Timeout;
}

export class CameraService implements CameraStreamingDelegate, CameraRecordingDelegate {
  private readonly hap: HAP;
  private readonly log: LoxonePlatform['log'];
  private readonly streamUrl: string;
  private readonly base64auth?: string;
  private readonly cameraName: string;
  public readonly controller: CameraController;

  private ffmpegProcess?: ChildProcess;
  private preBuffer: PreBufferEntry[] = [];
  private preBufferDuration = 4000; // 4s prebuffer for HKSV
  private snapshotCache?: { data: Buffer; timestamp: number };

  private pendingSessions: Map<string, {
    address: string;
    ipv6: boolean;
    videoPort: number;
    videoReturnPort: number;
    videoSRTP: Buffer;
    videoSSRC: number;
  }> = new Map();

  private ongoingSessions: Map<string, ActiveSession> = new Map();
  private recordingProcess?: ChildProcess;

  private recordingActive = false;
  private recordingConfig?: any;

  constructor(
    private platform: LoxonePlatform,
    accessory: PlatformAccessory,
    streamUrl: string,
    base64auth?: string,
  ) {
    this.hap = platform.api.hap;
    this.log = platform.log;
    this.streamUrl = streamUrl;
    this.base64auth = base64auth;
    this.cameraName = accessory.displayName;

    const resolutions: [number, number, number][] = [
      [320, 180, 30], [320, 240, 15], [320, 240, 30], [480, 270, 30],
      [480, 360, 30], [640, 360, 30], [640, 480, 30], [1024, 768, 30],
      [1280, 720, 30],
    ];

    const options: CameraControllerOptions = {
      cameraStreamCount: 2,
      delegate: this,
      streamingOptions: {
        supportedCryptoSuites: [this.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          codec: {
            profiles: [this.hap.H264Profile.MAIN],
            levels: [this.hap.H264Level.LEVEL4_0],
          },
          resolutions,
        },
      },
      recording: {
        options: {
          prebufferLength: this.preBufferDuration,
          mediaContainerConfiguration: [{ type: MediaContainerType.FRAGMENTED_MP4, fragmentLength: 4000 }],
          video: {
            type: this.hap.VideoCodecType.H264,
            resolutions: [[1280, 720, 30]],
            parameters: {
              profiles: [H264Profile.MAIN],
              levels: [H264Level.LEVEL4_0],
            },
          },
          audio: { codecs: [{ type: AudioRecordingCodecType.AAC_LC, samplerate: this.hap.AudioRecordingSamplerate.KHZ_32 }] },
        },
        delegate: this,
      },
    };

    this.controller = new this.hap.CameraController(options);
    accessory.configureController(this.controller);

    this.startPreBufferStream();
    platform.api.on('shutdown' as any, () => this.stopAll());
  }

  private async startPreBufferStream(): Promise<void> {
    const args = [
      '-headers', `Authorization: Basic ${this.base64auth}`,
      '-i', this.streamUrl,
      '-c:v', 'libx264',
      '-r', '30',
      '-b:v', '2000k',
      '-g', '15', // GOP size of 15 frames (~0.5s at 30 fps)
      '-keyint_min', '15',
      '-x264-params', 'keyint=15:min-keyint=15:scenecut=0:no-scenecut=1:open-gop=0:force-cfr=1', // Force IDR every 0.5s
      '-force_key_frames', 'expr:gte(t,n_forced*0.5)',
      '-profile:v', 'main',
      '-level', '4.0',
      '-f', 'h264',
      '-bsf:v', 'h264_mp4toannexb',
      'pipe:1',
    ];

    this.log.debug(`Starting pre-buffer with args: ${args.join(' ')}`);
    this.ffmpegProcess = spawn('ffmpeg', args, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.ffmpegProcess.on('error', (err) => this.log.error(`PreBuffer FFmpeg error: ${err}`, this.cameraName));
    this.ffmpegProcess.stderr?.on('data', (data) => this.log.debug(`PreBuffer FFmpeg stderr: ${data}`));
    this.ffmpegProcess.on('exit', () => {
      this.log.debug('PreBuffer FFmpeg exited');
      this.ffmpegProcess = undefined;
      this.preBuffer = [];
    });

    const stream = this.ffmpegProcess.stdout!;
    let buffer = Buffer.alloc(0);
    stream.on('data', (chunk: Buffer) => {
      this.log.debug(`Pre-buffer chunk received: ${chunk.length} bytes`);
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 5) {
        let nalStart = -1;
        for (let i = 0; i < buffer.length - 4; i++) {
          if (buffer[i] === 0 && buffer[i + 1] === 0 && buffer[i + 2] === 0 && buffer[i + 3] === 1) {
            nalStart = i;
            break;
          }
        }
        if (nalStart === -1) {
          break;
        }

        let nalEnd = buffer.length;
        for (let i = nalStart + 4; i < buffer.length - 4; i++) {
          if (buffer[i] === 0 && buffer[i + 1] === 0 && buffer[i + 2] === 0 && buffer[i + 3] === 1) {
            nalEnd = i;
            break;
          }
        }

        const nalUnit = buffer.slice(nalStart, nalEnd);
        const now = Date.now();
        const isKeyFrame = this.isKeyFrame(nalUnit);
        this.preBuffer.push({ data: nalUnit, timestamp: now, isKeyFrame });
        this.preBuffer = this.preBuffer.filter(entry => entry.timestamp > now - this.preBufferDuration);
        buffer = buffer.slice(nalEnd);

        if (!this.snapshotCache || this.snapshotCache.timestamp < now - 5000) {
          this.extractSnapshot().then(snapshot => {
            if (snapshot.length > 0) {
              this.snapshotCache = { data: snapshot, timestamp: now };
            }
          }).catch(err => this.log.error(`Snapshot extraction failed: ${err}`));
        }
      }
    });
  }

  private isKeyFrame(data: Buffer): boolean {
    if (data.length <= 4) {
      return false;
    }
    const nalUnitType = data[4] & 0x1F;
    const isKey = nalUnitType === 5 || nalUnitType === 7; // IDR or SPS
    this.log.debug(`Checking keyframe: NAL type=${nalUnitType}, isKeyFrame=${isKey}`);
    return isKey;
  }

  private async extractSnapshot(): Promise<Buffer> {
    const keyFrameIdx = this.preBuffer.findIndex(entry => entry.isKeyFrame); // Use SPS or IDR
    if (keyFrameIdx === -1) {
      this.log.warn('No keyframe found for snapshot');
      return Buffer.alloc(0);
    }

    const entries = this.preBuffer.slice(keyFrameIdx, keyFrameIdx + 10); // Limit to 10 NALs
    const h264Data = Buffer.concat(entries.map(entry => entry.data));
    this.log.debug(`Extracting snapshot from ${entries.length} NAL units, total size: ${h264Data.length} bytes`);

    return new Promise((resolve, reject) => {
      const cp = spawn('ffmpeg', [
        '-f', 'h264',
        '-i', 'pipe:',
        '-frames:v', '1',
        '-f', 'image2',
        '-c:v', 'mjpeg',
        'pipe:',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      const chunks: Buffer[] = [];
      cp.stdout.on('data', (data) => chunks.push(data));
      cp.stderr.on('data', (data) => this.log.debug(`Snapshot extract stderr: ${data}`));
      cp.on('exit', (code) => {
        if (code === 0) {
          const snapshot = Buffer.concat(chunks);
          this.log.debug(`Extracted snapshot: ${snapshot.length} bytes`);
          resolve(snapshot);
        } else {
          reject(new Error(`Snapshot extraction failed with code ${code}`));
        }
      });
      cp.stdin.write(h264Data);
      cp.stdin.end();
    });
  }

  async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): Promise<void> {
    this.log.debug(`Snapshot requested: ${request.width} x ${request.height}`);
    if (this.snapshotCache && this.snapshotCache.timestamp > Date.now() - 5000 && this.snapshotCache.data.length > 0) {
      this.log.debug('Returning cached snapshot');
      return callback(undefined, this.snapshotCache.data);
    }

    try {
      const snapshot = await this.extractSnapshot();
      if (snapshot.length === 0) {
        this.log.warn('No valid snapshot from pre-buffer, falling back to generateSnapshot');
        const fallback = await this.generateSnapshot();
        this.snapshotCache = { data: fallback, timestamp: Date.now() };
        callback(undefined, fallback);
      } else {
        this.snapshotCache = { data: snapshot, timestamp: Date.now() };
        callback(undefined, snapshot);
      }
    } catch (err) {
      this.log.error(`Snapshot failed: ${err}`);
      try {
        const emergencyFallback = await this.generateSnapshot();
        this.snapshotCache = { data: emergencyFallback, timestamp: Date.now() };
        callback(undefined, emergencyFallback);
      } catch (fallbackErr) {
        this.log.error(`Fallback snapshot also failed: ${fallbackErr}`);
        callback(fallbackErr instanceof Error ? fallbackErr : new Error('Snapshot failed'));
      }
    }
  }

  private async generateSnapshot(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const args = [
        '-headers', `Authorization: Basic ${this.base64auth}`,
        '-i', this.streamUrl,
        '-frames:v', '1',
        '-f', 'image2',
        '-c:v', 'mjpeg',
        'pipe:',
      ];
      const cp = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

      const snapshotBuffers: Buffer[] = [];
      cp.stdout.on('data', (data) => snapshotBuffers.push(data));
      cp.stderr.on('data', (data) => this.log.debug(`Snapshot FFmpeg: ${data}`));
      cp.on('exit', (code) => {
        if (code === 0) {
          const snapshot = Buffer.concat(snapshotBuffers);
          this.log.debug(`Generated snapshot, size: ${snapshot.length} bytes`);
          resolve(snapshot);
        } else {
          reject(new Error(`Snapshot process exited with code: ${code}`));
        }
      });
    });
  }

  async prepareStream(
    request: PrepareStreamRequest,
    callback: (error?: Error, response?: PrepareStreamResponse) => void,
  ): Promise<void> {
    const ipv6 = request.addressVersion === 'ipv6';
    const options = { type: 'udp', ip: ipv6 ? '::' : '0.0.0.0', reserveTimeout: 15 } as const;
    const videoReturnPort = await pickPort(options);
    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();
    const videoSRTP = Buffer.concat([request.video.srtp_key, request.video.srtp_salt]);

    const sessionInfo = {
      address: request.targetAddress,
      ipv6,
      videoPort: request.video.port,
      videoReturnPort,
      videoSRTP,
      videoSSRC,
    };

    this.pendingSessions.set(request.sessionID, sessionInfo);
    this.log.debug(`Prepared stream - Session: ${request.sessionID}, Address: ${sessionInfo.address}, Port: ${videoReturnPort}, ` +
      `Video SRTP: ${videoSRTP.toString('base64')}, Video SSRC: ${videoSSRC}`);
    callback(undefined, {
      video: { port: videoReturnPort, ssrc: videoSSRC, srtp_key: request.video.srtp_key, srtp_salt: request.video.srtp_salt },
    });
  }

  async handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): Promise<void> {
    switch (request.type) {
      case StreamRequestTypes.START:
        this.startStream(request as StartStreamRequest, callback);
        break;
      case StreamRequestTypes.STOP:
        this.stopStream(request.sessionID);
        callback();
        break;
      case StreamRequestTypes.RECONFIGURE:
        this.log.debug('Stream reconfigure ignored', this.cameraName);
        callback();
        break;
    }
  }


  private startStream(request: StreamingRequest, callback: StreamRequestCallback): void {
    if (request.type !== StreamRequestTypes.START) {
      this.log.error('Invalid request type for startStream');
      callback(new Error('Invalid request type'));
      return;
    }

    const sessionInfo = this.pendingSessions.get(request.sessionID);
    if (!sessionInfo) {
      this.log.error('Session not found for streaming');
      return callback(new Error('Session not found'));
    }

    const mtu = 1378;
    const ffmpegArgs = [
      '-headers', `Authorization: Basic ${this.base64auth}`,
      '-re',
      '-i', this.streamUrl,
      '-an', '-sn', '-dn', // No audio, subtitles, or data
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-color_range', 'mpeg',
      '-r', request.video.fps.toString(),
      '-f', 'rawvideo',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-b:v', `${request.video.max_bit_rate}k`,
      '-g', '15', // Force IDR every 0.5s
      '-keyint_min', '15',
      '-x264-params', 'keyint=15:min-keyint=15:scenecut=0',
      '-profile:v', 'main',
      '-level', '4.0',
      '-filter:v', 'scale=\'min(1280,iw)\':\'min(720,ih)\':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-payload_type', request.video.pt.toString(),
      '-ssrc', sessionInfo.videoSSRC.toString(),
      '-f', 'rtp',
      '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
      '-srtp_out_params', sessionInfo.videoSRTP.toString('base64'),
      `srtp://${sessionInfo.address}:${sessionInfo.videoPort}?rtcpport=${sessionInfo.videoPort}&pkt_size=${mtu}`,
      '-loglevel', 'level+verbose',
    ];

    this.log.debug(`Starting stream with args: ${ffmpegArgs.join(' ')}`);
    const activeSession: ActiveSession = {};
    activeSession.socket = createSocket(sessionInfo.ipv6 ? 'udp6' : 'udp4');
    activeSession.socket.on('error', (err) => {
      this.log.error(`Socket error: ${err.message}`, this.cameraName);
      this.stopStream(request.sessionID);
    });
    activeSession.socket.on('message', () => {
      if (activeSession.timeout) {
        clearTimeout(activeSession.timeout);
      }
      activeSession.timeout = setTimeout(() => {
        this.log.info('Device appears inactive. Stopping stream.', this.cameraName);
        this.controller.forceStopStreamingSession(request.sessionID);
        this.stopStream(request.sessionID);
      }, request.video.rtcp_interval * 5 * 1000);
    });
    activeSession.socket.bind(sessionInfo.videoReturnPort);

    const cp = spawn('ffmpeg', ffmpegArgs, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    activeSession.mainProcess = cp;

    cp.stderr.on('data', (data) => this.log.debug(`Stream FFmpeg stderr: ${data}`));
    cp.on('error', (err) => {
      this.log.error(`Stream FFmpeg error: ${err}`, this.cameraName);
      callback(err);
    });
    cp.on('exit', (code) => {
      this.log.debug(`Stream FFmpeg exited with code ${code}`);
      this.stopStream(request.sessionID);
    });

    const waitForOutput = new Promise<void>((resolve, reject) => {
      let hasOutput = false;
      cp.stderr.on('data', (data) => {
        const stderr = data.toString();
        if (stderr.includes('frame=') && stderr.match(/frame=\s*\d+/)[0] !== 'frame=    0') {
          hasOutput = true;
          this.log.debug('Stream FFmpeg started outputting frames');
          resolve();
        } else if (stderr.includes('error') || stderr.includes('failed')) {
          reject(new Error(`FFmpeg error: ${stderr}`));
        }
      });
      setTimeout(() => {
        if (!hasOutput) {
          reject(new Error('No frames output after 5s'));
        } else {
          resolve();
        }
      }, 5000);
    });

    waitForOutput.then(() => {
      this.log.info(
        `Started video stream: ${request.video.width}x${request.video.height}, ` +
        `${request.video.fps} fps, ${request.video.max_bit_rate} kbps`,
        this.cameraName,
      );
      this.ongoingSessions.set(request.sessionID, activeSession);
      this.pendingSessions.delete(request.sessionID);
      callback();
    }).catch(err => {
      this.log.error(`Stream failed to start: ${err}`);
      callback(err);
    });
  }

  // ... (rest of the file remains unchanged)

  public stopStream(sessionId: string): void {
    const session = this.ongoingSessions.get(sessionId);
    if (session) {
      if (session.timeout) {
        clearTimeout(session.timeout);
      }
      try {
        session.socket?.close();
      } catch (err) {
        this.log.error(`Error closing socket: ${err}`, this.cameraName);
      }
      try {
        session.mainProcess?.kill();
      } catch (err) {
        this.log.error(`Error terminating FFmpeg process: ${err}`, this.cameraName);
      }
      this.ongoingSessions.delete(sessionId);
      this.log.info('Stopped video stream.', this.cameraName);
    }
  }

  updateRecordingActive(active: boolean): void {
    this.recordingActive = active;
    if (!active) {
      this.stopAllRecordings();
    }
    this.log.debug(`Recording active: ${active}`, this.cameraName);
  }

  updateRecordingConfiguration(configuration?: any): void {
    this.recordingConfig = configuration;
    this.log.debug(`Recording config updated: ${JSON.stringify(configuration)}`, this.cameraName);
  }

  async *handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket> {
    if (!this.recordingActive || !this.recordingConfig) {
      throw new this.hap.HDSProtocolError(HDSProtocolSpecificErrorReason.NOT_ALLOWED);
    }

    this.log.info(`Starting recording stream ${streamId}`, this.cameraName);

    // Start recording with pre-buffer and live stream
    const preBufferData = this.getPreBufferVideo();
    const args = [
      '-headers', `Authorization: Basic ${this.base64auth}`,
      '-i', this.streamUrl,
      '-c:v', 'libx264',
      '-r', '30',
      '-b:v', '2000k',
      '-g', '15', // Keyframe every 0.5s
      '-keyint_min', '15',
      '-x264-params', 'keyint=15:min-keyint=15:scenecut=0:no-scenecut=1:open-gop=0:force-cfr=1',
      '-profile:v', 'main',
      '-level', '4.0',
      '-an', // No audio
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-frag_duration', '4000000', // 4s fragments (microseconds)
      'pipe:',
    ];

    this.recordingProcess = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.recordingProcess.stderr?.on('data', (data) => this.log.debug(`Recording FFmpeg stderr: ${data}`));
    this.recordingProcess.on('error', (err) => this.log.error(`Recording FFmpeg error: ${err}`, this.cameraName));
    this.recordingProcess.on('exit', (code) => {
      this.log.debug(`Recording FFmpeg exited with code ${code}`, this.cameraName);
      this.recordingProcess = undefined;
    });

    // Inject pre-buffer data
    this.recordingProcess.stdin?.write(preBufferData);
    const stream = this.recordingProcess.stdout as Readable;
    let buffer = Buffer.alloc(0);

    try {
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length > 0) {
          const moofBox = buffer.indexOf(Buffer.from('moof', 'ascii'));
          if (moofBox === -1 || buffer.length < moofBox + 8) {
            break;
          }

          const fragmentSize = buffer.readUInt32BE(moofBox - 4); // Size precedes 'moof'
          if (buffer.length >= moofBox + fragmentSize) {
            const fragment = buffer.slice(0, moofBox + fragmentSize);
            yield { data: fragment, isLast: false };
            buffer = buffer.slice(moofBox + fragmentSize);
          } else {
            break;
          }
        }
      }
    } finally {
      this.stopAllRecordings();
      this.log.info(`Recording stream ${streamId} ended`, this.cameraName);
    }
  }

  private getPreBufferVideo(): Buffer {
    const now = Date.now();
    const filtered = this.preBuffer.filter(entry => entry.timestamp > now - this.preBufferDuration);
    const startIdx = filtered.findIndex(entry => entry.isKeyFrame && (entry.data[4] & 0x1F) === 5); // Start with IDR
    if (startIdx === -1) {
      this.log.warn('No IDR in pre-buffer for recording');
      return Buffer.concat(filtered.map(entry => entry.data)); // Fallback to all data
    }
    return Buffer.concat(filtered.slice(startIdx).map(entry => entry.data));
  }

  acknowledgeStream(streamId: number): void {
    this.log.debug(`Acknowledged recording stream ${streamId}`, this.cameraName);
  }

  closeRecordingStream(streamId: number, reason?: HDSProtocolSpecificErrorReason): void {
    this.log.debug(`Closed recording stream ${streamId} with reason: ${reason}`, this.cameraName);
    this.stopAllRecordings();
  }

  private stopAll(): void {
    this.ffmpegProcess?.kill();
    this.ongoingSessions.forEach(session => {
      if (session.mainProcess) {
        session.mainProcess.kill();
      }
      if (session.socket) {
        session.socket.close();
      }
    });
    this.ongoingSessions.clear();
    this.stopAllRecordings();
  }

  private stopAllRecordings(): void {
    if (this.recordingProcess) {
      this.recordingProcess.kill();
      this.recordingProcess = undefined;
    }
  }
}