import { ChildProcess, spawn, StdioNull, StdioPipe } from 'child_process';
import EventEmitter from 'events';
import { createServer, Server } from 'net';
import { listenServer, MP4Atom, parseFragmentedMP4 } from './RecordingDelegate';

interface PrebufferFmp4 {
    atom: MP4Atom;
    time: number;
}

export interface Mp4Session {
    server: Server;
    process: ChildProcess;
}

const defaultPrebufferDuration = 15000;

let prebufferSession: Mp4Session;

/**
 * Class representing a pre-buffer for video streaming.
 */
export class PreBuffer {
  prebufferFmp4: PrebufferFmp4[] = [];
  events = new EventEmitter();
  released = false;
  ftyp;
  moov;
  idrInterval = 0;
  prevIdr = 0;

  private ffmpegInput: string;
  private readonly cameraName;
  private readonly ffmpegPath: string;

  /**
   * Creates an instance of `PreBuffer`.
   * @param ffmpegInput - The input command for FFmpeg.
   * @param cameraName - The name of the camera.
   * @param videoProcessor - The video processing command (e.g., 'ffmpeg').
   */
  constructor(ffmpegInput: string, cameraName: string, videoProcessor: string) {
    this.ffmpegInput = ffmpegInput;
    this.cameraName = cameraName;
    this.ffmpegPath = videoProcessor;
  }

  /**
   * Starts the pre-buffer process.
   * @returns A promise that resolves to the pre-buffer session object.
   */
  async startPreBuffer(): Promise<Mp4Session> {
    if (prebufferSession) {
      return prebufferSession;
    }

    /*
    const acodec = [
      '-acodec',
      'copy',
    ];
    */

    const vcodec = [
      '-vcodec',
      'copy',
    ];

    const fmp4OutputServer: Server = createServer(async (socket) => {
      fmp4OutputServer.close();
      const parser = parseFragmentedMP4(socket);
      for await (const atom of parser) {
        const now = Date.now();
        if (!this.ftyp) {
          this.ftyp = atom;
        } else if (!this.moov) {
          this.moov = atom;
        } else {
          if (atom.type === 'mdat') {
            if (this.prevIdr) {
              this.idrInterval = now - this.prevIdr;
            }
            this.prevIdr = now;
          }

          this.prebufferFmp4.push({
            atom,
            time: now,
          });
        }

        while (this.prebufferFmp4.length && this.prebufferFmp4[0].time < now - defaultPrebufferDuration) {
          this.prebufferFmp4.shift();
        }

        this.events.emit('atom', atom);
      }
    });
    const fmp4Port = await listenServer(fmp4OutputServer);

    const ffmpegOutput = [
      '-f', 'mp4',
      ...vcodec,
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      `tcp://127.0.0.1:${fmp4Port}`,
    ];

    const args: string[] = [];
    args.push(...this.ffmpegInput.split(' '));
    args.push(...ffmpegOutput);

    const debug = false;

    const stdioValue: StdioPipe | StdioNull = debug ? 'pipe' : 'ignore';
    const cp = spawn(this.ffmpegPath, args, { env: process.env, stdio: stdioValue });

    prebufferSession = { server: fmp4OutputServer, process: cp };

    return prebufferSession;
  }

  /**
   * Retrieves the video data from the pre-buffer.
   * @param requestedPrebuffer - The duration of pre-buffering to retrieve in milliseconds.
   * @returns A promise that resolves to an array of FFmpeg input commands for retrieving the pre-buffered video.
   */
  async getVideo(requestedPrebuffer: number): Promise<string[]> {
    const server = new Server(socket => {
      server.close();

      const writeAtom = (atom: MP4Atom) => {
        socket.write(Buffer.concat([atom.header, atom.data]));
      };

      if (this.ftyp) {
        writeAtom(this.ftyp);
      }
      if (this.moov) {
        writeAtom(this.moov);
      }
      const now = Date.now();
      let needMoof = true;
      for (const prebuffer of this.prebufferFmp4) {
        if (prebuffer.time < now - requestedPrebuffer) {
          continue;
        }
        if (needMoof && prebuffer.atom.type !== 'moof') {
          continue;
        }
        needMoof = false;
        writeAtom(prebuffer.atom);
      }

      this.events.on('atom', writeAtom);

      const cleanup = () => {
        this.events.removeListener('atom', writeAtom);
        this.events.removeListener('killed', cleanup);
        socket.removeAllListeners();
        socket.destroy();
      };

      this.events.once('killed', cleanup);
      socket.once('end', cleanup);
      socket.once('close', cleanup);
      socket.once('error', cleanup);
    });

    setTimeout(() => server.close(), 30000);

    const port = await listenServer(server);

    const ffmpegInput: string[] = [
      '-f', 'mp4',
      '-i', `tcp://127.0.0.1:${port}`,
    ];

    return ffmpegInput;
  }
}