import {
  APIEvent,
  AudioRecordingCodecType,
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
      isListening = true;
      const address = server.address() as AddressInfo;
      return address.port;
    } catch (e: any) {
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
  private readonly cameraName: string;
  private readonly videoProcessor: string;
  private preBufferSession?: Mp4Session;
  private preBuffer?: PreBuffer;
  private currentRecordingConfiguration?: CameraRecordingConfiguration;
  private activeFFmpegProcesses = new Map<number, ChildProcess>();
  private streamAbortControllers = new Map<number, AbortController>();

  constructor(private readonly platform: LoxonePlatform, ip: string) {
    this.log = platform.log;
    this.hap = platform.api.hap;
    this.cameraName = ip;
    this.videoProcessor = 'ffmpeg';

    const ffmpegInput = `-f mjpeg -re -i ${ip}/mjpg/video.mjpg`;
    this.preBuffer = new PreBuffer(ffmpegInput, this.cameraName, this.videoProcessor, this.log);
    void this.startPreBuffer();

    platform.api.on(APIEvent.SHUTDOWN, () => {
      if (this.preBufferSession) {
        this.preBufferSession.process?.kill();
        this.preBufferSession.server?.close();
      }
      this.activeFFmpegProcesses.forEach(proc => {
        if (!proc.killed) {
          proc.kill('SIGTERM');
        }
      });
      this.activeFFmpegProcesses.clear();
      this.streamAbortControllers.clear();
    });
  }

  updateRecordingActive(active: boolean): Promise<void> {
    this.log.info(`Recording active status changed to: ${active}`, this.cameraName);
    return Promise.resolve();
  }

  updateRecordingConfiguration(configuration: CameraRecordingConfiguration | undefined): Promise<void> {
    this.log.info('Recording configuration updated', this.cameraName);
    this.currentRecordingConfiguration = configuration;
    return Promise.resolve();
  }

  async startPreBuffer(): Promise<void> {
    this.log.info(`start prebuffer ${this.cameraName}`);
    if (!this.preBuffer) {
      return;
    }
    if (!this.preBufferSession) {
      this.preBufferSession = await this.preBuffer.startPreBuffer();
    }
  }

  async *handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket> {
    this.log.info(`Recording stream request received for stream ID: ${streamId}`, this.cameraName);
    if (!this.currentRecordingConfiguration) {
      this.log.error('No recording configuration available', this.cameraName);
      return;
    }
    const abortController = new AbortController();
    this.streamAbortControllers.set(streamId, abortController);

    try {
      const fragmentGenerator = this.handleFragmentsRequests(this.currentRecordingConfiguration, streamId);
      for await (const fragmentBuffer of fragmentGenerator) {
        if (abortController.signal.aborted) {
          break;
        }
        yield { data: fragmentBuffer, isLast: false };
      }
    } catch (error) {
      this.log.error(`Recording stream error: ${error}`, this.cameraName);
      yield { data: Buffer.alloc(0), isLast: true };
    } finally {
      this.streamAbortControllers.delete(streamId);
    }
  }

  closeRecordingStream(streamId: number, reason: HDSProtocolSpecificErrorReason | undefined): void {
    this.log.info(`Recording stream closed for stream ID: ${streamId}, reason: ${reason}`, this.cameraName);
    const abortController = this.streamAbortControllers.get(streamId);
    if (abortController) {
      abortController.abort();
      this.streamAbortControllers.delete(streamId);
    }
    const process = this.activeFFmpegProcesses.get(streamId);
    if (process && !process.killed) {
      process.kill('SIGTERM');
      this.activeFFmpegProcesses.delete(streamId);
    }
  }

  async *handleFragmentsRequests(configuration: CameraRecordingConfiguration, streamId: number): AsyncGenerator<Buffer> {
    if (!this.preBuffer) {
      throw new Error('No prebuffer configured');
    }

    const profile = configuration.videoCodec.parameters.profile === H264Profile.HIGH ? 'high'
      : configuration.videoCodec.parameters.profile === H264Profile.MAIN ? 'main' : 'baseline';

    const level = configuration.videoCodec.parameters.level === H264Level.LEVEL4_0 ? '4.0'
      : configuration.videoCodec.parameters.level === H264Level.LEVEL3_2 ? '3.2' : '3.1';

    const audioArgs: string[] = [
      '-acodec', 'aac',
      ...(configuration.audioCodec.type === AudioRecordingCodecType.AAC_LC
        ? ['-profile:a', 'aac_low']
        : ['-profile:a', 'aac_eld']),
      '-ar', '32000',
      '-b:a', `${configuration.audioCodec.bitrate}k`,
      '-ac', `${configuration.audioCodec.audioChannels}`,
    ];

    const videoArgs: string[] = [
      '-an', '-sn', '-dn',
      '-vcodec', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-profile:v', profile,
      '-level:v', level,
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

    const idx = videoArgs.indexOf('-an');
    if (configuration.audioCodec && idx !== -1) {
      videoArgs.splice(idx, 1, ...audioArgs);
    }

    const ffmpegInput = await this.preBuffer.getVideo(PREBUFFER_LENGTH);
    const session = await this.startFFMPegFragmentedMP4Session(this.videoProcessor, ffmpegInput, videoArgs);
    const { cp, generator } = session;
    this.activeFFmpegProcesses.set(streamId, cp);

    let moofBuffer: Buffer | null = null;
    let isFirstFragment = true;
    const pending: Buffer[] = [];

    try {
      for await (const box of generator) {
        const { header, type, data } = box;
        pending.push(header, data);
        if (isFirstFragment && type === 'moov') {
          yield Buffer.concat(pending);
          pending.length = 0;
          isFirstFragment = false;
        } else if (!isFirstFragment && type === 'moof') {
          moofBuffer = Buffer.concat([header, data]);
        } else if (!isFirstFragment && type === 'mdat' && moofBuffer) {
          yield Buffer.concat([moofBuffer, header, data]);
          moofBuffer = null;
        }
      }
    } finally {
      if (cp && !cp.killed) {
        cp.kill('SIGTERM');
        setTimeout(() => cp.killed || cp.kill('SIGKILL'), 2000);
      }
      this.activeFFmpegProcesses.delete(streamId);
    }
  }

  private async startFFMPegFragmentedMP4Session(
    ffmpegPath: string,
    ffmpegInput: string[],
    videoOutputArgs: string[],
  ): Promise<FFMpegFragmentedMP4Session> {
    const args: string[] = [
      '-hide_banner',
      ...ffmpegInput,
      '-f', 'mp4',
      ...videoOutputArgs,
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset',
      'pipe:1',
    ];

    const cp = spawn(ffmpegPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });

    async function* generator(): AsyncGenerator<MP4Atom> {
      while (true) {
        const header = await readLength(cp.stdout!, 8);
        const length = header.readInt32BE(0) - 8;
        const type = header.slice(4).toString();
        const data = await readLength(cp.stdout!, length);
        yield { header, length, type, data };
      }
    }

    if (cp.stderr) {
      cp.stderr.on('data', data => {
        const output = data.toString();
        if (output.includes('error') || output.includes('Error')) {
          this.log.error(`FFmpeg: ${output.trim()}`, this.cameraName);
        }
      });
    }

    return { cp, generator: generator() };
  }
}
