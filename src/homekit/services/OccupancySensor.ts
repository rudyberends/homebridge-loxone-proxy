import { BaseService } from './BaseService';
import { LoxoneUpdateMessage } from '../../loxone/LoxoneTypes';

/**
 * Represents an Occupancy Sensor accessory.
 */
export class OccupancySensor extends BaseService {
  State = {
    OccupancyDetected: false,
  };

  /**
   * Sets up the occupancy sensor service.
   */
  setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.OccupancySensor) ||
      this.accessory.addService(this.platform.Service.OccupancySensor);

    // Create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.OccupancyDetected)
      .onGet(this.handleOccupancyDetectedGet.bind(this));
  }

  updateService(message: LoxoneUpdateMessage): void {
    this.platform.log.debug(`[${this.device.name}] Callback state update for OccupancySensor: ${!!message.value}`);
    this.State.OccupancyDetected = !!message.value;

    // Also make sure this change is directly communicated to HomeKit
    this.service!
      .getCharacteristic(this.platform.Characteristic.OccupancyDetected)
      .updateValue(this.State.OccupancyDetected);
  }

  /**
   * Handle requests to get the current value of the "Occupancy Detected" characteristic.
   */
  handleOccupancyDetectedGet(): boolean {
    this.platform.log.debug('Triggered GET OccupancyDetected');
    return this.State.OccupancyDetected;
  }
}
