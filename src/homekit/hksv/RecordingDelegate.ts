import {
  APIEvent,
  CameraRecordingConfiguration,
  CameraRecordingDelegate,
  H264Level,
  H264Profile,
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

/**
 * FFmpeg stderr lines that are expected during normal HKSV start/stop (a recording
 * being torn down mid-fragment, the prebuffer pipe closing, a brief MJPEG hiccup).
 * These are logged at debug instead of as errors so the log isn't spammed.
 */
export const KNOWN_BENIGN_FFMPEG_ERROR =
  // eslint-disable-next-line max-len
  /moov atom not found|Cannot determine format of input stream|Broken pipe|Invalid data found when processing input|Error splitting the input into NAL units|Immediate exit requested|partial file|End of file/i;

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
  private preBufferInitPromise?: Promise<void>;
  private currentRecordingConfiguration?: CameraRecordingConfiguration;
  private prebufferEncoderSignature?: string;
  private activeFFmpegProcesses = new Map<string, ChildProcess>();
  private streamAbortControllers = new Map<string, AbortController>();
  private closedStreams = new Set<string>();
  private recordingActive = false;
  private shuttingDown = false;

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
      this.shuttingDown = true;
      this.log.info(`[${this.cameraName}] Shutting down recording delegate`, this.streamUrl);
      // Abort all active streams
      this.streamAbortControllers.forEach(controller => controller.abort());
      this.streamAbortControllers.clear();
      this.closedStreams.clear();
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
    this.recordingActive = active;
    this.log.info(`[${this.cameraName}] Recording active status changed to: ${active}`, this.streamUrl);
    if (active) {
      void this.startPreBuffer().catch((error) => {
        this.log.warn(`[${this.cameraName}] Failed to warm prebuffer: ${error}`, this.streamUrl);
      });
    } else {
      // Recording was turned off: tear the prebuffer down so its FFmpeg process
      // and localhost TCP server do not keep running for the rest of the
      // process lifetime. startPreBuffer() re-warms it on re-activation.
      this.stopPreBuffer();
    }
    return Promise.resolve();
  }

  private stopPreBuffer(): void {
    if (!this.preBufferSession && !this.preBuffer) {
      return;
    }
    this.log.info(`[${this.cameraName}] Stopping prebuffer for ${this.streamUrl}`);
    if (this.preBufferSession?.process && !this.preBufferSession.process.killed) {
      this.preBufferSession.process.kill('SIGKILL');
    }
    if (this.preBufferSession?.server) {
      this.preBufferSession.server.close();
    }
    this.preBufferSession = undefined;
    this.preBuffer = undefined;
  }

  updateRecordingConfiguration(config: CameraRecordingConfiguration | undefined): Promise<void> {
    this.log.info(`[${this.cameraName}] Recording configuration updated`, this.streamUrl);
    this.currentRecordingConfiguration = config;

    if (!config) {
      // HomeKit cleared the selection (recording management reset): drop the prebuffer.
      this.stopPreBuffer();
      return Promise.resolve();
    }

    if (this.recordingActive) {
      // If a prebuffer is already running with different (or default) encoder
      // settings, tear it down so it re-warms with the freshly negotiated ones.
      const desired = this.buildPrebufferEncoderArgs().join('');
      if (this.preBufferSession && desired !== this.prebufferEncoderSignature) {
        this.log.info(`[${this.cameraName}] Recording configuration changed; re-warming prebuffer encoder`, this.streamUrl);
        this.stopPreBuffer();
      }
      void this.startPreBuffer().catch((error) => {
        this.log.warn(`[${this.cameraName}] Failed to warm prebuffer after configuration update: ${error}`, this.streamUrl);
      });
    }
    return Promise.resolve();
  }

  async *handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket> {
    const streamKey = this.toStreamKey(streamId);
    this.closedStreams.delete(streamKey);

    this.log.info(`[${this.cameraName}] Recording stream request received for stream ID: ${streamId}`, this.streamUrl);
    if (!this.currentRecordingConfiguration) {
      this.log.error(`[${this.cameraName}] No recording configuration available`, this.streamUrl);
      return;
    }

    const abortController = new AbortController();
    this.streamAbortControllers.set(streamKey, abortController);

    let fragmentCount = 0;
    try {
      await this.startPreBuffer();
      if (this.isStreamClosed(streamKey, abortController.signal)) {
        this.log.debug(`[${this.cameraName}] Stream ${streamId} aborted before fragments started`, this.streamUrl);
        return;
      }

      const fragmentGenerator = this.handleFragmentsRequests(
        this.currentRecordingConfiguration,
        streamKey,
        abortController.signal,
      );
      for await (const fragmentBuffer of fragmentGenerator) {
        if (this.isStreamClosed(streamKey, abortController.signal)) {
          this.log.debug(`[${this.cameraName}] Stream ${streamId} aborted, stopping fragment yields`, this.streamUrl);
          return;
        }
        fragmentCount++;
        yield { data: fragmentBuffer, isLast: false };
      }

      if (this.isStreamClosed(streamKey, abortController.signal)) {
        this.log.debug(`[${this.cameraName}] Stream ${streamId} aborted after fragment loop`, this.streamUrl);
        return;
      }

      this.log.info(`[${this.cameraName}] ✅ Recording completed successfully. Total fragments: ${fragmentCount}`, this.streamUrl);
      yield { data: Buffer.alloc(0), isLast: true };
    } catch (error) {
      if (this.isStreamClosed(streamKey, abortController.signal)) {
        this.log.debug(`[${this.cameraName}] Stream ${streamId} aborted while handling recording`, this.streamUrl);
        return;
      }

      this.log.error(`[${this.cameraName}] ❌ Recording stream error: ${error}`, this.streamUrl);
      yield { data: Buffer.alloc(0), isLast: true };
    } finally {
      this.streamAbortControllers.delete(streamKey);
      this.closedStreams.delete(streamKey);
    }
  }

  closeRecordingStream(streamId: number, reason?: HDSProtocolSpecificErrorReason): void {
    const streamKey = this.toStreamKey(streamId);
    this.log.info(`[${this.cameraName}] Recording stream closed for stream ID: ${streamId}, reason: ${reason}`, this.streamUrl);
    this.closedStreams.add(streamKey);
    this.streamAbortControllers.get(streamKey)?.abort();
    this.streamAbortControllers.delete(streamKey);

    const process = this.activeFFmpegProcesses.get(streamKey);
    if (process && !process.killed) {
      process.kill('SIGTERM');
      setTimeout(() => {
        if (!process.killed) {
          process.kill('SIGKILL');
        }
      }, 1000);
    }
    this.activeFFmpegProcesses.delete(streamKey);
  }

  async startPreBuffer(): Promise<void> {
    if (this.shuttingDown || this.preBufferSession) {
      return;
    }

    if (!this.preBufferInitPromise) {
      this.preBufferInitPromise = (async () => {
        this.log.info(`[${this.cameraName}] Starting prebuffer for ${this.streamUrl}`);
        // No `-re`: this is a live source, so read frames as they arrive. `-re`
        // would pace input to the declared rate and drift the prebuffer behind
        // real time, which conflicts with the low-latency flags below.
        const ffmpegInput = [
          '-use_wallclock_as_timestamps', '1',
          '-probesize', '200000',
          '-analyzeduration', '0',
          '-fflags', '+genpts+nobuffer+igndts',
          '-flags', 'low_delay',
          '-max_delay', '0',
          '-thread_queue_size', '1024',
          '-f', 'mjpeg',
          '-i', this.streamUrl,
        ];
        if (this.base64auth) {
          ffmpegInput.unshift('-headers', `Authorization: Basic ${this.base64auth}\r\n`);
        }

        const encoderArgs = this.buildPrebufferEncoderArgs();
        this.prebufferEncoderSignature = encoderArgs.join('');
        this.preBuffer = new PreBuffer(ffmpegInput, this.cameraName, this.videoProcessor, this.log, encoderArgs);
        this.preBufferSession = await this.preBuffer.startPreBuffer();
      })()
        .finally(() => {
          this.preBufferInitPromise = undefined;
        });
    }

    await this.preBufferInitPromise;
  }

  async *handleFragmentsRequests(
    config: CameraRecordingConfiguration,
    streamKey: string,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<Buffer> {
    if (!this.preBuffer) {
      throw new Error('No video source configured');
    }

    if (this.isStreamClosed(streamKey, abortSignal)) {
      return;
    }

    const input = await this.preBuffer.getVideo(config.mediaContainerConfiguration.fragmentLength ?? PREBUFFER_LENGTH);
    if (this.isStreamClosed(streamKey, abortSignal)) {
      return;
    }

    const session = await this.startFFMPegFragmetedMP4Session(this.videoProcessor, input);
    const { cp, generator } = session;
    this.activeFFmpegProcesses.set(streamKey, cp);

    const abortHandler = () => {
      if (!cp.killed) {
        cp.kill('SIGTERM');
        setTimeout(() => {
          if (!cp.killed) {
            cp.kill('SIGKILL');
          }
        }, 1000);
      }
    };
    abortSignal?.addEventListener('abort', abortHandler, { once: true });

    let moofBuffer: Buffer | null = null;
    let pending: Buffer[] = [];
    let isFirst = true;
    let fragmentCount = 0;

    try {
      this.log.info(`[${this.cameraName}] 📹 Starting video fragments generation for stream ID: ${streamKey}`, this.streamUrl);
      for await (const box of generator) {
        if (this.isStreamClosed(streamKey, abortSignal)) {
          return;
        }

        pending.push(box.header, box.data);
        if (isFirst && box.type === 'moov') {
          this.log.info(`[${this.cameraName}] 📦 First moov atom received, yielding initial fragment`, this.streamUrl);
          if (this.isStreamClosed(streamKey, abortSignal)) {
            return;
          }
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
          if (this.isStreamClosed(streamKey, abortSignal)) {
            return;
          }
          yield fragment;
          moofBuffer = null;
        }
      }
      this.log.info(`[${this.cameraName}] ✅ Recording fragments generation completed. Total fragments: ${fragmentCount}`, this.streamUrl);
    } catch (e) {
      if (this.isStreamClosed(streamKey, abortSignal) || cp.killed) {
        return;
      }
      this.log.error(`[${this.cameraName}] ❌ Recording fragments generation error: ${e}`, this.streamUrl);
      throw e;
    } finally {
      abortSignal?.removeEventListener('abort', abortHandler);
      this.log.info(`[${this.cameraName}] 🧹 Cleaning up recording session for stream ID: ${streamKey}`, this.streamUrl);
      if (!cp.killed) {
        cp.kill('SIGTERM');
        setTimeout(() => {
          if (!cp.killed) {
            cp.kill('SIGKILL');
          }
        }, 1000);
      }
      this.activeFFmpegProcesses.delete(streamKey);
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
        if (intentionallyKilled || KNOWN_BENIGN_FFMPEG_ERROR.test(msg)) {
          this.log.debug(`[${this.cameraName}] [FFmpeg stderr]: ${msg.trim()} (benign)`);
          return;
        }
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

  /**
   * Builds the libx264 args for the prebuffer encoder. When HomeKit has selected
   * a recording configuration we honour its resolution, frame rate, bitrate and
   * profile so recordings match what was negotiated; otherwise we fall back to a
   * safe 720p/CRF default. Keyframes stay on a 1-second cadence regardless: the
   * prebuffer-replay path starts a recording at a `moof` boundary, and a short
   * GOP keeps that close to a keyframe so playback starts cleanly.
   */
  private buildPrebufferEncoderArgs(): string[] {
    const config = this.currentRecordingConfiguration;

    const base = [
      '-vcodec', 'libx264',
      '-color_range', 'pc',
      '-colorspace', 'bt470bg',
      '-color_primaries', 'smpte170m',
      '-color_trc', 'smpte170m',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
    ];

    if (!config) {
      return [
        ...base,
        '-crf', '22',
        '-g', '25',
        '-keyint_min', '25',
        '-sc_threshold', '0',
        '-bf', '0',
        '-force_key_frames', 'expr:gte(t,n_forced*1)',
        // eslint-disable-next-line max-len
        '-vf', 'fps=25:round=down,scale=\'min(1280,iw)\':\'min(720,ih)\':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-an',
      ];
    }

    const [rawWidth, rawHeight, rawFps] = config.videoCodec.resolution;
    const width = this.clamp(Math.round(rawWidth || 1280), 64, 1920);
    const height = this.clamp(Math.round(rawHeight || 720), 64, 1080);
    const fps = this.clamp(Math.round(rawFps || 25), 2, 30);
    const bitrateKbps = this.normalizeBitrateKbps(config.videoCodec.parameters.bitRate);
    const profile = this.mapH264Profile(config.videoCodec.parameters.profile);
    const level = this.mapH264Level(config.videoCodec.parameters.level);

    const args = [...base];
    if (profile) {
      args.push('-profile:v', profile);
    }
    if (level) {
      args.push('-level:v', level);
    }
    if (bitrateKbps) {
      args.push('-b:v', `${bitrateKbps}k`, '-maxrate', `${bitrateKbps}k`, '-bufsize', `${bitrateKbps * 2}k`);
    } else {
      args.push('-crf', '22');
    }
    args.push(
      '-g', `${fps}`,
      '-keyint_min', `${fps}`,
      '-sc_threshold', '0',
      '-bf', '0',
      '-force_key_frames', 'expr:gte(t,n_forced*1)',
      // eslint-disable-next-line max-len
      '-vf', `fps=${fps}:round=down,scale='min(${width},iw)':'min(${height},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      '-an',
    );
    return args;
  }

  /** HomeKit advertises the recording bitrate in kbit/s; guard against a stray bit/s value. */
  private normalizeBitrateKbps(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return undefined;
    }
    const kbps = value > 100000 ? Math.round(value / 1000) : Math.round(value);
    return this.clamp(kbps, 300, 8000);
  }

  private mapH264Profile(profile: H264Profile): string | undefined {
    switch (profile) {
      case H264Profile.BASELINE:
        return 'baseline';
      case H264Profile.MAIN:
        return 'main';
      case H264Profile.HIGH:
        return 'high';
      default:
        return undefined;
    }
  }

  /**
   * Maps the negotiated HKSV level to a libx264 `-level:v` string. Safe to pin
   * because HomeKit only ever pairs a level with a resolution it permits, and we
   * clamp the encoder to <=1080p — all within level 4.0.
   */
  private mapH264Level(level: H264Level): string | undefined {
    switch (level) {
      case H264Level.LEVEL3_1:
        return '3.1';
      case H264Level.LEVEL3_2:
        return '3.2';
      case H264Level.LEVEL4_0:
        return '4.0';
      default:
        return undefined;
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private toStreamKey(streamId: number | string): string {
    return String(streamId);
  }

  private isStreamClosed(streamKey: string, abortSignal?: AbortSignal): boolean {
    return this.closedStreams.has(streamKey) || !!abortSignal?.aborted || this.shuttingDown;
  }
}
