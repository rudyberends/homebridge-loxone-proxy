import {
  APIEvent,
  CameraRecordingConfiguration,
  CameraRecordingDelegate,
  HAP,
  HDSProtocolSpecificErrorReason,
  RecordingPacket,
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
    const r = () => {
      const data = readable.read(length);
      if (data) {
        cleanup();
        resolve(data);
      }
    };
    const e = () => {
      cleanup();
      reject(new Error(`stream ended during read for minimum ${length} bytes`));
    };
    const c = () => {
      cleanup();
      reject(new Error(`stream closed during read for minimum ${length} bytes`));
    };
    const err = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      readable.removeListener('readable', r);
      readable.removeListener('end', e);
      readable.removeListener('close', c);
      readable.removeListener('error', err);
    };
    readable.on('readable', r);
    readable.on('end', e);
    readable.on('close', c);
    readable.on('error', err);
  });
}

export async function* parseFragmentedMP4(readable: Readable): AsyncGenerator<MP4Atom> {
  try {
    while (true) {
      const header = await readLength(readable, 8);
      const length = header.readInt32BE(0) - 8;
      const type = header.slice(4).toString();
      const data = await readLength(readable, length);
      yield { header, length, type, data };
    }
  } catch (error) {
    // Stream ended or closed - this is expected when stopping
    if (error instanceof Error && (
      error.message.includes('stream ended') ||
      error.message.includes('stream closed')
    )) {
      return; // Gracefully exit the generator
    }
    throw error; // Re-throw unexpected errors
  }
}

export class RecordingDelegate implements CameraRecordingDelegate {
  private readonly hap: HAP;
  private readonly log: Logger;
  private readonly videoProcessor: string;
  private readonly streamUrl: string;
  private readonly base64auth: string;
  private readonly cameraName: string;

  private preBufferSession?: Mp4Session;
  private preBuffer?: PreBuffer;
  private currentRecordingConfiguration?: CameraRecordingConfiguration;
  private activeFFmpegProcesses = new Map<number, ChildProcess>();
  private streamAbortControllers = new Map<number, AbortController>();

  constructor(
    private readonly platform: LoxonePlatform,
    streamUrl: string,
    base64auth: string,
    cameraName: string,
  ) {
    this.log = platform.log;
    this.hap = platform.api.hap;
    this.videoProcessor = 'ffmpeg';
    this.streamUrl = streamUrl;
    this.base64auth = base64auth;
    this.cameraName = cameraName;

    platform.api.on(APIEvent.SHUTDOWN, () => {
      this.log.info(`[${this.cameraName}] Shutting down recording delegate`, this.streamUrl);
      // Abort all active streams
      this.streamAbortControllers.forEach(controller => controller.abort());
      this.streamAbortControllers.clear();
      // Kill all FFmpeg processes
      this.activeFFmpegProcesses.forEach(proc => {
        if (!proc.killed) {
          proc.kill('SIGTERM');
        }
      });
      this.activeFFmpegProcesses.clear();
      // Kill prebuffer process
      if (this.preBufferSession?.process && !this.preBufferSession.process.killed) {
        this.preBufferSession.process.kill('SIGKILL');
      }
      if (this.preBufferSession?.server) {
        this.preBufferSession.server.close();
      }
    });
  }

  updateRecordingActive(active: boolean): Promise<void> {
    this.log.info(`[${this.cameraName}] Recording active status changed to: ${active}`, this.streamUrl);
    return Promise.resolve();
  }

  updateRecordingConfiguration(config: CameraRecordingConfiguration | undefined): Promise<void> {
    this.log.info(`[${this.cameraName}] Recording configuration updated`, this.streamUrl);
    this.currentRecordingConfiguration = config;
    return Promise.resolve();
  }

  async *handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket> {
    this.log.info(`[${this.cameraName}] Recording stream request received for stream ID: ${streamId}`, this.streamUrl);
    if (!this.currentRecordingConfiguration) {
      this.log.error(`[${this.cameraName}] No recording configuration available`, this.streamUrl);
      return;
    }

    const abortController = new AbortController();
    this.streamAbortControllers.set(streamId, abortController);

    let fragmentCount = 0;
    try {
      await this.startPreBuffer();
      const fragmentGenerator = this.handleFragmentsRequests(this.currentRecordingConfiguration, streamId);
      for await (const fragmentBuffer of fragmentGenerator) {
        if (abortController.signal.aborted) {
          this.log.debug(`[${this.cameraName}] Aborted stream ${streamId}, skipping fragment`, this.streamUrl);
          break;
        }
        fragmentCount++;
        yield { data: fragmentBuffer, isLast: false };
      }
      this.log.info(`[${this.cameraName}] ✅ Recording completed successfully. Total fragments: ${fragmentCount}`, this.streamUrl);
      yield { data: Buffer.alloc(0), isLast: true };
    } catch (error) {
      this.log.error(`[${this.cameraName}] ❌ Recording stream error: ${error}`, this.streamUrl);
      yield { data: Buffer.alloc(0), isLast: true };
    } finally {
      this.streamAbortControllers.delete(streamId);
    }
  }

