import {
  APIEvent,
  CameraRecordingConfiguration,
  CameraRecordingDelegate,
  HAP,
  HDSProtocolSpecificErrorReason,
  RecordingPacket,
  H264Level,
  H264Profile,
} from 'homebridge';
import type { Logger } from 'homebridge';
import { spawn, ChildProcess } from 'child_process';
import { Server, AddressInfo } from 'net';
import { Readable } from 'stream';
import { once } from 'events';
import { Buffer } from 'buffer';
import { env } from 'process';
import { LoxonePlatform } from '../../LoxonePlatform';
import { PreBuffer, Mp4Session } from './Prebuffer';

export interface MP4Atom {
  header: Buffer;
  length: number;
  type: string;
  data: Buffer;
}

export interface FFMpegFragmentedMP4Session {
  generator: AsyncGenerator<MP4Atom>;
  cp: ChildProcess;
}

export const PREBUFFER_LENGTH = 4000;

export async function listenServer(server: Server, log: Logger): Promise<number> {
  let isListening = false;
  while (!isListening) {
    const port = 10000 + Math.round(Math.random() * 30000);
    server.listen(port);
    try {
      await once(server, 'listening');
      const address = server.address() as AddressInfo;
      isListening = true;
      return address.port;
    } catch (e: unknown) {
      log.error('Error while listening to the server:', e);
    }
  }
  return 0;
}

export async function readLength(readable: Readable, length: number): Promise<Buffer> {
  if (!length) {
    return Buffer.alloc(0);
  }
  const ret = readable.read(length);
  if (ret) {
    return ret;
  }

  return new Promise((resolve, reject) => {
    const r = (): void => {
      const data = readable.read(length);
      if (data) {
        cleanup();
        resolve(data);
      }
    };
    const e = (): void => {
      cleanup();
      reject(new Error(`stream ended during read for minimum ${length} bytes`));
    };
    const cleanup = (): void => {
      readable.removeListener('readable', r);
      readable.removeListener('end', e);
    };
    readable.on('readable', r);
    readable.on('end', e);
  });
}

export async function* parseFragmentedMP4(readable: Readable): AsyncGenerator<MP4Atom> {
  while (true) {
    const header = await readLength(readable, 8);
    const length = header.readInt32BE(0) - 8;
    const type = header.slice(4).toString();
    const data = await readLength(readable, length);
    yield { header, length, type, data };
  }
}

export class RecordingDelegate implements CameraRecordingDelegate {
  private readonly hap: HAP;
  private readonly log: Logger;
  private readonly videoProcessor: string;
  private readonly streamUrl: string;
  private readonly base64auth: string;

  private preBufferSession?: Mp4Session;
  private preBuffer?: PreBuffer;
  private currentRecordingConfiguration?: CameraRecordingConfiguration;
  private activeFFmpegProcesses = new Map<number, ChildProcess>();
  private streamAbortControllers = new Map<number, AbortController>();

  constructor(
    private readonly platform: LoxonePlatform,
    streamUrl: string,
    base64auth: string,
  ) {
    this.log = platform.log;
    this.hap = platform.api.hap;
    this.videoProcessor = 'ffmpeg';
    this.streamUrl = streamUrl;
    this.base64auth = base64auth;

    platform.api.on(APIEvent.SHUTDOWN, () => {
      this.preBufferSession?.process?.kill();
      this.preBufferSession?.server?.close();
      this.activeFFmpegProcesses.forEach(proc => proc.kill('SIGTERM'));
      this.activeFFmpegProcesses.clear();
      this.streamAbortControllers.clear();
    });
  }

  updateRecordingActive(active: boolean): Promise<void> {
    this.log.info(`Recording active status changed to: ${active}`, this.streamUrl);
    return Promise.resolve();
  }

  updateRecordingConfiguration(config: CameraRecordingConfiguration | undefined): Promise<void> {
    this.log.info('Recording configuration updated', this.streamUrl);
    this.currentRecordingConfiguration = config;
    return Promise.resolve();
  }

