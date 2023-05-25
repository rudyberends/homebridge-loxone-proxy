import { BaseService } from './BaseService';

/**
 * HumiditySensor
 * Represents a humidity sensor service for Homebridge.
 */
export class HumiditySensor extends BaseService {
  State = {
    CurrentRelativeHumidity: 0,
  };

  /**
   * Sets up the humidity sensor service.
   */
  setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.HumiditySensor) ||
      this.accessory.addService(this.platform.Service.HumiditySensor);

    this.service.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(this.handleCurrentRelativeHumidityGet.bind(this));
  }

  /**
   * Updates the service with the new humidity value.
   * @param message - The message containing the new humidity value.
   */
  updateService(message: { value: number }): void {
    this.platform.log.debug(`[${this.device.name}] Callback state update for Humidity Sensor: ${message.value}`);
    this.State.CurrentRelativeHumidity = message.value;

    // Also make sure this change is directly communicated to HomeKit
    this.service!
      .getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .updateValue(this.State.CurrentRelativeHumidity);
  }

  /**
   * Handles requests to get the current value of the "Current Relative Humidity" characteristic.
   */
  handleCurrentRelativeHumidityGet(): number {
    this.platform.log.debug('Triggered GET CurrentRelativeHumidity');
    return this.State.CurrentRelativeHumidity;
  }
}