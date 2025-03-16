/* eslint-disable @typescript-eslint/no-explicit-any */
import {
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
  StreamRequestCallback,
  StartStreamRequest,
  MediaContainerType,
  H264Profile,
  H264Level,
  AudioRecordingCodecType,
  PlatformAccessory,
} from 'homebridge';
import { ChildProcess, spawn } from 'child_process';
import { createSocket, Socket } from 'node:dgram';
import { Readable } from 'stream';
import { LoxonePlatform } from '../../LoxonePlatform';
import { pickPort } from 'pick-port';

// Circular buffer for pre-buffer
class CircularBuffer<T> {
  private buffer: T[];
  private size: number;
  private head = 0;
  constructor(size: number) {
    this.size = size;
    this.buffer = new Array(size);
  }

  push(item: T) {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.size;
  }

  get(): T[] {
    const start = this.head;
    return [...this.buffer.slice(start), ...this.buffer.slice(0, start)].filter(Boolean);
  }
}

interface PreBufferEntry { data: Buffer; timestamp: number; isKeyFrame: boolean }
interface ActiveSession { process?: ChildProcess; socket?: Socket; timeout?: NodeJS.Timeout }

export class CameraService implements CameraStreamingDelegate, CameraRecordingDelegate {
  private readonly hap: HAP;
  private readonly log: LoxonePlatform['log'];
  private readonly streamUrl: string;
  private readonly base64auth?: string;
  public readonly controller: CameraController;
  private preBuffer = new CircularBuffer<PreBufferEntry>(100); // Fixed size
  private preBufferDuration = 4000;
  private snapshotCache?: { data: Buffer; timestamp: number };
  private pendingSessions = new Map<string, {
    address: string;
    ipv6: boolean;
    videoPort: number;
    videoReturnPort: number;
    videoSRTP: Buffer;
    videoSSRC: number;
  }>();

  private ongoingSessions = new Map<string, ActiveSession>();
  private recordingProcess?: ChildProcess;
  private recordingConfig?: any = {
    videoCodec: {
      type: 'H264',
      bitrate: 2000,
      profiles: [H264Profile.MAIN],
      levels: [H264Level.LEVEL4_0],
    },
    mediaContainerConfiguration: [
      { type: MediaContainerType.FRAGMENTED_MP4, fragmentLength: 4000 },
    ],
  };

  private ffmpegPreBuffer?: ChildProcess;

  constructor(platform: LoxonePlatform, accessory: PlatformAccessory, streamUrl: string, base64auth?: string) {
    this.hap = platform.api.hap;
    this.log = platform.log;
    this.streamUrl = streamUrl;
    this.base64auth = base64auth;

    const options: CameraControllerOptions = {
      cameraStreamCount: 20,
      delegate: this,
      streamingOptions: {
        supportedCryptoSuites: [this.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          codec: {
            profiles: [this.hap.H264Profile.MAIN],
            levels: [this.hap.H264Level.LEVEL4_0],
          },
          resolutions: [[320, 180, 30], [1280, 720, 30]],
        },
      },
      recording: {
        options: {
          prebufferLength: this.preBufferDuration,
          mediaContainerConfiguration: [
            { type: MediaContainerType.FRAGMENTED_MP4, fragmentLength: 4000 },
          ],
          video: {
            type: this.hap.VideoCodecType.H264,
            resolutions: [[1280, 720, 30]],
            parameters: { profiles: [H264Profile.MAIN], levels: [H264Level.LEVEL4_0] },
          },
          audio: {
            codecs: [
              { type: AudioRecordingCodecType.AAC_LC, samplerate: this.hap.AudioRecordingSamplerate.KHZ_32 },
            ],
          },
        },
        delegate: this,
      },
    };

    this.controller = new this.hap.CameraController(options);
    accessory.configureController(this.controller);
    this.startPreBufferStream();
    platform.api.on('shutdown' as any, () => this.stopAll());
  }