  async *handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket> {
    this.log.info(`Recording stream request received for stream ID: ${streamId}`, this.streamUrl);
    if (!this.currentRecordingConfiguration) {
      this.log.error('No recording configuration available', this.streamUrl);
      return;
    }

    const abortController = new AbortController();
    this.streamAbortControllers.set(streamId, abortController);

    try {
      await this.startPreBuffer();
      const fragmentGenerator = this.handleFragmentsRequests(this.currentRecordingConfiguration, streamId);
      let fragmentCount = 0;
      let totalBytes = 0;
      for await (const fragmentBuffer of fragmentGenerator) {
        if (abortController.signal.aborted) {
          break;
        }
        fragmentCount++;
        totalBytes += fragmentBuffer.length;
        this.log.debug(`Fragment #${fragmentCount}, size: ${fragmentBuffer.length}, total: ${totalBytes}`, this.streamUrl);
        yield { data: fragmentBuffer, isLast: false };
      }
    } catch (error) {
      this.log.error(`Recording stream error: ${error}`, this.streamUrl);
      yield { data: Buffer.alloc(0), isLast: true };
    } finally {
      this.streamAbortControllers.delete(streamId);
    }
  }

  closeRecordingStream(streamId: number, reason?: HDSProtocolSpecificErrorReason): void {
    this.log.info(`Recording stream closed for stream ID: ${streamId}, reason: ${reason}`, this.streamUrl);
    this.streamAbortControllers.get(streamId)?.abort();
    this.streamAbortControllers.delete(streamId);

    const process = this.activeFFmpegProcesses.get(streamId);
    if (process && !process.killed) {
      process.kill('SIGTERM');
    }
    this.activeFFmpegProcesses.delete(streamId);
  }

  async startPreBuffer(): Promise<void> {
    this.log.info(`Starting prebuffer for ${this.streamUrl}`);
    if (!this.preBuffer) {
      const ffmpegInput = [
        '-headers', `Authorization: Basic ${this.base64auth}\\r\\n`,
        '-i', this.streamUrl,
      ];
      this.preBuffer = new PreBuffer(ffmpegInput, this.streamUrl, this.videoProcessor, this.log);
      this.preBufferSession = await this.preBuffer.startPreBuffer();
    }
  }

  async *handleFragmentsRequests(config: CameraRecordingConfiguration, streamId: number): AsyncGenerator<Buffer> {
    if (!this.preBuffer) {
      throw new Error('No video source configured');
    }

    const input = await this.preBuffer.getVideo(config.mediaContainerConfiguration.fragmentLength ?? PREBUFFER_LENGTH);

    const videoArgs = [
      '-vcodec', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-profile:v', config.videoCodec.parameters.profile === H264Profile.HIGH ? 'high' : 'main',
      '-level:v', config.videoCodec.parameters.level === H264Level.LEVEL4_0 ? '4.0' : '3.1',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-b:v', '600k',
      '-maxrate', '700k',
      '-bufsize', '1400k',
      '-g', '30',
      '-keyint_min', '15',
      '-sc_threshold', '0',
      '-force_key_frames', 'expr:gte(t,n_forced*1)',
    ];

    const session = await this.startFFMPegFragmetedMP4Session(this.videoProcessor, input, videoArgs);
    const { cp, generator } = session;
    this.activeFFmpegProcesses.set(streamId, cp);

    let moofBuffer: Buffer | null = null;
    let pending: Buffer[] = [];
    let isFirst = true;

    try {
      for await (const box of generator) {
        pending.push(box.header, box.data);
        if (isFirst && box.type === 'moov') {
          yield Buffer.concat(pending);
          pending = [];
          isFirst = false;
        } else if (box.type === 'moof') {
          moofBuffer = Buffer.concat([box.header, box.data]);
        } else if (box.type === 'mdat' && moofBuffer) {
          const fragment = Buffer.concat([moofBuffer, box.header, box.data]);
          yield fragment;
          moofBuffer = null;
        }
      }
    } finally {
      if (!cp.killed) {
        cp.kill('SIGTERM');
      }
      this.activeFFmpegProcesses.delete(streamId);
    }
  }

  private async startFFMPegFragmetedMP4Session(
    ffmpegPath: string,
    input: string[],
    outputArgs: string[],
  ): Promise<FFMpegFragmentedMP4Session> {
    const args = ['-hide_banner', ...input,
      '-f', 'mp4',
      ...outputArgs,
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset',
      'pipe:1'];

    const cp = spawn(ffmpegPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });

    if (cp.stderr) {
      cp.stderr.on('data', data => {
        const msg = data.toString();
        if (msg.includes('moov') || msg.includes('error')) {
          this.log.warn(`[FFmpeg stderr]: ${msg.trim()}`);
        }
      });
    }

    async function* generator() {
      while (true) {
        const header = await readLength(cp.stdout!, 8);
        const length = header.readInt32BE(0) - 8;
        const type = header.slice(4).toString();
        const data = await readLength(cp.stdout!, length);
        yield { header, length, type, data };
      }
    }

    return { cp, generator: generator() };
  }
}