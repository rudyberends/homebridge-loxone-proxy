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
  Service as HapService,
} from 'homebridge';
import { ChildProcess, spawn } from 'child_process';
import { createSocket, Socket } from 'node:dgram';
import { Readable } from 'stream';
import { LoxonePlatform } from '../../LoxonePlatform';
import { pickPort } from 'pick-port';
import { Server, createServer, Socket as NetSocket } from 'net';

interface PreBufferEntry {
  atom: { header: Buffer; type: string; length: number; data: Buffer };
  time: number;
}

interface ActiveSession {
  mainProcess?: ChildProcess;
  socket?: Socket;
  timeout?: NodeJS.Timeout;
}

interface RecordingSession {
  socket: NetSocket;
  cp: ChildProcess;
  generator: AsyncGenerator<any>;
}

export class CameraService implements CameraStreamingDelegate, CameraRecordingDelegate {
  private readonly hap: HAP;
  private readonly log: LoxonePlatform['log'];
  private readonly streamUrl: string;
  private readonly base64auth?: string;
  private readonly cameraName: string;
  public readonly controller: CameraController;
  private hksvMotionSensor!: HapService;
  private motionTimeout?: NodeJS.Timeout;

  private preBuffer: PreBufferEntry[] = [];
  private preBufferDuration = 4000; // 4s prebuffer
  private preBufferSession?: { server: Server; process: ChildProcess };
  private snapshotPromise?: Promise<Buffer>;

  private pendingSessions: Map<string, {
    address: string;
    ipv6: boolean;
    videoPort: number;
    videoReturnPort: number;
    videoSRTP: Buffer;
    videoSSRC: number;
  }> = new Map();

  private ongoingSessions: Map<string, ActiveSession> = new Map();
  private recordingSession?: RecordingSession;
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

    this.hksvMotionSensor = accessory.getService('HKSV Motion Sensor') ||
      accessory.addService(this.hap.Service.MotionSensor, 'HKSV Motion Sensor', 'hksv-motion');

    const resolutions: [number, number, number][] = [
      [1280, 720, 30], [640, 480, 30], [640, 360, 30], [480, 360, 30],
      [480, 270, 30], [320, 240, 30], [320, 180, 30],
    ];

