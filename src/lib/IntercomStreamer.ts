/* eslint-disable no-case-declarations */
import {ChildProcess, spawn} from 'child_process';
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
  address: string; // address of the HAP controller
  videoPort: number;
  videoCryptoSuite: SRTPCryptoSuites; // should be saved if multiple suites are supported
  videoSRTP: Buffer; // key and salt concatenated
  videoSSRC: number; // rtp synchronisation source
};

/*
const FFMPEGH264ProfileNames = [
  'baseline',
  'main',
  'high',
];
const FFMPEGH264LevelNames = [
  '3.1',
  '3.2',
  '4.0',
];
*/

export class IntercomStreamer implements CameraStreamingDelegate {

  private readonly hap: HAP;
  private readonly ip: string = '';
  private readonly base64auth: string = '';
  controller?: CameraController;

  // keep track of sessions
  pendingSessions: Record<string, SessionInfo> = {};
  ongoingSessions: Record<string, ChildProcess> = {};

  constructor(
    private readonly platform: LoxonePlatform,
    hap: HAP,
    ip: string,
  ) {
    this.hap = hap;
    this.ip = ip;
    this.base64auth = Buffer.from(`${this.platform.config.username}:${this.platform.config.password}`, 'utf8').toString('base64');
  }

  handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {

    const ffmpeg = spawn('ffmpeg', [
      '-re',
      '-headers', `Authorization: Basic ${this.base64auth}`,
      '-i', `http://${this.ip}/mjpg/video.mjpg`,
      '-frames:v', '1',
      '-loglevel', 'debug',
      '-f', 'image2',
      '-',
    ],
    { env: process.env });

    const snapshotBuffers: Buffer[] = [];

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

  // called when iOS request rtp setup
  prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): void {
    const sessionId: StreamSessionIdentifier = request.sessionID;
    const targetAddress = request.targetAddress;

    const video = request.video;
    const videoPort = video.port;

    const videoCryptoSuite = video.srtpCryptoSuite; // could be used to support multiple crypto suite (or support no suite for debugging)
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

    const currentAddress = '192.168.1.252'; // ipAddress version must match
    const response: PrepareStreamResponse = {
      address: currentAddress,
      video: {
        port: videoPort,
        ssrc: videoSSRC,

        srtp_key: videoSrtpKey,
        srtp_salt: videoSrtpSalt,
      },
      // audio is omitted as we do not support audio in this example
    };

    this.pendingSessions[sessionId] = sessionInfo;
    callback(undefined, response);
  }

  // called when iOS device asks stream to start/stop/reconfigure
  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
    const sessionId = request.sessionID;

    switch (request.type) {
      case StreamRequestTypes.START:
        const sessionInfo = this.pendingSessions[sessionId];

        const video: VideoInfo = request.video;

        //const profile = FFMPEGH264ProfileNames[video.profile];
        //const level = FFMPEGH264LevelNames[video.level];
        const width = video.width;
        const height = video.height;
        const fps = video.fps;

        //const payloadType = video.pt;
        const maxBitrate = video.max_bit_rate;
        //const rtcpInterval = video.rtcp_interval; // usually 0.5
        const mtu = video.mtu; // maximum transmission unit

        const address = sessionInfo.address;
        const videoPort = sessionInfo.videoPort;
        const ssrc = sessionInfo.videoSSRC;
        //const cryptoSuite = sessionInfo.videoCryptoSuite;
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
          '-loglevel', 'info',
          '-progress', 'pipe:1',
        ],
        { env: process.env });

        let started = false;
        ffmpegVideo.stderr.on('data', data => {
          if (!started) {
            started = true;
            this.platform.log.debug('FFMPEG: received first frame');

            callback(); // do not forget to execute callback once set up
          }

          this.platform.log.debug('VIDEO: ' + String(data));
        });
        ffmpegVideo.on('error', error => {
          this.platform.log.debug('[Video] Failed to start video stream: ' + error.message);
          callback(new Error('ffmpeg process creation failed!'));
        });
        ffmpegVideo.on('exit', (code, signal) => {
          const message = '[Video] ffmpeg exited with code: ' + code + ' and signal: ' + signal;

          if (code === null || code === 255) {
            this.platform.log.debug(message + ' (Video stream stopped!)');
          } else {
            this.platform.log.debug(message + ' (error)');

            if (!started) {
              callback(new Error(message));
            } else {
              this.controller!.forceStopStreamingSession(sessionId);
            }
          }
        });

        this.ongoingSessions[sessionId] = ffmpegVideo;
        delete this.pendingSessions[sessionId];

        break;
      case StreamRequestTypes.RECONFIGURE:
        // not supported by this example
        this.platform.log.debug('Received (unsupported) request to reconfigure to: ' + JSON.stringify(request.video));
        callback();
        break;
      case StreamRequestTypes.STOP:
        const ffmpegProcess = this.ongoingSessions[sessionId];

        try {
          if (ffmpegProcess) {
            ffmpegProcess.kill('SIGKILL');
          }
        } catch (e) {
          this.platform.log.debug('Error occurred terminating the video process!');
          //this.platform.log.debug(e);
        }

        delete this.ongoingSessions[sessionId];

        this.platform.log.debug('Stopped streaming session!');
        callback();
        break;
    }
  }
}