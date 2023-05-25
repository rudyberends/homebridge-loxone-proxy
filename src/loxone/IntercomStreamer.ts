import { ChildProcess, spawn } from 'child_process';
import { LoxonePlatform } from '../LoxonePlatform';
import {
  CameraController,
  CameraStreamingDelegate,
  HAP,
  PrepareStreamCallback,
  PrepareStreamRequest,
  PrepareStreamResponse,
  SnapshotRequest,
  SnapshotRequestCallback,
  SRTPCryptoSuites,
  StreamingRequest,
  StreamRequestCallback,
  StreamRequestTypes,
  StreamSessionIdentifier,
  VideoInfo,
} from 'homebridge';

type SessionInfo = {
  address: string; // Address of the HAP controller
  videoPort: number;
  videoCryptoSuite: SRTPCryptoSuites; // Should be saved if multiple suites are supported
  videoSRTP: Buffer; // Key and salt concatenated
  videoSSRC: number; // RTP synchronization source
};

export class IntercomStreamer implements CameraStreamingDelegate {

  private readonly hap: HAP;
  private readonly ip: string = '';
  private readonly base64auth: string = '';
  controller?: CameraController;

  // Keep track of sessions
  pendingSessions: Record<string, SessionInfo> = {};
  ongoingSessions: Record<string, ChildProcess> = {};

  /**
   * Constructs an instance of the IntercomStreamer class.
   * @param platform The LoxonePlatform instance.
   * @param hap The HAP instance.
   * @param ip The IP address of the camera.
   */
  constructor(
    private readonly platform: LoxonePlatform,
    hap: HAP,
    ip: string,
  ) {
    this.hap = hap;
    this.ip = ip;
    this.base64auth = Buffer.from(`${this.platform.config.username}:${this.platform.config.password}`, 'utf8').toString('base64');
  }

  /**
   * Handles a snapshot request from HomeKit.
   * @param request The snapshot request.
   * @param callback The callback function to invoke with the snapshot image buffer.
   */
  handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {
    // Spawn an ffmpeg process to capture a snapshot from the camera
    const ffmpeg = spawn('ffmpeg', [
      '-re',
      '-headers', `Authorization: Basic ${this.base64auth}`,
      '-i', `http://${this.ip}/mjpg/video.mjpg`,
      '-frames:v', '1',
      '-loglevel', 'info',
      '-f', 'image2',
      '-',
    ],
    { env: process.env });

    const snapshotBuffers: Buffer[] = [];

    // Collect the snapshot data from ffmpeg's stdout
    ffmpeg.stdout.on('data', data => snapshotBuffers.push(data));

    ffmpeg.stderr.on('data', data => {
      this.platform.log.info('SNAPSHOT: ' + String(data));
    });

    ffmpeg.on('exit', (code, signal) => {
      if (signal) {
        this.platform.log.debug('Snapshot process was killed with signal: ' + signal);
        callback(new Error('killed with signal ' + signal));
      } else if (code === 0) {
        this.platform.log.debug(`Successfully captured snapshot at ${request.width}x${request.height}`);
        callback(undefined, Buffer.concat(snapshotBuffers));
      } else {
        this.platform.log.debug('Snapshot process exited with code ' + code);
        callback(new Error('Snapshot process exited with code ' + code));
      }
    });
  }