  closeRecordingStream(streamId: number, reason?: HDSProtocolSpecificErrorReason): void {
    this.log.info(`[${this.cameraName}] Recording stream closed for stream ID: ${streamId}, reason: ${reason}`, this.streamUrl);
    this.streamAbortControllers.get(streamId)?.abort();
    this.streamAbortControllers.delete(streamId);

    const process = this.activeFFmpegProcesses.get(streamId);
    if (process && !process.killed) {
      setTimeout(() => {
        if (!process.killed) {
          process.kill('SIGTERM');
        }
      }, 250);
    }
    this.activeFFmpegProcesses.delete(streamId);
  }

  async startPreBuffer(): Promise<void> {
    this.log.info(`[${this.cameraName}] Starting prebuffer for ${this.streamUrl}`);
    if (!this.preBuffer) {
      const ffmpegInput = [
        '-headers', `Authorization: Basic ${this.base64auth}\r\n`,
        '-use_wallclock_as_timestamps', '1',
        '-probesize', '200000',
        '-analyzeduration', '0',
        '-fflags', '+genpts+nobuffer+igndts',
        '-flags', 'low_delay',
        '-max_delay', '0',
        '-thread_queue_size', '1024',
        '-f', 'mjpeg',
        '-re',
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

    const session = await this.startFFMPegFragmetedMP4Session(this.videoProcessor, input);
    const { cp, generator } = session;
    this.activeFFmpegProcesses.set(streamId, cp);

    let moofBuffer: Buffer | null = null;
    let pending: Buffer[] = [];
    let isFirst = true;
    let fragmentCount = 0;

    try {
      this.log.info(`[${this.cameraName}] 📹 Starting video fragments generation for stream ID: ${streamId}`, this.streamUrl);
      for await (const box of generator) {
        pending.push(box.header, box.data);
        if (isFirst && box.type === 'moov') {
          this.log.info(`[${this.cameraName}] 📦 First moov atom received, yielding initial fragment`, this.streamUrl);
          yield Buffer.concat(pending);
          pending = [];
          isFirst = false;
        } else if (box.type === 'moof') {
          moofBuffer = Buffer.concat([box.header, box.data]);
          this.log.debug(`[${this.cameraName}] 📦 moof atom received`, this.streamUrl);
        } else if (box.type === 'mdat' && moofBuffer) {
          const fragment = Buffer.concat([moofBuffer, box.header, box.data]);
          fragmentCount++;
          this.log.debug(`[${this.cameraName}] 📦 Fragment ${fragmentCount} (moof+mdat, ${fragment.length} bytes)`, this.streamUrl);
          yield fragment;
          moofBuffer = null;
        }
      }
      this.log.info(`[${this.cameraName}] ✅ Recording fragments generation completed. Total fragments: ${fragmentCount}`, this.streamUrl);
    } catch (e) {
      this.log.error(`[${this.cameraName}] ❌ Recording fragments generation error: ${e}`, this.streamUrl);
      throw e;
    } finally {
      this.log.info(`[${this.cameraName}] 🧹 Cleaning up recording session for stream ID: ${streamId}`, this.streamUrl);
      if (!cp.killed) {
        cp.kill('SIGTERM');
      }
      this.activeFFmpegProcesses.delete(streamId);
    }
  }

  private async startFFMPegFragmetedMP4Session(
    ffmpegPath: string,
    input: string[],
  ): Promise<FFMpegFragmentedMP4Session> {
    const args = ['-hide_banner', ...input,
      '-f', 'mp4',
      '-vcodec', 'copy',
      '-an',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset',
      'pipe:1'];

    const cp = spawn(ffmpegPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let intentionallyKilled = false;

    // Track if process was intentionally killed
    const originalKill = cp.kill.bind(cp);
    cp.kill = function(signal?: NodeJS.Signals) {
      intentionallyKilled = true;
      return originalKill(signal);
    };

    cp.on('exit', (code, signal) => {
      if (code === 0 || code === null) {
        this.log.info(`[${this.cameraName}] [FFmpeg] exited successfully with code ${code}, signal ${signal}`);
      } else if (intentionallyKilled || signal === 'SIGTERM' || signal === 'SIGKILL') {
        // Process was killed intentionally, this is expected
        this.log.debug(`[${this.cameraName}] [FFmpeg] exited with code ${code}, signal ${signal} (intentional kill)`);
      } else {
        this.log.error(`[${this.cameraName}] [FFmpeg] exited with code ${code}, signal ${signal}`);
      }
    });

    if (cp.stderr) {
      cp.stderr.on('data', data => {
        const msg = data.toString();
        if (msg.includes('moov') || msg.toLowerCase().includes('error') || msg.toLowerCase().includes('failed')) {
          this.log.warn(`[${this.cameraName}] [FFmpeg stderr]: ${msg.trim()}`);
        }
      });
    }

    async function* generator() {
      try {
        while (true) {
          const header = await readLength(cp.stdout!, 8);
          const length = header.readInt32BE(0) - 8;
          const type = header.slice(4).toString();
          const data = await readLength(cp.stdout!, length);
          yield { header, length, type, data };
        }
      } catch (error) {
        if (cp.killed) {
          // Process was killed, this is expected
          return;
        }
        throw error;
      }
    }

    return { cp, generator: generator() };
  }
}