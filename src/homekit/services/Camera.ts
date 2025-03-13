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
  StartStreamRequest,
  StreamRequestTypes,
  MediaContainerType,
  H264Profile,
  H264Level,
} from 'homebridge';
import { ChildProcess, spawn } from 'child_process';
import { LoxonePlatform } from '../../LoxonePlatform';
import { once } from 'events';
import { Readable } from 'stream';
import { AddressInfo, createServer } from 'net';

interface PreBufferEntry {
  data: Buffer;
  timestamp: number;
  isKeyFrame: boolean;
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
  private preBufferDuration = 4000;
  private snapshotCache?: { data: Buffer; timestamp: number };

  private activeStreams: Map<string, {
    cp: ChildProcess | null;
    port: number;
    address: string;
    videoSRTP: Buffer;
    videoSSRC: number;
  }> = new Map();

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
            profiles: [this.hap.H264Profile.BASELINE, this.hap.H264Profile.MAIN, this.hap.H264Profile.HIGH],
            levels: [this.hap.H264Level.LEVEL3_1, this.hap.H264Level.LEVEL3_2, this.hap.H264Level.LEVEL4_0],
          },
          resolutions,
        },
        // Audio removed since FFmpeg uses -an
      },
      recording: {
        options: {
          prebufferLength: this.preBufferDuration,
          mediaContainerConfiguration: [{ type: MediaContainerType.FRAGMENTED_MP4, fragmentLength: 4000 }],
          video: {
            type: this.hap.VideoCodecType.H264,
            resolutions: [[1920, 1080, 30], [1280, 720, 30]],
            parameters: {
              profiles: [H264Profile.BASELINE, H264Profile.MAIN, H264Profile.HIGH],
              levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
            },
          },
          audio: {
            codecs: [
              {
                type: this.hap.AudioRecordingCodecType.AAC_ELD, // or another supported codec
                samplerate: this.hap.AudioRecordingSamplerate.KHZ_16, // kHz, minimum valid value
              },
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

  private async startPreBufferStream(): Promise<void> {
    const args = [
      '-headers', `Authorization: Basic ${this.base64auth}`,
      '-i', this.streamUrl,
      '-c:v', 'libx264',
      '-r', '30',
      '-b:v', '2000k',
      '-f', 'tee',
      '-map', '0:v',
      '[f=mp4:movflags=frag_keyframe+empty_moov+default_base_moof]pipe:1',
    ];

    try {
      this.log.debug(`Starting pre-buffer with args: ${args.join(' ')}`);
      this.ffmpegProcess = spawn('ffmpeg', args, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      this.log.error(`Failed to spawn FFmpeg for pre-buffer: ${err}`);
      throw err;
    }
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
      this.log.debug(`Buffer size: ${buffer.length}, First 8 bytes: ${buffer.slice(0, 8).toString('hex')}`);
      while (buffer.length >= 8) {
        const length = buffer.readUInt32BE(0);
        if (buffer.length >= length) {
          const atom = buffer.slice(0, length);
          const type = atom.slice(4, 8).toString();
          const now = Date.now();
          if (type === 'mdat') {
            this.log.debug(`Pre-buffer mdat atom: ${atom.length} bytes`);
            this.preBuffer.push({ data: atom, timestamp: now, isKeyFrame: this.isKeyFrame(atom) });
            this.preBuffer = this.preBuffer.filter(entry => entry.timestamp > now - this.preBufferDuration);
            if (!this.snapshotCache || this.snapshotCache.timestamp < now - 5000) {
              this.snapshotCache = { data: this.extractSnapshot(), timestamp: now };
            }
          }
          buffer = buffer.slice(length);
        } else {
          break;
        }
      }
    });
  }

  private isKeyFrame(atom: Buffer): boolean {
    const data = atom.slice(8);
    return data.length > 4 && (data[4] & 0x1F) === 5;
  }

  private extractSnapshot(): Buffer {
    const latestKeyFrame = this.preBuffer
      .filter(entry => entry.isKeyFrame)
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (latestKeyFrame) {
      this.log.debug(`Extracted snapshot from key frame, size: ${latestKeyFrame.data.length} bytes`);
      return latestKeyFrame.data;
    }
    this.log.warn('No key frame found for snapshot');
    return Buffer.alloc(0);
  }

  async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): Promise<void> {
    this.log.debug(`Snapshot requested: ${request.width} x ${request.height}`);

    if (this.snapshotCache && this.snapshotCache.timestamp > Date.now() - 5000 && this.snapshotCache.data.length > 0) {
      this.log.debug('Returning cached snapshot');
      return callback(undefined, this.snapshotCache.data);
    }

    try {
      const snapshot = await this.generateSnapshot();
      if (snapshot.length > 0) {
        this.snapshotCache = { data: snapshot, timestamp: Date.now() };
        callback(undefined, snapshot);
      } else {
        throw new Error('Generated snapshot is empty');
      }
    } catch (err) {
      this.log.error(`Snapshot generation failed: ${err}`);
      callback(err instanceof Error ? err : new Error('Snapshot failed'));
    }
  }

  private async generateSnapshot(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const args = [
        '-re',
        '-headers', `Authorization: Basic ${this.base64auth}\r\n`,
        '-i', this.streamUrl,
        '-frames:v', '1',
        '-f', 'image2',
        '-',
      ];
      const cp = spawn('ffmpeg', args, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });

      const snapshotBuffers: Buffer[] = [];
      cp.stdout.on('data', (data) => snapshotBuffers.push(data));
      cp.stderr.on('data', (data) => this.log.info(`Snapshot FFmpeg: ${data}`));
      cp.on('exit', (code, signal) => {
        if (signal) {
          reject(new Error(`Snapshot process killed with signal: ${signal}`));
        } else if (code === 0) {
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
    const port = await this.reservePort();
    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();
    const videoSRTP = Buffer.concat([request.video.srtp_key, request.video.srtp_salt]);
    const address = request.targetAddress || '127.0.0.1';
    this.activeStreams.set(request.sessionID, { cp: null, port, address, videoSRTP, videoSSRC });
    this.log.debug(`Prepared stream - Session: ${request.sessionID}, Address: ${address}, Port: ${port}, ` +
      `Video SRTP: ${videoSRTP.toString('base64')}, Video SSRC: ${videoSSRC}`);
    callback(undefined, {
      video: { port, ssrc: videoSSRC, srtp_key: request.video.srtp_key, srtp_salt: request.video.srtp_salt },
    });
  }

  async handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): Promise<void> {
    switch (request.type) {
      case StreamRequestTypes.START:
        await this.startStream(request as StartStreamRequest, callback);
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

  private async startStream(request: StartStreamRequest, callback: StreamRequestCallback): Promise<void> {
    const session = this.activeStreams.get(request.sessionID);
    if (!session) {
      this.log.error('Session not found for streaming');
      return callback(new Error('Session not found'));
    }

    const mtu = request.video.mtu || 1316;
    const ffmpegArgs: string[] = [
      '-headers', `Authorization: Basic ${this.base64auth}\r\n`,
      '-use_wallclock_as_timestamps', '1',
      '-probesize', '32',
      '-analyzeduration', '0',
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-max_delay', '0',
      '-re',
      '-i', this.streamUrl,
      '-an', '-sn', '-dn',
      '-codec:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-color_range', 'mpeg',
      '-r', request.video.fps.toString(),
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-b:v', `${request.video.max_bit_rate}k`,
      '-maxrate', `${request.video.max_bit_rate}k`,
      '-bufsize', `${request.video.max_bit_rate * 2}k`,
      '-filter:v', 'scale=\'min(1280,iw)\':\'min(720,ih)\':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-payload_type', '99',
      '-ssrc', `${session.videoSSRC}`,
      '-f', 'rtp',
      '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
      '-srtp_out_params', session.videoSRTP.toString('base64'),
      `srtp://${session.address}:${session.port}?rtcpport=${session.port}&pkt_size=${mtu}`,
    ];

    this.log.debug(`Starting stream with args: ${ffmpegArgs.join(' ')}`);
    const cp = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    session.cp = cp;

    cp.stderr.on('data', (data) => this.log.debug(`Stream FFmpeg stderr: ${data}`));
    cp.on('error', (err) => {
      this.log.error(`Stream FFmpeg error: ${err}`, this.cameraName);
      callback(err as Error);
    });
    cp.on('exit', (code) => {
      this.log.debug(`Stream FFmpeg exited with code ${code}`);
      this.stopStream(request.sessionID);
    });

    const waitForOutput = new Promise<void>((resolve, reject) => {
      let hasOutput = false;
      cp.stderr.on('data', (data) => {
        const stderr = data.toString();
        this.log.debug(`Stream FFmpeg stderr: ${stderr}`);
        if (stderr.includes('frame=') && stderr.match(/frame=\s*\d+/)[0] !== 'frame=    0') {
          hasOutput = true;
          this.log.debug('Stream FFmpeg started outputting frames');
          resolve();
        } else if (stderr.includes('error') || stderr.includes('failed')) {
          reject(new Error(`FFmpeg error: ${stderr}`));
        }
      });
      cp.on('error', (err) => reject(err));
      setTimeout(() => {
        if (!hasOutput) {
          reject(new Error('Stream FFmpeg output wait timeout reached with no frames'));
        } else {
          resolve();
        }
      }, 5000);
    });

    try {
      await waitForOutput;
      this.log.debug('Stream callback triggered');
      callback();
    } catch (err) {
      this.log.error(`Failed to start stream: ${err}`);
      callback(err as Error);
      return;
    }
  }

  private stopStream(sessionId: string): void {
    const session = this.activeStreams.get(sessionId);
    if (session && session.cp) {
      session.cp.kill();
      this.activeStreams.delete(sessionId);
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
    this.log.debug('Recording config updated', this.cameraName);
  }

  async *handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket> {
    if (!this.recordingActive || !this.recordingConfig) {
      throw new this.hap.HDSProtocolError(HDSProtocolSpecificErrorReason.NOT_ALLOWED);
    }

    this.log.info(`Starting recording stream ${streamId}`, this.cameraName);
    const cp = this.startRecording(this.recordingConfig);
    const stream = cp.stdout as Readable;
    let buffer = Buffer.alloc(0);

    try {
      cp.stderr?.on('data', (data) => this.log.debug(`Recording FFmpeg stderr: ${data}`));
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 8) {
          const length = buffer.readUInt32BE(0);
          if (buffer.length >= length) {
            const fragment = buffer.slice(0, length);
            yield { data: fragment, isLast: false };
            buffer = buffer.slice(length);
          } else {
            break;
          }
        }
      }
    } finally {
      cp.kill();
      this.log.info(`Recording stream ${streamId} ended`, this.cameraName);
    }
  }

  private startRecording(config: any): ChildProcess {
    const videoArgs = [
      '-c:v', 'libx264',
      '-r', config.videoCodec.resolution[2].toString(),
      '-b:v', `${config.videoCodec.bitrate}k`,
    ];
    const preBufferInput = this.getPreBufferVideo();
    const args = [
      '-f', 'mp4',
      '-i', 'pipe:',
      ...videoArgs,
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      'pipe:',
    ];
    this.log.debug(`Starting recording with args: ${args.join(' ')}`);
    const cp = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    cp.stdin.write(preBufferInput);
    cp.stdin.end();
    return cp;
  }

  private getPreBufferVideo(): Buffer {
    const now = Date.now();
    const filtered = this.preBuffer.filter(entry => entry.timestamp > now - this.preBufferDuration);
    const startIdx = filtered.findIndex(entry => entry.isKeyFrame);
    return Buffer.concat(filtered.slice(startIdx).map(entry => entry.data));
  }

  acknowledgeStream(streamId: number): void {
    this.log.debug(`Acknowledged stream ${streamId}`, this.cameraName);
  }

  closeRecordingStream(streamId: number, reason?: HDSProtocolSpecificErrorReason): void {
    this.log.debug(`Closed stream ${streamId} with reason: ${reason}`, this.cameraName);
  }

  private async reservePort(): Promise<number> {
    const server = createServer();
    server.listen(0);
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;
    server.close();
    return port;
  }

  private stopAll(): void {
    this.ffmpegProcess?.kill();
    this.activeStreams.forEach(session => {
      if (session.cp) {
        session.cp.kill();
      }
    });
    this.activeStreams.clear();
  }

  private stopAllRecordings(): void {
    // No additional cleanup needed
  }
}