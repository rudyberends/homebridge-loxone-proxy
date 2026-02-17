import { PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../../LoxonePlatform';
import { streamingDelegate } from '../hksv/StreamingDelegate';
import { get as httpGet } from 'http';
import { get as httpsGet } from 'https';

export type TwoWayAudioTemplateVars = Record<string, string>;
export type TwoWayAudioContext = {
  mode?: 'loxone-intercom-v2';
  signalingBaseUrl?: string;
};

/**
 * CameraService wraps the HKSV streamingDelegate and exposes
 * HomeKit-compatible MJPEG streaming and snapshot functionality.
 */
export class CameraService {
  private readonly platform: LoxonePlatform;
  private readonly accessory: PlatformAccessory;
  private readonly base64auth: string;
  private readonly streamUrl: string;
  private readonly snapshotUrl?: string;
  private readonly twoWayAudioTemplateVars?: TwoWayAudioTemplateVars;
  private readonly twoWayAudioContext?: TwoWayAudioContext;

  private streamingDelegate!: streamingDelegate;

  constructor(
    platform: LoxonePlatform,
    accessory: PlatformAccessory,
    streamUrl: string,
    snapshotUrl: string | undefined,
    base64auth: string,
    twoWayAudioTemplateVars?: TwoWayAudioTemplateVars,
    twoWayAudioContext?: TwoWayAudioContext,
  ) {
    this.platform = platform;
    this.accessory = accessory;
    this.streamUrl = streamUrl;
    this.snapshotUrl = snapshotUrl;
    this.base64auth = base64auth;
    this.twoWayAudioTemplateVars = twoWayAudioTemplateVars;
    this.twoWayAudioContext = twoWayAudioContext;

    this.setupService();
  }

  /**
   * Instantiates the HKSV streaming delegate and registers
   * the controller with HomeKit.
   */
  private setupService(): void {
    this.streamingDelegate = new streamingDelegate(
      this.platform,
      this.streamUrl,
      this.base64auth,
      this.accessory.displayName,
      this.snapshotUrl,
      this.twoWayAudioTemplateVars,
      this.twoWayAudioContext,
    );

    this.accessory.configureController(this.streamingDelegate.controller);
  }

  /**
   * Retrieves a JPEG snapshot from the streaming delegate.
   * Used by HomeKit and snapshot-based motion detection.
   */
  public async getSnapshot(useCache = true): Promise<Buffer | null> {
    return this.streamingDelegate.getSnapshot(useCache);
  }

  /**
   * Attempts to obtain only the snapshot file size via Content-Length.
   * This avoids downloading full JPEGs for motion detection.
   *
   * Returns:
   *  - size in bytes
   *  - null if no snapshot URL or no Content-Length available
   */
  public async getSnapshotSize(): Promise<number | null> {
    const url = this.snapshotUrl;
    if (!url) {
      return null; // e.g., Intercom V2
    }

    return new Promise((resolve) => {
      const headers: Record<string, string> = {};
      if (this.base64auth) {
        headers.Authorization = `Basic ${this.base64auth}`;
      }

      const requestFn = url.startsWith('https://') ? httpsGet : httpGet;
      const request = requestFn(
        url,
        {
          timeout: 3000,
          headers,
        },
        (response) => {
          // Always destroy connection immediately (no body needed)
          response.destroy();

          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            this.platform.log.debug(
              `[${this.accessory.displayName}] SnapshotSize status ${response.statusCode ?? 'unknown'}.`,
            );
            return resolve(null);
          }

          const contentLengthHeader = response.headers['content-length'];
          const header = Array.isArray(contentLengthHeader)
            ? contentLengthHeader[0]
            : contentLengthHeader;

          if (!header) {
            this.platform.log.debug(`[${this.accessory.displayName}] No Content-Length header present.`);
            return resolve(null);
          }

          const size = Number(header);
          if (Number.isFinite(size) && size > 0) {
            this.platform.log.debug(`[${this.accessory.displayName}] Content-Length: ${size} bytes`);
            return resolve(size);
          }

          this.platform.log.debug(`[${this.accessory.displayName}] Invalid Content-Length header: ${header}`);
          resolve(null);
        },
      );

      request.on('error', (err) => {
        this.platform.log.debug(`[${this.accessory.displayName}] SnapshotSize error: ${err.message}`);
        resolve(null);
      });

      request.on('timeout', () => {
        this.platform.log.debug(`[${this.accessory.displayName}] SnapshotSize timeout`);
        request.destroy();
        resolve(null);
      });
    });
  }
}