    const existingController = accessory.getService(this.hap.Service.CameraRTPStreamManagement);
    if (!existingController) {
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
            overrideEventTriggerOptions: [
              this.hap.EventTriggerOption.MOTION,
              this.hap.EventTriggerOption.DOORBELL,
            ],
          },
          delegate: this,
          sensors: { motion: this.hksvMotionSensor },
        } as any,
      };

      this.controller = new this.hap.CameraController(options);
      accessory.configureController(this.controller);
      this.log.debug('CameraController configured with recording:', !!this.controller.recordingManagement);
    } else {
      this.controller = accessory.getService(this.hap.Service.CameraRTPStreamManagement) as unknown as CameraController;
      this.log.debug('Reusing existing CameraController', this.cameraName);
    }
    this.startPreBuffer();
    platform.api.on('shutdown', () => this.stopAll());
  }

  private async startPreBuffer(): Promise<void> {
    const args = [
      '-headers', `Authorization: Basic ${this.base64auth}`,
      '-i', this.streamUrl,
      '-f', 'mjpeg', // Explicitly set input format
      '-c:v', 'libx264', // Transcode MJPEG to H.264
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-r', '30', // Set frame rate
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      'tcp://127.0.0.1:',
    ];

    const server = createServer(async (socket) => {
      server.close();
      const parser = this.parseFragmentedMP4(socket);
      for await (const atom of parser) {
        const now = Date.now();
        this.preBuffer.push({ atom, time: now });
        this.preBuffer = this.preBuffer.filter(entry => entry.time > now - this.preBufferDuration);
      }
    });

    const port = await this.listenServer(server);
    args[args.length - 1] += port;

    const cp = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    cp.stderr?.on('data', (data) => this.log.debug(`PreBuffer FFmpeg stderr: ${data}`));
    cp.on('exit', () => {
      this.preBuffer = [];
      this.log.debug('Pre-buffer process exited', this.cameraName);
    });
    this.preBufferSession = { server, process: cp };
  }

  private async listenServer(server: Server): Promise<number> {
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const port = 10000 + Math.round(Math.random() * 30000);
      server.listen(port);
      try {
        await new Promise((resolve) => server.once('listening', resolve));
        return port;
      } catch (e) {
        this.log.warn(`Error listening on port ${port}: ${e}`);
      }
    }
    throw new Error('Failed to bind server after 5 attempts');
  }

  private async *parseFragmentedMP4(readable: Readable): AsyncGenerator<{ header: Buffer; type: string; length: number; data: Buffer }> {
    let pending: Buffer[] = [];
    let hasMoov = false;

    while (true) {
      const header = await this.readLength(readable, 8);
      const length = header.readInt32BE(0) - 8;
      const type = header.slice(4).toString();
      const data = await this.readLength(readable, length);
      pending.push(header, data);

      if (type === 'moov') {
        hasMoov = true;
      }
      if ((type === 'moof' && pending.length > 2) || (type === 'mdat' && hasMoov)) {
        const fragment = pending.slice(0, -2);
        if (fragment.length > 0) {
          yield { header: Buffer.concat(fragment.slice(0, 1)), type: 'segment', length: Buffer.concat(fragment).length, data: Buffer.concat(fragment.slice(1)) };
        }
        pending = [header, data];
      }
    }
  }

  private async readLength(readable: Readable, length: number): Promise<Buffer> {
    if (!length) {
      return Buffer.alloc(0);
    }
    const ret = readable.read(length);
    if (ret) {
      return ret;
    }
    return new Promise((resolve, reject) => {
      const onReadable = () => {
        const data = readable.read(length);
        if (data) {
          readable.removeListener('readable', onReadable);
          readable.removeListener('end', onEnd);
          readable.removeListener('error', onError);
          resolve(data);
        }
      };
      const onEnd = () => reject(new Error(`Stream ended during read for ${length} bytes`));
      const onError = (err: Error) => reject(err);
      readable.on('readable', onReadable);
      readable.on('end', onEnd);
      readable.on('error', onError);
    });
  }

  private determineResolution(request: SnapshotRequest): { width: number; height: number; videoFilter?: string } {
    const resInfo: { width: number; height: number; videoFilter?: string } = { width: request.width, height: request.height };
    const filters: string[] = [];
    if (resInfo.width > 0 || resInfo.height > 0) {
      const scaleFilter = `scale=${resInfo.width > 0 ? `'min(${resInfo.width},iw)'` : 'iw'}:` +
        `${resInfo.height > 0 ? `'min(${resInfo.height},ih)'` : 'ih'}:force_original_aspect_ratio=decrease`;
      filters.push(scaleFilter, 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
    }
    resInfo.videoFilter = filters.length > 0 ? filters.join(',') : undefined;
    return resInfo;
  }

  private async fetchSnapshot(videoFilter?: string): Promise<Buffer> {
    const startTime = Date.now();
    if (this.preBuffer.length > 0) {
      const latest = this.preBuffer[this.preBuffer.length - 1];
      const segment = Buffer.concat([latest.atom.header, latest.atom.data]);

      if (segment.length < 100 || !segment.includes(Buffer.from('moof'))) {
        this.log.warn('Invalid pre-buffer segment, falling back to live stream', this.cameraName);
        return this.fetchLiveSnapshot(startTime, videoFilter);
      }

      const args = [
        '-f', 'mp4',
        '-i', 'pipe:',
        '-frames:v', '1',
        '-f', 'image2',
        ...(videoFilter ? ['-filter:v', videoFilter] : []),
        'pipe:',
        '-loglevel', 'error',
      ];

      return new Promise<Buffer>((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
        ffmpeg.stdin.write(segment);
        ffmpeg.stdin.end();
        let snapshotBuffer = Buffer.alloc(0);

        ffmpeg.stdout.on('data', (data) => snapshotBuffer = Buffer.concat([snapshotBuffer, data]));
        ffmpeg.stderr.on('data', (data) => this.log.debug(`Snapshot FFmpeg stderr: ${data}`));
        ffmpeg.on('error', (err) => reject(err));
        ffmpeg.on('close', (code) => {
          if (snapshotBuffer.length > 0) {
            resolve(snapshotBuffer);
          } else {
            reject(new Error('Failed to fetch snapshot from pre-buffer'));
          }
        });
      }).catch(() => this.fetchLiveSnapshot(startTime, videoFilter));
    }
    return this.fetchLiveSnapshot(startTime, videoFilter);
  }

  private async fetchLiveSnapshot(startTime: number, videoFilter?: string): Promise<Buffer> {
    const args = [
      '-headers', `Authorization: Basic ${this.base64auth}`,
      '-i', this.streamUrl,
      '-f', 'mjpeg', // MJPEG input
      '-frames:v', '1',
      '-f', 'image2',
      ...(videoFilter ? ['-filter:v', videoFilter] : []),
      'pipe:',
      '-loglevel', 'error',
    ];

    this.snapshotPromise = new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', args, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
      let snapshotBuffer = Buffer.alloc(0);

      ffmpeg.stdout.on('data', (data) => snapshotBuffer = Buffer.concat([snapshotBuffer, data]));
      ffmpeg.stderr.on('data', (data) => this.log.debug(`Snapshot FFmpeg stderr: ${data}`));
      ffmpeg.on('error', (error) => reject(new Error(`FFmpeg process creation failed: ${error.message}`)));
      ffmpeg.on('close', (code) => {
        if (snapshotBuffer.length > 0) {
          resolve(snapshotBuffer);
        } else {
          reject(new Error('Failed to fetch snapshot'));
        }
        setTimeout(() => this.snapshotPromise = undefined, 3000);
        const runtime = (Date.now() - startTime) / 1000;
        this.log.debug(`Snapshot took ${runtime}s`, this.cameraName);
      });
    });

    return this.snapshotPromise;
  }

  async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): Promise<void> {
    const resolution = this.determineResolution(request);
    try {
      const snapshot = await (this.snapshotPromise || this.fetchSnapshot(resolution.videoFilter));
      callback(undefined, snapshot);
    } catch (err) {
      this.log.error(`Snapshot error: ${err}`, this.cameraName);
      callback(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async prepareStream(request: PrepareStreamRequest, callback: (error?: Error, response?: PrepareStreamResponse) => void): Promise<void> {
    const ipv6 = request.addressVersion === 'ipv6';
    const videoReturnPort = await pickPort({ type: 'udp', ip: ipv6 ? '::' : '0.0.0.0', reserveTimeout: 15 });
    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();
    const videoSRTP = Buffer.concat([request.video.srtp_key, request.video.srtp_salt]);

    this.pendingSessions.set(request.sessionID, {
      address: request.targetAddress,
      ipv6,
      videoPort: request.video.port,
      videoReturnPort,
      videoSRTP,
      videoSSRC,
    });

    callback(undefined, {
      video: { port: videoReturnPort, ssrc: videoSSRC, srtp_key: request.video.srtp_key, srtp_salt: request.video.srtp_salt },
    });
  }

  async handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): Promise<void> {
    if (request.type === StreamRequestTypes.START) {
      this.startStream(request as StartStreamRequest, callback);
    } else if (request.type === StreamRequestTypes.STOP) {
      this.stopStream(request.sessionID);
      callback();
    } else {
      callback();
    }
  }

  private startStream(request: StartStreamRequest, callback: StreamRequestCallback): void {
    const sessionInfo = this.pendingSessions.get(request.sessionID);
    if (!sessionInfo) {
      callback(new Error('Session not found'));
      return;
    }

    const mtu = 1378;
    const ffmpegArgs: string[] = [
      '-headers', `Authorization: Basic ${this.base64auth}\r\n`,
      '-i', this.streamUrl,
      '-f', 'mjpeg', // MJPEG input
      '-c:v', 'libx264', // Transcode to H.264
      '-pix_fmt', 'yuv420p',
      '-r', request.video.fps.toString(),
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-crf', '22',
      '-filter:v', `scale='min(${request.video.width},iw)':'min(${request.video.height},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      '-b:v', `${request.video.max_bit_rate}k`,
      '-payload_type', request.video.pt.toString(),
      '-ssrc', sessionInfo.videoSSRC.toString(),
      '-f', 'rtp',
      '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
      '-srtp_out_params', sessionInfo.videoSRTP.toString('base64'),
      `srtp://${sessionInfo.address}:${sessionInfo.videoPort}?rtcpport=${sessionInfo.videoPort}&pkt_size=${mtu}`,
    ];

    const activeSession: ActiveSession = {};
    activeSession.socket = createSocket(sessionInfo.ipv6 ? 'udp6' : 'udp4');
    activeSession.socket.bind(sessionInfo.videoReturnPort);
    activeSession.mainProcess = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

    activeSession.mainProcess.stderr?.on('data', (data) => this.log.debug(`Stream FFmpeg stderr: ${data}`));
    activeSession.mainProcess.on('exit', () => this.stopStream(request.sessionID));
    this.ongoingSessions.set(request.sessionID, activeSession);
    this.pendingSessions.delete(request.sessionID);
    callback();
  }

  public stopStream(sessionId: string): void {
    const session = this.ongoingSessions.get(sessionId);
    if (session) {
      session.socket?.close();
      session.mainProcess?.kill();
      this.ongoingSessions.delete(sessionId);
    }
  }

  updateRecordingActive(active: boolean): void {
    this.recordingActive = active;
    if (!active && this.recordingSession) {
      this.recordingSession.socket?.end();
      this.recordingSession.cp?.kill();
      this.recordingSession = undefined;
    }
  }

  updateRecordingConfiguration(configuration?: any): void {
    this.recordingConfig = configuration || {
      videoCodec: { type: 'H264', bitrate: 2000, profiles: [H264Profile.MAIN], levels: [H264Level.LEVEL4_0] },
      mediaContainerConfiguration: [{ type: MediaContainerType.FRAGMENTED_MP4, fragmentLength: 4000 }],
    };
    this.recordingActive = true;
  }

  async *handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket> {
    this.log.info(`HKSV recording stream requested for streamId: ${streamId}`, this.cameraName);
    if (!this.recordingConfig) {
      throw new this.hap.HDSProtocolError(HDSProtocolSpecificErrorReason.NOT_ALLOWED);
    }

    const server = createServer();
    const port = await this.listenServer(server);

    const args = [
      '-headers', `Authorization: Basic ${this.base64auth}`,
      '-i', this.streamUrl,
      '-f', 'mjpeg', // MJPEG input
      '-c:v', 'libx264', // Transcode to H.264
      '-r', '30',
      '-b:v', `${this.recordingConfig.videoCodec.bitrate || 2000}k`,
      '-profile:v', 'main',
      '-level', '4.0',
      '-an',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      `tcp://127.0.0.1:${port}`,
    ];

    const cp = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    cp.stderr?.on('data', (data) => this.log.debug(`Recording FFmpeg stderr: ${data}`));

    const generator = this.parseFragmentedMP4(cp.stdout as Readable);
    this.recordingSession = { socket: null as any, cp, generator };

    await new Promise((resolve) => {
      server.on('connection', (socket: NetSocket) => {
        server.close();
        this.recordingSession!.socket = socket;
        resolve(undefined);
      });
    });

    let pending: Buffer[] = [];
    const getMotionState = () =>
      this.hksvMotionSensor.getCharacteristic(this.hap.Characteristic.MotionDetected).value;

    for (const entry of this.preBuffer) {
      pending.push(entry.atom.header, entry.atom.data);
    }

    for await (const box of generator) {
      pending.push(box.header, box.data);
      if (box.type === 'moov' || box.type === 'mdat') {
        const fragment = Buffer.concat(pending);
        yield { data: fragment, isLast: !getMotionState() };
        pending = [];
        if (!getMotionState()) {
          this.log.debug('Ending recording due to motion stopped', this.cameraName);
          break;
        }
      }
    }

    cp.on('exit', () => this.recordingSession = undefined);
  }

  acknowledgeStream(streamId: number): void {
    this.log.debug(`Acknowledged recording stream ${streamId}`);
  }

  closeRecordingStream(streamId: number, reason?: HDSProtocolSpecificErrorReason): void {
    if (this.recordingSession) {
      this.recordingSession.socket?.end();
      this.recordingSession.cp?.kill();
      this.recordingSession = undefined;
    }

    if (reason && !this.isNormalReason(reason)) {
      this.hksvMotionSensor.updateCharacteristic(this.hap.Characteristic.MotionDetected, false);
    }
  }

  private isNormalReason(reason: HDSProtocolSpecificErrorReason): reason is HDSProtocolSpecificErrorReason.NORMAL {
    return reason === this.hap.HDSProtocolSpecificErrorReason.NORMAL;
  }

  private stopAll(): void {
    this.preBufferSession?.process.kill();
    this.preBufferSession?.server.close();
    this.ongoingSessions.forEach(session => {
      session.mainProcess?.kill();
      session.socket?.close();
    });
    this.ongoingSessions.clear();
    this.recordingSession?.cp.kill();
    this.recordingSession?.socket?.end();
  }

  public triggerHKSVMotion(active: boolean, resetTime = 10000): void {
    this.log.debug(`HKSV Motion Sensor ${active ? 'Active' : 'Inactive'}`, this.cameraName);
    this.hksvMotionSensor.updateCharacteristic(this.hap.Characteristic.MotionDetected, active);
    if (active) {
      clearTimeout(this.motionTimeout);
      this.motionTimeout = setTimeout(() => {
        this.hksvMotionSensor.updateCharacteristic(this.hap.Characteristic.MotionDetected, false);
        this.log.debug(`HKSV Motion Sensor reset after ${resetTime}ms`, this.cameraName);
      }, resetTime);
    }
  }
}