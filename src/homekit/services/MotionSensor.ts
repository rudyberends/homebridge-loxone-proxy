import { BaseService } from './BaseService';

/**
 * Represents a Motion Sensor accessory.
 */
export class MotionSensor extends BaseService {
  State = {
    MotionDetected: false,
  };

  /**
   * Sets up the motion sensor service.
   */
  setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.MotionSensor) ||
      this.accessory.addService(this.platform.Service.MotionSensor);

    // Create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.MotionDetected)
      .onGet(this.handleMotionDetectedGet.bind(this));
  }

  updateService = (message: { value: boolean }) => {
    this.platform.log.debug(`[${this.device.name}] Callback state update for MotionSensor: ${!!message.value}`);
    this.State.MotionDetected = !!message.value;

    // Also make sure this change is directly communicated to HomeKit
    this.service!.getCharacteristic(this.platform.Characteristic.MotionDetected).updateValue(this.State.MotionDetected);
  };

  /**
   * Handle requests to get the current value of the "Motion Detected" characteristic.
   */
  handleMotionDetectedGet() {
    this.platform.log.debug('Triggered GET MotionDetected');
    return this.State.MotionDetected;
  }
}