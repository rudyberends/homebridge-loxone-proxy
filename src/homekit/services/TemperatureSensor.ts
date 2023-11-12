import { BaseService } from './BaseService';

/**
 * TemperatureSensor
 * Represents a temperature sensor service for Homebridge.
 */
export class TemperatureSensor extends BaseService {
  State = {
    CurrentTemperature: 0,
  };

  /**
   * Sets up the temperature sensor service.
   */
  setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.TemperatureSensor) ||
      this.accessory.addService(this.platform.Service.TemperatureSensor);

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this));
  }

  /**
   * Updates the service with the new temperature value.
   * @param message - The message containing the new temperature value.
   */
  updateService(message: { value: number }): void {
    this.platform.log.debug(`[${this.device.name}] Callback state update for Temperature Sensor: ${message.value}`);
    this.State.CurrentTemperature = message.value;

    // Also make sure this change is directly communicated to HomeKit
    this.service!
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .updateValue(this.State.CurrentTemperature);
  }

  /**
   * Handles requests to get the current value of the "Current Relative Humidity" characteristic.
   */
  handleCurrentTemperatureGet(): number {
    this.platform.log.debug('Triggered GET CurrentTemperature');
    return this.State.CurrentTemperature;
  }
}