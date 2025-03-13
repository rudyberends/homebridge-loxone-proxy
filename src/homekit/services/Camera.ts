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
  AudioStreamingCodecType,
  AudioRecordingCodecType,
  MediaContainerType,
  H264CodecParameters,
  H264Profile,
  H264Level,
} from 'homebridge';
import { ChildProcess, spawn } from 'child_process';
import { LoxonePlatform } from '../../LoxonePlatform';
import { once } from 'events';
import { Readable } from 'stream';
import { createServer } from 'net';
import { AddressInfo } from 'net';

/**
 * Represents a single entry in the pre-buffer for video recording.
 * @interface
 */
interface PreBufferEntry {
  /** The raw video data buffer. */
  data: Buffer;
  /** The timestamp when this entry was captured (in milliseconds). */
  timestamp: number;
  /** Indicates if this entry is a keyframe (IDR frame in H.264). */
  isKeyFrame: boolean;
}

/**
 * A service that manages camera streaming and recording for HomeKit Secure Video (HKSV).
 * Implements both `CameraStreamingDelegate` and `CameraRecordingDelegate` to handle live streaming,
 * snapshots, and event-triggered recordings with pre-buffering.
 * @class
 * @implements {CameraStreamingDelegate}
 * @implements {CameraRecordingDelegate}
 */
export class CameraService implements CameraStreamingDelegate, CameraRecordingDelegate {
  /** The Homebridge HAP (HomeKit Accessory Protocol) instance. */
  private readonly hap: HAP;

  /** The logging utility from the Loxone platform. */
  private readonly log: LoxonePlatform['log'];

  /** The RTSP or HTTP URL of the camera stream. */
  private readonly streamUrl: string;

  /** Optional base64-encoded authentication string for the camera stream (e.g., "user:pass"). */
  private readonly base64auth?: string;

  /** The name of the camera, derived from the stream URL or a default value. */
  private readonly cameraName: string;

  /** The Homebridge CameraController instance for managing streaming and recording. */
  public readonly controller: CameraController;

  /** The FFmpeg process handling the pre-buffer stream, if active. */
  private ffmpegProcess?: ChildProcess;

  /** Array of pre-buffered video entries, used for HKSV recordings. */
  private preBuffer: PreBufferEntry[] = [];

  /** Duration (in milliseconds) to retain pre-buffered video data (default: 4000ms). */
  private preBufferDuration = 4000;

  /** Cached snapshot data with timestamp, refreshed every 5 seconds. */
  private snapshotCache?: { data: Buffer; timestamp: number };

  /** Map of active streaming sessions, keyed by session ID. */
  private activeStreams: Map<string, { cp: ChildProcess; port: number; videoSRTP: Buffer; videoSSRC: number }> = new Map();

  /** Indicates whether recording is currently active. */
  private recordingActive = false;

  /** The current recording configuration, temporarily typed as `any` until proper typing is available. */
  private recordingConfig?: any;