  private startPreBufferStream(): void {
    const args = ['-headers', `Authorization: Basic ${this.base64auth}`, '-i', this.streamUrl, '-c:v', 'libx264', '-r', '30', '-b:v', '2000k', '-g', '15', '-keyint_min', '15', '-x264-params', 'keyint=15:min-keyint=15:scenecut=0', '-f', 'h264', 'pipe:'];
    this.ffmpegPreBuffer = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.ffmpegPreBuffer.stdout!.on('data', (chunk: Buffer) => this.processPreBuffer(chunk));
    this.ffmpegPreBuffer.stderr!.on('data', (data) => this.log.debug(`PreBuffer: ${data}`));
    this.ffmpegPreBuffer.on('exit', () => this.preBuffer = new CircularBuffer(100));
  }

  private processPreBuffer(chunk: Buffer): void {
    let buffer = chunk;
    while (buffer.length >= 5) {
      const nalStart = buffer.indexOf(Buffer.from([0, 0, 0, 1]));
      if (nalStart === -1) {
        break;
      }
      const nalEnd = buffer.indexOf(Buffer.from([0, 0, 0, 1]), nalStart + 4) || buffer.length;
      const nalUnit = buffer.slice(nalStart, nalEnd);
      const now = Date.now();
      const isKeyFrame = (nalUnit[4] & 0x1F) === 5 || (nalUnit[4] & 0x1F) === 7;
      this.preBuffer.push({ data: nalUnit, timestamp: now, isKeyFrame });
      if (isKeyFrame && (!this.snapshotCache || now - this.snapshotCache.timestamp > 5000)) {
        this.updateSnapshot();
      }
      buffer = buffer.slice(nalEnd);
    }
  }

  private async updateSnapshot(): Promise<void> {
    const snapshot = await this.extractSnapshot();
    if (snapshot.length) {
      this.snapshotCache = { data: snapshot, timestamp: Date.now() };
    }
  }

  private async extractSnapshot(): Promise<Buffer> {
    const entries = this.preBuffer.get();
    const startIdx = entries.findIndex(e => e.isKeyFrame);
    if (startIdx === -1) {
      return Buffer.alloc(0);
    }
    const h264Data = Buffer.concat(entries.slice(startIdx).map(e => e.data));
    const ffmpeg = spawn('ffmpeg', ['-i', 'pipe:', '-f', 'image2', '-frames:v', '1', '-c:v', 'mjpeg', 'pipe:'], { stdio: ['pipe', 'pipe', 'pipe'] });
    ffmpeg.stdin.write(h264Data);
    ffmpeg.stdin.end();
    return new Promise((resolve) => {
      let data = Buffer.alloc(0);
      ffmpeg.stdout.on('data', (chunk) => data = Buffer.concat([data, chunk]));
      ffmpeg.on('close', () => resolve(data));
    });
  }

