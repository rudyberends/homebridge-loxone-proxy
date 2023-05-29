import { PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../../LoxonePlatform';
import { streamingDelegate } from '../hksv/StreamingDelegate';

export class Camera {

  constructor(
    readonly platform: LoxonePlatform,
    readonly accessory: PlatformAccessory,
    readonly ip?: string, // for aditional services on same Accesory
  ) {
    this.setupService();
  }

  /**
   * Sets up the Camera service.
   */
  setupService(): void {

    const delegate = new streamingDelegate(this.platform, this.ip!);
    this.accessory.configureController(delegate.controller);

  }
}