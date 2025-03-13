import { BaseService } from './BaseService';
import { PlatformAccessory, CharacteristicValue } from 'homebridge';
import { LoxonePlatform } from '../../LoxonePlatform';

/**
 * Represents a standalone Motion Sensor accessory for HomeKit.
 * Handles motion detection state updates from Loxone and exposes them to HomeKit.
 */
export class MotionSensor extends BaseService {
  State = {
    MotionDetected: false,
  };

  constructor(platform: LoxonePlatform, accessory: PlatformAccessory, device?: any) {
    super(platform, accessory, device);
    this.setupService();
  }

  getCharacteristic(characteristic: typeof this.platform.Characteristic.MotionDetected) {
    if (!this.service) {
      throw new Error('Service is not initialized');
    }
    return this.service.getCharacteristic(characteristic);
  }

  /**
   * Sets up the motion sensor service and characteristic handlers.
   * @private
   */
  setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.MotionSensor) ||
      this.accessory.addService(this.platform.Service.MotionSensor, this.device?.name || 'Motion Sensor');

    this.service
      .getCharacteristic(this.platform.Characteristic.MotionDetected)
      .onGet(this.handleMotionDetectedGet.bind(this));
  }

  /**
   * Updates the motion sensor state based on a Loxone message.
   * @param message - The message containing the motion state value (0 or 1).
   */
  updateService = (message: { value: number }): void => {
    if (message.value !== 0 && message.value !== 1) {
      this.platform.log.debug(`[${this.device.name}] Ignored message value: ${message.value}`);
      return;
    }

    const motionDetected = !!message.value;
    this.platform.log.debug(`[${this.device.name}] Callback state update for MotionSensor: ${motionDetected}`);
    this.State.MotionDetected = motionDetected;

    this.service!.updateCharacteristic(this.platform.Characteristic.MotionDetected, this.State.MotionDetected);
  };

  /**
   * Handles requests to get the current value of the "Motion Detected" characteristic.
   * @returns The current motion detected state.
   * @private
   */
  private handleMotionDetectedGet(): CharacteristicValue {
    this.platform.log.debug(`[${this.device.name}] Triggered GET MotionDetected`);
    return this.State.MotionDetected;
  }
}