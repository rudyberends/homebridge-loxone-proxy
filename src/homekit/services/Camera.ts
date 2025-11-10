import { PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../../LoxonePlatform';
import { streamingDelegate } from '../hksv/StreamingDelegate';
import { get } from 'http';

/**
 * CameraService wrapt de streamingDelegate en biedt HomeKit-camera-integratie
 * inclusief snapshot-opvraging en (optioneel) HKSV-ondersteuning.
 */
export class CameraService {
  private readonly platform: LoxonePlatform;
  private readonly accessory: PlatformAccessory;
  private readonly base64auth: string;
  private readonly streamUrl: string;
  private readonly snapshotUrl: string;

  private streamingDelegate!: streamingDelegate;

  constructor(
    platform: LoxonePlatform,
    accessory: PlatformAccessory,
    streamUrl: string,
    snapshotUrl: string,
    base64auth: string,
  ) {
    this.platform = platform;
    this.accessory = accessory;
    this.base64auth = base64auth;
    this.streamUrl = streamUrl;
    this.snapshotUrl = snapshotUrl;

    this.setupService();
  }

  /**
   * Initialiseer streamingDelegate en koppel aan Homebridge CameraController
   */
  private setupService(): void {

    this.streamingDelegate = new streamingDelegate(this.platform, this.streamUrl, this.base64auth, this.accessory.displayName);
    this.accessory.configureController(this.streamingDelegate.controller);
  }

  /**
   * Levert een JPEG-snapshot van de stream, via de streamingDelegate.
   * Wordt o.a. gebruikt voor snapshot-gebaseerde motion detection.
   */
  public async getSnapshot(): Promise<Buffer | null> {
    return this.streamingDelegate.getSnapshot();
  }

  /**
   * Gets the file size of a static JPEG snapshot via HTTP GET request to /jpg/image.jpg endpoint.
   * This is more efficient than downloading the entire file for motion detection.
   * Only reads HTTP headers, does not download the file body.
   * @returns File size in bytes, or null if unavailable
   */
  public async getSnapshotSize(): Promise<number | null> {
    const url = `${this.snapshotUrl}?login=${this.base64auth}`;

    return new Promise((resolve) => {
      const request = get(url, {
        timeout: 3000, // 3 second timeout for fast response
      }, (response) => {
        const contentLength = response.headers['content-length'];

        // Immediately destroy connection without reading body
        response.destroy();

        if (contentLength) {
          const size = parseInt(contentLength, 10);
          if (!isNaN(size) && size > 0) {
            this.platform.log.debug(`[${this.accessory.displayName}] 📊 HTTP headers returned Content-Length: ${size} bytes`);
            resolve(size);
            return;
          } else {
            this.platform.log.debug(`[${this.accessory.displayName}] ❌ Invalid Content-Length: ${contentLength}`);
          }
        } else {
          this.platform.log.debug(`[${this.accessory.displayName}] ❌ No Content-Length header in response`);
        }

        // Content-Length not found or invalid
        resolve(null);
      });

      request.on('error', (error) => {
        this.platform.log.debug(`[${this.accessory.displayName}] ❌ HTTP request error: ${error.message}`);
        // Silently fail - return null instead of rejecting
        resolve(null);
      });

      request.on('timeout', () => {
        this.platform.log.debug(`[${this.accessory.displayName}] ⏰ HTTP request timeout`);
        request.destroy();
        resolve(null);
      });
    });
  }
}