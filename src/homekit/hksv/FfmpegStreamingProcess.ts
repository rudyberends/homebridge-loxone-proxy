import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { StreamRequestCallback, StreamSessionIdentifier } from 'homebridge';
import os from 'os';
import readline from 'readline';
import { Writable } from 'stream';

/**
 * A delegate interface for handling streaming operations.
 */
export interface StreamingDelegate {
  stopStream(sessionId: StreamSessionIdentifier): void;
  forceStopStream(sessionId: StreamSessionIdentifier): void;
}

/**
 * Represents the progress of the FFmpeg streaming process.
 */
type FfmpegProgress = {
  frame: number;
  fps: number;
  stream_q: number;
  bitrate: number;
  total_size: number;
  out_time_us: number;
  out_time: string;
  dup_frames: number;
  drop_frames: number;
  speed: number;
  progress: string;
};

/**
 * Represents an FFmpeg streaming process for a camera.
 */
export class FfmpegStreamingProcess {
  private readonly process: ChildProcessWithoutNullStreams;
  private killTimeout?: NodeJS.Timeout;
  readonly stdin: Writable;

  /**
   * Creates an instance of `FfmpegStreamingProcess`.
   * @param cameraName - The name of the camera.
   * @param sessionId - The session identifier for the streaming session.
   * @param videoProcessor - The video processing command (e.g., 'ffmpeg').
   * @param ffmpegArgs - The arguments to pass to the FFmpeg command.
   * @param log - The logger object for logging debug and error messages.
   * @param debug - A flag indicating whether debug mode is enabled.
   * @param delegate - An object implementing the `StreamingDelegate` interface for handling streaming operations.
   * @param callback - An optional callback function to be called when the streaming process starts.
   */
  constructor(
    cameraName: string,
    sessionId: string,
    videoProcessor: string,
    ffmpegArgs: string[],
    log,
    debug = false,
    delegate: StreamingDelegate,
    callback?: StreamRequestCallback,
  ) {
    // Debugging log message
    log.debug('Stream command: ' + videoProcessor + ' ' + ffmpegArgs.join(' '), cameraName, debug);

    let started = false;
    const startTime = Date.now();

    // Spawn the FFmpeg child process
    this.process = spawn(videoProcessor, ffmpegArgs, { env: process.env });

    this.stdin = this.process.stdin;

    // Listen to the stdout stream of the FFmpeg process
    this.process.stdout.on('data', (data) => {
      const progress = this.parseProgress(data);
      if (progress) {
        if (!started && progress.frame > 0) {
          started = true;
          const runtime = (Date.now() - startTime) / 1000;
          const message = 'Getting the first frames took ' + runtime + ' seconds.';
          if (runtime < 5) {
            log.debug(message, cameraName, debug);
          } else if (runtime < 22) {
            log.warn(message, cameraName);
          } else {
            log.error(message, cameraName);
          }
        }
      }
    });

    // Create an interface for reading lines from the stderr stream
    const stderr = readline.createInterface({
      input: this.process.stderr,
      terminal: false,
    });

    // Listen to the stderr stream for error messages and debug information
    stderr.on('line', (line: string) => {
      if (callback) {
        callback();
        callback = undefined;
      }
      if (debug && line.match(/\[(panic|fatal|error)\]/)) { // For now only write anything out when debug is set
        log.error(line, cameraName);
      } else if (debug) {
        log.debug(line, cameraName, true);
      }
    });

    // Listen to the 'error' event of the child process
    this.process.on('error', (error: Error) => {
      log.error('FFmpeg process creation failed: ' + error.message, cameraName);
      if (callback) {
        callback(new Error('FFmpeg process creation failed'));
      }
      delegate.stopStream(sessionId);
    });

    // Listen to the 'exit' event of the child process
    this.process.on('exit', (code: number, signal: NodeJS.Signals) => {
      if (this.killTimeout) {
        clearTimeout(this.killTimeout);
      }

      const message = 'FFmpeg exited with code: ' + code + ' and signal: ' + signal;

      if (this.killTimeout && code === 0) {
        log.debug(message + ' (Expected)', cameraName, debug);
      } else if (code === null || code === 255) {
        if (this.process.killed) {
          log.debug(message + ' (Forced)', cameraName, debug);
        } else {
          log.error(message + ' (Unexpected)', cameraName);
        }
      } else {
        log.error(message + ' (Error)', cameraName);
        delegate.stopStream(sessionId);
        if (!started && callback) {
          callback(new Error(message));
        } else {
          delegate.forceStopStream(sessionId);
        }
      }
    });
  }

  /**
   * Parses the progress data from FFmpeg's stdout.
   * @param data - The data read from the stdout stream.
   * @returns The parsed `FfmpegProgress` object or `undefined` if the data does not represent progress information.
   */
  parseProgress(data: Uint8Array): FfmpegProgress | undefined {
    const input = data.toString();

    if (input.indexOf('frame=') === 0) {
      try {
        const progress = new Map<string, string>();
        input.split(/\r?\n/).forEach((line) => {
          const split = line.split('=', 2);
          progress.set(split[0], split[1]);
        });

        return {
          frame: parseInt(progress.get('frame')!),
          fps: parseFloat(progress.get('fps')!),
          stream_q: parseFloat(progress.get('stream_0_0_q')!),
          bitrate: parseFloat(progress.get('bitrate')!),
          total_size: parseInt(progress.get('total_size')!),
          out_time_us: parseInt(progress.get('out_time_us')!),
          out_time: progress.get('out_time')!.trim(),
          dup_frames: parseInt(progress.get('dup_frames')!),
          drop_frames: parseInt(progress.get('drop_frames')!),
          speed: parseFloat(progress.get('speed')!),
          progress: progress.get('progress')!.trim(),
        };
      } catch {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  /**
   * Returns the stdin stream of the FFmpeg process.
   * @returns The stdin stream.
   */
  getStdin() {
    return this.process.stdin;
  }

  /**
   * Stops the FFmpeg streaming process.
   */
  public stop(): void {
    this.process.stdin.write('q' + os.EOL);
    this.killTimeout = setTimeout(() => {
      this.process.kill('SIGKILL');
    }, 2 * 1000);
  }
}