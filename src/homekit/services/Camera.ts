import { PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../../LoxonePlatform';
import { streamingDelegate } from '../hksv/StreamingDelegate';
//import { RecordingDelegate } from '../hksv/RecordingDelegate';

export class CameraService {
  readonly platform: LoxonePlatform;
  readonly accessory: PlatformAccessory;
  readonly ip: string;
  readonly base64auth: string;

  //private readonly recordingDelegate: RecordingDelegate;

  constructor(
    platform: LoxonePlatform,
    accessory: PlatformAccessory,
    ip: string,
    base64auth: string,
  ) {
    this.platform = platform;
    this.accessory = accessory;
    this.ip = ip;
    this.base64auth = base64auth;

    // Determine if HKSV is enabled (todo: config option)
    const hksvEnabled = true;

    // Initialize recording delegate
    //this.recordingDelegate = new RecordingDelegate(this.platform, accessory.displayName, hksvEnabled);

    // Setup camera service
    this.setupService();

    // Start HKSV stream if enabled
    if (hksvEnabled) {
      this.startHKSVStream().catch(err => {
        this.platform.log.error(`Failed to start HKSV stream: ${err}`);
      });
    }
  }

  /**
   * Sets up the Camera service.
   */
  setupService(): void {

    const delegate = new streamingDelegate(this.platform, this.ip!, this.base64auth);
    this.accessory.configureController(delegate.controller);

    // Configure recording delegate
    //this.accessory.configureController(this.recordingDelegate.controller);
  }

  async startHKSVStream(): Promise<void> {
    try {
      //await this.recordingDelegate.startHKSVStream();
      this.platform.log.debug(`Started HKSV stream for ${this.accessory.displayName}`);
    } catch (error) {
      this.platform.log.error(`Failed to start HKSV stream for ${this.accessory.displayName}: ${error}`);
    }
  }

  async stopHKSVStream(): Promise<void> {
    try {
      //await this.recordingDelegate.stopHKSVStream();
      this.platform.log.debug(`Stopped HKSV stream for ${this.accessory.displayName}`);
    } catch (error) {
      this.platform.log.error(`Failed to stop HKSV stream for ${this.accessory.displayName}: ${error}`);
    }
  }

  async handleMotionDetection(): Promise<void> {
    try {
      //await this.recordingDelegate.handleMotionDetection(event);
      this.platform.log.debug(`Motion detected on ${this.accessory.displayName}`);
    } catch (error) {
      this.platform.log.error(`Failed to handle motion detection for ${this.accessory.displayName}: ${error}`);
    }
  }
}