  async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): Promise<void> {
    if (this.snapshotCache && Date.now() - this.snapshotCache.timestamp < 5000) {
      return callback(undefined, this.snapshotCache.data);
    }
    const snapshot = await this.extractSnapshot().catch(() => this.generateSnapshot());
    callback(undefined, snapshot);
  }

  private generateSnapshot(): Promise<Buffer> {
    return new Promise((resolve) => {
      const cp = spawn('ffmpeg', ['-headers', `Authorization: Basic ${this.base64auth}`, '-i', this.streamUrl, '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:'], { stdio: ['pipe', 'pipe', 'pipe'] });
      let data = Buffer.alloc(0);
      cp.stdout.on('data', (chunk) => data = Buffer.concat([data, chunk]));
      cp.on('close', () => resolve(data));
    });
  }

  async prepareStream(request: PrepareStreamRequest, callback: (error?: Error, response?: PrepareStreamResponse) => void): Promise<void> {
    const ipv6 = request.addressVersion === 'ipv6';
    const videoReturnPort = await pickPort({ type: 'udp', ip: ipv6 ? '::' : '0.0.0.0', reserveTimeout: 15 });
    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();
    const videoSRTP = Buffer.concat([request.video.srtp_key, request.video.srtp_salt]);
    this.pendingSessions.set(request.sessionID, { address: request.targetAddress, ipv6, videoPort: request.video.port, videoReturnPort, videoSRTP, videoSSRC });
    callback(undefined, { video: { port: videoReturnPort, ssrc: videoSSRC, srtp_key: request.video.srtp_key, srtp_salt: request.video.srtp_salt } });
  }

  async handleStreamRequest(request: StartStreamRequest, callback: StreamRequestCallback): Promise<void> {
    if (request.type === 'start') {
      this.startStream(request, callback);
    } else if (request.type === 'stop') {
      this.stopStream(request.sessionID, callback);
    }
  }

  private startStream(request: StartStreamRequest, callback: StreamRequestCallback): void {
    const sessionInfo = this.pendingSessions.get(request.sessionID);
    if (!sessionInfo) {
      return callback(new Error('Session not found'));
    }
    const args = ['-headers', `Authorization: Basic ${this.base64auth}`, '-i', this.streamUrl, '-c:v', 'libx264', '-r', request.video.fps.toString(), '-b:v', `${request.video.max_bit_rate}k`, '-g', '15', '-keyint_min', '15', '-x264-params', 'keyint=15:min-keyint=15', '-f', 'rtp', '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80', '-srtp_out_params', sessionInfo.videoSRTP.toString('base64'), `srtp://${sessionInfo.address}:${sessionInfo.videoPort}?rtcpport=${sessionInfo.videoPort}&pkt_size=1378`];
    const cp = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const socket = createSocket(sessionInfo.ipv6 ? 'udp6' : 'udp4').bind(sessionInfo.videoReturnPort);
    const session: ActiveSession = { process: cp, socket, timeout: setTimeout(() => this.stopStream(request.sessionID, callback), request.video.rtcp_interval * 5000) };
    socket.on('message', () => session.timeout && (clearTimeout(session.timeout), session.timeout = setTimeout(() => this.stopStream(request.sessionID, callback), request.video.rtcp_interval * 5000)));
    cp.on('exit', () => this.stopStream(request.sessionID, callback));
    this.ongoingSessions.set(request.sessionID, session);
    this.pendingSessions.delete(request.sessionID);
    callback();
  }

  private stopStream(sessionId: string, callback?: StreamRequestCallback): void {
    const session = this.ongoingSessions.get(sessionId);
    if (session) {
      session.timeout && clearTimeout(session.timeout);
      session.socket?.close();
      session.process?.kill();
      this.ongoingSessions.delete(sessionId);
    }
    callback?.();
  }

  updateRecordingActive(active: boolean): void {
    if (!active) {
      this.recordingProcess?.kill();
    }
  }

  updateRecordingConfiguration(configuration?: any): void {
    if (configuration) {
      this.recordingConfig = { ...this.recordingConfig, ...configuration };
    }
  }

  async *handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket> {
    if (!this.recordingConfig) {
      throw new this.hap.HDSProtocolError(HDSProtocolSpecificErrorReason.NOT_ALLOWED);
    }
    const preBufferData = Buffer.concat(this.preBuffer.get().filter(e => e.timestamp > Date.now() - this.preBufferDuration && e.isKeyFrame).map(e => e.data));
    const args = ['-headers', `Authorization: Basic ${this.base64auth}`, '-i', this.streamUrl, '-c:v', 'libx264', '-r', '30', '-b:v', `${this.recordingConfig.videoCodec.bitrate}k`, '-g', '15', '-keyint_min', '15', '-f', 'mp4', '-frag_duration', '4000000', 'pipe:'];
    this.recordingProcess = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.recordingProcess.stdin?.write(preBufferData);
    const stream = this.recordingProcess.stdout as Readable;
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length > 0) {
        const moofBox = buffer.indexOf(Buffer.from('moof', 'ascii'));
        if (moofBox === -1 || buffer.length < moofBox + 8) {
          break;
        }
        const fragmentSize = buffer.readUInt32BE(moofBox - 4);
        if (buffer.length >= moofBox + fragmentSize) {
          yield { data: buffer.slice(0, moofBox + fragmentSize), isLast: false };
          buffer = buffer.slice(moofBox + fragmentSize);
        } else {
          break;
        }
      }
    }
    yield { data: Buffer.alloc(0), isLast: true };
    this.recordingProcess?.kill();
  }

  closeRecordingStream(streamId: number): void {
    this.recordingProcess?.kill();
  }

  private stopAll(): void {
    this.ffmpegPreBuffer?.kill();
    this.ongoingSessions.forEach(s => (s.process?.kill(), s.socket?.close()));
    this.ongoingSessions.clear();
    this.recordingProcess?.kill();
  }
}