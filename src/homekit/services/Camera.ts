import { PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../../LoxonePlatform';
import { streamingDelegate } from '../hksv/StreamingDelegate';

export class Camera {

  constructor(
    readonly platform: LoxonePlatform,
    readonly accessory: PlatformAccessory,
    readonly ip?: string, // webcam ip
    readonly login?: string, // optional login token
  ) {
    this.setupService();
  }

  /**
   * Sets up the Camera service.
   */
  setupService(): void {

    const delegate = new streamingDelegate(this.platform, this.ip!, this.login!);
    this.accessory.configureController(delegate.controller);

  }
}