  /**
   * Handles the preparation of a stream requested by an iOS device.
   * @param request The prepare stream request.
   * @param callback The callback function to invoke with the response.
   */
  prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): void {
    const sessionId: StreamSessionIdentifier = request.sessionID;
    const targetAddress = request.targetAddress;

    const video = request.video;
    const videoPort = video.port;

    const videoCryptoSuite = video.srtpCryptoSuite; // Could be used to support multiple crypto suites
    const videoSrtpKey = video.srtp_key;
    const videoSrtpSalt = video.srtp_salt;

    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();

    const sessionInfo: SessionInfo = {
      address: targetAddress,
      videoPort: videoPort,
      videoCryptoSuite: videoCryptoSuite,
      videoSRTP: Buffer.concat([videoSrtpKey, videoSrtpSalt]),
      videoSSRC: videoSSRC,
    };

    const currentAddress = '192.168.1.252'; // IP address version must match
    const response: PrepareStreamResponse = {
      address: currentAddress,
      video: {
        port: videoPort,
        ssrc: videoSSRC,
        srtp_key: videoSrtpKey,
        srtp_salt: videoSrtpSalt,
      },
      // Audio is omitted as we do not support audio in this example
    };

    this.pendingSessions[sessionId] = sessionInfo;
    callback(undefined, response);
  }

  /**
   * Handles stream requests from an iOS device to start, stop, or reconfigure the stream.
   * @param request The streaming request.
   * @param callback The callback function to invoke.
   */
  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
    const sessionId = request.sessionID;

    switch (request.type) {
      case StreamRequestTypes.START:
        const sessionInfo = this.pendingSessions[sessionId];

        const video: VideoInfo = request.video;
        const width = video.width;
        const height = video.height;
        const fps = video.fps;
        const maxBitrate = video.max_bit_rate;
        const mtu = video.mtu;

        const address = sessionInfo.address;
        const videoPort = sessionInfo.videoPort;
        const ssrc = sessionInfo.videoSSRC;
        const videoSRTP = sessionInfo.videoSRTP.toString('base64');

        this.platform.log.debug(`Starting video stream (${width}x${height}, ${fps} fps, ${maxBitrate} kbps, ${mtu} mtu)...`);

        const ffmpegVideo = spawn('ffmpeg', [
          '-headers', `Authorization: Basic ${this.base64auth}`,
          '-re',
          '-i', `http://${this.ip}/mjpg/video.mjpg`,
          '-an',
          '-sn',
          '-dn',
          '-codec:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-color_range', 'mpeg',
          '-r', '30',
          '-f', 'rawvideo',
          '-preset', 'ultrafast',
          '-tune', 'zerolatency',
          '-filter:v', 'scale=\'min(1280,iw)\':\'min(720,ih)\':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2',
          '-b:v', '299k',
          '-payload_type', '99',
          '-ssrc', `${ssrc}`,
          '-f', 'rtp',
          '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
          '-srtp_out_params', `${videoSRTP}`,
          `srtp://${address}:${videoPort}?rtcpport=${videoPort}&localrtcpport=${videoPort}&pkt_size=${mtu}`,
        ],
        { env: process.env });

        this.ongoingSessions[sessionId] = ffmpegVideo;

        ffmpegVideo.stderr.on('data', data => {
          this.platform.log.debug('VIDEO STREAM: ' + String(data));
        });

        ffmpegVideo.on('exit', (code, signal) => {
          if (signal) {
            this.platform.log.debug('Video stream process was killed with signal: ' + signal);
          } else {
            this.platform.log.debug('Video stream process exited with code ' + code);
          }
          delete this.ongoingSessions[sessionId];
        });

        break;

      case StreamRequestTypes.RECONFIGURE:
        // Reconfiguration of the stream is not supported in this example
        this.platform.log.debug('Stream reconfiguration is not supported.');
        break;

      case StreamRequestTypes.STOP:
        const ffmpegProcess = this.ongoingSessions[sessionId];
        if (ffmpegProcess) {
          ffmpegProcess.kill('SIGTERM');
          delete this.ongoingSessions[sessionId];
          this.platform.log.debug('Stopped video stream.');
        }
        break;
    }

    callback();
  }

  /**
   * Cleans up any ongoing stream sessions and pending sessions.
   */
  cleanupSessions(): void {
    for (const sessionId in this.ongoingSessions) {
      const ffmpegProcess = this.ongoingSessions[sessionId];
      if (ffmpegProcess) {
        ffmpegProcess.kill('SIGTERM');
        delete this.ongoingSessions[sessionId];
      }
    }

    for (const sessionId in this.pendingSessions) {
      delete this.pendingSessions[sessionId];
    }
  }

  
  /**
   * Stops any ongoing stream sessions and cleans up resources.
   */
  /*
  stopStreaming(): void {
    this.cleanupSessions();
    this.controller?.forceStop();
  }*/
}