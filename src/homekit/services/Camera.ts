import { PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../../LoxonePlatform';
import { streamingDelegate } from '../hksv/StreamingDelegate';

export class Camera {

  constructor(
    readonly platform: LoxonePlatform,
    readonly accessory: PlatformAccessory,
    readonly streamUrl: string, // webcam url
    readonly base64auth?: string, // optional login token
  ) {
    this.setupService();
  }

  /**
   * Sets up the Camera service.
   */
  setupService(): void {

    const delegate = new streamingDelegate(this.platform, this.streamUrl, this.base64auth);
    this.accessory.configureController(delegate.controller);

  }
}