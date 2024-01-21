import { BaseService } from './BaseService';

/**
 * Represents a Smoke Sensor accessory.
 */
export class SmokeSensor extends BaseService {
  State = {
    SmokeDetected: false,
  };

  /**
   * Sets up the smoke sensor service.
   */
  setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.SmokeSensor) ||
      this.accessory.addService(this.platform.Service.SmokeSensor);

    // Create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.SmokeDetected)
      .onGet(this.handleSmokeDetectedGet.bind(this));
  }

  updateService = (message: { value: boolean }) => {
    this.platform.log.debug(`[${this.device.name}] Callback state update for SmokeSensor: ${!!message.value}`);
    this.State.SmokeDetected = !!message.value;

    // Also make sure this change is directly communicated to HomeKit
    this.service!.getCharacteristic(this.platform.Characteristic.SmokeDetected).updateValue(this.State.SmokeDetected);
  };

  /**
   * Handle requests to get the current value of the "Smoke Detected" characteristic.
   */
  handleSmokeDetectedGet() {
    this.platform.log.debug('Triggered GET SmokeDetected');
    return this.State.SmokeDetected;
  }
}