  /**
   * Creates a new CameraService instance.
   * @param platform - The Loxone platform instance providing Homebridge API and logging.
   * @param accessory - The PlatformAccessory instance to attach the camera controller to.
   * @param streamUrl - The URL of the camera stream (e.g., RTSP or HTTP).
   * @param base64auth - Optional base64-encoded credentials for stream authentication.
   */
  constructor(
    private platform: LoxonePlatform,
    accessory: PlatformAccessory,
    streamUrl: string,
    base64auth?: string,
  ) {
    this.hap = platform.api.hap;
    this.log = platform.log;
    this.cameraName = accessory.displayName;
    this.streamUrl = streamUrl;

    // Get authentication from constructor (V1) or use miniserver credentials (V2)
    this.base64auth = base64auth ||
      Buffer.from(`${this.platform.config.username}:${this.platform.config.password}`, 'utf8').toString('base64');

    const videoParameters: H264CodecParameters = {
      profiles: [H264Profile.MAIN],
      levels: [H264Level.LEVEL4_0],
    };

    const options: CameraControllerOptions = {
      cameraStreamCount: 2,
      delegate: this,
      streamingOptions: {
        supportedCryptoSuites: [this.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          codec: { profiles: [this.hap.H264Profile.MAIN], levels: [this.hap.H264Level.LEVEL4_0] },
          resolutions: [[1920, 1080, 30], [1280, 720, 30], [640, 360, 15]],
        },
        audio: { codecs: [{ type: AudioStreamingCodecType.AAC_ELD, samplerate: this.hap.AudioStreamingSamplerate.KHZ_16 }] },
      },
      recording: {
        options: {
          prebufferLength: this.preBufferDuration,
          mediaContainerConfiguration: [{ type: MediaContainerType.FRAGMENTED_MP4, fragmentLength: 4000 }],
          video: {
            type: this.hap.VideoCodecType.H264,
            resolutions: [[1920, 1080, 30], [1280, 720, 30]],
            parameters: videoParameters,
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

  /**
   * Starts a continuous FFmpeg process to pre-buffer video data for HKSV recordings.
   * @private
   */
  private async startPreBufferStream(): Promise<void> {
    const args = [
      '-headers', `Authorization: Basic ${this.base64auth}`,
      '-i', this.streamUrl,
      '-c:v', 'libx264',
      '-r', '30',
      '-b:v', '2000k',
      '-c:a', 'aac',
      '-ar', '16000',
      '-f', 'tee',
      '-map', '0:v',
      '-map', '0:a',
      '[f=mp4:movflags=frag_keyframe+empty_moov+default_base_moof]pipe:1',
    ];

    try {
      this.ffmpegProcess = spawn('ffmpeg', args, { env: process.env, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (err) {
      this.log.error(`Failed to start pre-buffer FFmpeg: ${err}`);
      return;
    }
    this.ffmpegProcess.on('error', (err) => this.log.error(`PreBuffer FFmpeg error: ${err}`, this.cameraName));
    this.ffmpegProcess.on('exit', () => {
      this.ffmpegProcess = undefined;
      this.preBuffer = [];
    });

    const stream = this.ffmpegProcess.stdout!;
    let buffer = Buffer.alloc(0);
    stream.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8) {
        const length = buffer.readUInt32BE(0);
        if (buffer.length >= length) {
          const atom = buffer.slice(0, length);
          const type = atom.slice(4, 8).toString();
          const now = Date.now();
          if (type === 'mdat') {
            this.preBuffer.push({ data: atom, timestamp: now, isKeyFrame: this.isKeyFrame(atom) });
            this.preBuffer = this.preBuffer.filter(entry => entry.timestamp > now - this.preBufferDuration);
            if (!this.snapshotCache || this.snapshotCache.timestamp < now - 5000) {
              this.snapshotCache = { data: this.extractSnapshot(atom), timestamp: now };
            }
          }
          buffer = buffer.slice(length);
        } else {
          break;
        }
      }
    });
  }

  /**
   * Determines if a video atom is a keyframe (IDR frame in H.264).
   * @param atom - The video data buffer to check.
   * @returns True if the atom is a keyframe, false otherwise.
   * @private
   */
  private isKeyFrame(atom: Buffer): boolean {
    const data = atom.slice(8);
    return data.length > 4 && (data[4] & 0x1F) === 5;
  }

  /**
   * Extracts a JPEG snapshot from a video atom.
   * @param atom - The video data buffer to convert to a snapshot.
   * @returns A Buffer containing the JPEG image.
   * @private
   */
  private extractSnapshot(atom: Buffer): Buffer {
    const args = ['-i', 'pipe:', '-frames:v', '1', '-f', 'image2', 'pipe:'];
    const cp = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'ignore'] });
    cp.stdin.write(atom);
    cp.stdin.end();
    return cp.stdout.read() || Buffer.alloc(0);
  }

  /**
   * Handles HomeKit requests for camera snapshots.
   * @param request - The snapshot request details (e.g., width, height).
   * @param callback - The callback to return the snapshot Buffer or an error.
   */
  async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): Promise<void> {
    if (this.snapshotCache && this.snapshotCache.timestamp > Date.now() - 5000) {
      return callback(undefined, this.snapshotCache.data);
    }
    const snapshot = await this.generateSnapshot();
    this.snapshotCache = { data: snapshot, timestamp: Date.now() };
    callback(undefined, snapshot);
  }

  /**
   * Generates a new snapshot directly from the camera stream.
   * @returns A Promise resolving to a Buffer containing the JPEG snapshot.
   * @private
   */
  private async generateSnapshot(): Promise<Buffer> {
    const args = [
      '-headers', `Authorization: Basic ${this.base64auth}`,
      '-i', this.streamUrl,
      '-frames:v', '1',
      '-f', 'image2',
      'pipe:',
    ];
    const cp = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'ignore'] });
    const [buffer] = await Promise.all([once(cp.stdout, 'data'), once(cp, 'exit')]);
    return Buffer.from(buffer as any);
  }

  /**
   * Prepares a streaming session by reserving a port and setting up SRTP parameters.
   * @param request - The prepare stream request from HomeKit.
   * @param callback - The callback to return the stream response or an error.
   */
  async prepareStream(
    request: PrepareStreamRequest,
    callback: (error?: Error, response?: PrepareStreamResponse) => void,
  ): Promise<void> {
    const port = await this.reservePort();
    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();
    const videoSRTP = Buffer.concat([request.video.srtp_key, request.video.srtp_salt]);
    this.activeStreams.set(request.sessionID, { cp: null as any, port, videoSRTP, videoSSRC });
    callback(undefined, {
      video: { port, ssrc: videoSSRC, srtp_key: request.video.srtp_key, srtp_salt: request.video.srtp_salt },
    });
  }

  /**
   * Handles streaming requests from HomeKit (start, stop, reconfigure).
   * @param request - The streaming request details.
   * @param callback - The callback to signal completion or an error.
   */
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

  /**
   * Starts a live streaming session using FFmpeg with SRTP.
   * @param request - The start stream request from HomeKit.
   * @param callback - The callback to signal completion or an error.
   * @private
   */
  private async startStream(request: StartStreamRequest, callback: StreamRequestCallback): Promise<void> {
    const session = this.activeStreams.get(request.sessionID);
    if (!session) {
      return callback(new Error('Session not found'));
    }

    const args = [
      '-headers', `Authorization: Basic ${this.base64auth}`,
      '-i', this.streamUrl,
      '-c:v', 'libx264',
      '-r', request.video.fps.toString(),
      '-b:v', `${request.video.max_bit_rate}k`,
      '-c:a', 'aac',
      '-ar', '16000',
      '-f', 'rtp',
      '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
      '-srtp_out_params', session.videoSRTP.toString('base64'),
      `srtp://127.0.0.1:${session.port}?rtcpport=${session.port}`,
    ];

    const cp = spawn('ffmpeg', args, { stdio: 'ignore' });
    session.cp = cp;
    cp.on('error', (err) => {
      this.log.error(`Stream FFmpeg error: ${err}`, this.cameraName);
      callback(err);
    });
    cp.on('exit', () => this.stopStream(request.sessionID));
    callback();
  }

  /**
   * Stops an active streaming session.
   * @param sessionId - The ID of the session to stop.
   * @private
   */
  private stopStream(sessionId: string): void {
    const session = this.activeStreams.get(sessionId);
    if (session) {
      session.cp?.kill();
      this.activeStreams.delete(sessionId);
    }
  }

  /**
   * Updates the recording active state, enabling or disabling HKSV recording.
   * @param active - True to start recording, false to stop.
   */
  updateRecordingActive(active: boolean): void {
    this.recordingActive = active;
    if (!active) {
      this.stopAllRecordings();
    }
    this.log.debug(`Recording active: ${active}`, this.cameraName);
  }

  /**
   * Updates the recording configuration provided by HomeKit.
   * @param configuration - The recording configuration (currently typed as `any`).
   */
  updateRecordingConfiguration(configuration?: any): void {
    this.recordingConfig = configuration;
    this.log.debug('Recording config updated', this.cameraName);
  }

  /**
   * Handles HKSV recording stream requests, yielding video fragments.
   * @param streamId - The ID of the recording stream.
   * @returns An async generator yielding RecordingPacket objects.
   * @throws {HDSProtocolError} If recording is not active or configured.
   */
  async *handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket> {
    if (!this.recordingActive || !this.recordingConfig) {
      throw new this.hap.HDSProtocolError(HDSProtocolSpecificErrorReason.NOT_ALLOWED);
    }

    this.log.info(`Starting recording stream ${streamId}`, this.cameraName);
    const cp = this.startRecording(this.recordingConfig);
    const stream = cp.stdout as Readable;
    let buffer = Buffer.alloc(0);

    try {
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

  /**
   * Starts an FFmpeg process to generate recording fragments from pre-buffered and live video.
   * @param config - The recording configuration from HomeKit.
   * @returns The ChildProcess handling the recording.
   * @private
   */
  private startRecording(config: any): ChildProcess {
    const videoArgs = [
      '-c:v', 'libx264',
      '-r', config.videoCodec.resolution[2].toString(),
      '-b:v', `${config.videoCodec.bitrate}k`,
      '-c:a', 'aac',
      '-ar', '32000',
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
    const cp = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'ignore'] });
    cp.stdin.write(preBufferInput);
    cp.stdin.end();
    return cp;
  }

  /**
   * Retrieves the pre-buffered video data starting from the last keyframe.
   * @returns A Buffer containing concatenated pre-buffer video data.
   * @private
   */
  private getPreBufferVideo(): Buffer {
    const now = Date.now();
    const filtered = this.preBuffer.filter(entry => entry.timestamp > now - this.preBufferDuration);
    const startIdx = filtered.findIndex(entry => entry.isKeyFrame);
    return Buffer.concat(filtered.slice(startIdx).map(entry => entry.data));
  }

  /**
   * Acknowledges a recording stream (currently a no-op with logging).
   * @param streamId - The ID of the stream to acknowledge.
   */
  acknowledgeStream(streamId: number): void {
    this.log.debug(`Acknowledged stream ${streamId}`, this.cameraName);
  }

  /**
   * Closes a recording stream with an optional reason.
   * @param streamId - The ID of the stream to close.
   * @param reason - Optional reason for closing the stream.
   */
  closeRecordingStream(streamId: number, reason?: HDSProtocolSpecificErrorReason): void {
    this.log.debug(`Closed stream ${streamId} with reason: ${reason}`, this.cameraName);
  }

  /**
   * Reserves a free TCP port for streaming.
   * @returns A Promise resolving to the reserved port number.
   * @private
   */
  private async reservePort(): Promise<number> {
    const server = createServer();
    server.listen(0);
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;
    server.close();
    return port;
  }

  /**
   * Stops all active streaming and pre-buffer processes (called on shutdown).
   * @private
   */
  private stopAll(): void {
    this.ffmpegProcess?.kill();
    this.activeStreams.forEach(session => session.cp.kill());
    this.activeStreams.clear();
  }

  /**
   * Stops all active recordings (currently a no-op).
   * @private
   */
  private stopAllRecordings(): void {
    // No additional cleanup needed
  }
}