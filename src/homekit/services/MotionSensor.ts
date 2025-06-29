import { BaseService } from './BaseService';
import { PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../../LoxonePlatform';

/**
 * Represents a Motion Sensor accessory.
 */
export class MotionSensor extends BaseService {
  State = {
    MotionDetected: false,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(platform: LoxonePlatform, accessory: PlatformAccessory, device?: any) {
    super(platform, accessory, device);
    this.setupService();
  }

  setupService(): void {
    this.service = this.accessory.getService(this.platform.Service.MotionSensor) ||
      this.accessory.addService(this.platform.Service.MotionSensor);

    this.service.getCharacteristic(this.platform.Characteristic.MotionDetected)
      .onGet(this.handleMotionDetectedGet.bind(this));
  }

  updateService = (message: { value: number }) => {
    if (message.value !== 0 && message.value !== 1) {
      this.platform.log.debug(`[${this.device.name}] Ignored message value: ${message.value}`);
      return;
    }

    this.platform.log.debug(`[${this.device.name}] Callback state update for MotionSensor: ${!!message.value}`);
    this.State.MotionDetected = !!message.value;
    this.service!.getCharacteristic(this.platform.Characteristic.MotionDetected).updateValue(this.State.MotionDetected);
  };

  handleMotionDetectedGet() {
    this.platform.log.debug('Triggered GET MotionDetected');
    return this.State.MotionDetected;
  }
}