import { BaseService } from './BaseService';
import { LoxoneUpdateMessage } from '../../loxone/LoxoneTypes';

/**
 * Represents a Smoke Sensor accessory.
 */
export class LeakSensor extends BaseService {
  State = {
    LeakDetected: false,
  };

  /**
   * Sets up the leak sensor service.
   */
  setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.LeakSensor) ||
      this.accessory.addService(this.platform.Service.LeakSensor);

    // Create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.LeakDetected)
      .onGet(this.handleLeakDetectedGet.bind(this));
  }

  updateService = (message: LoxoneUpdateMessage) => {
    this.platform.log.debug(`[${this.device.name}] Callback state update for LeakSensor: ${!!message.value}`);
    this.State.LeakDetected = !!message.value;

    // Also make sure this change is directly communicated to HomeKit
    this.service!.getCharacteristic(this.platform.Characteristic.LeakDetected).updateValue(this.State.LeakDetected);
  };

  /**
   * Handle requests to get the current value of the "Leak Detected" characteristic.
   */
  handleLeakDetectedGet() {
    this.platform.log.debug('Triggered GET LeakDetected');
    return this.State.LeakDetected;
  }
}