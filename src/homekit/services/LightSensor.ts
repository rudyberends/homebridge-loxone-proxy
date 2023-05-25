import { BaseService } from './BaseService';

/**
 * LightSensor
 * Represents a light sensor service for Homebridge.
 */
export class LightSensor extends BaseService {
  State = {
    CurrentAmbientLightLevel: 0.0001,
  };

  /**
   * Sets up the light sensor service.
   */
  setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.LightSensor) ||
      this.accessory.addService(this.platform.Service.LightSensor);

    this.service.getCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel)
      .onGet(this.handleCurrentAmbientLightLevelGet.bind(this));
  }

  /**
   * Updates the service with the new light sensor state.
   * @param message - The message containing the new light sensor state.
   */
  updateService(message: { value: number }): void {
    this.platform.log.debug(`[${this.device.name}] Callback state update for Light Sensor: ${message.value}`);
    this.State.CurrentAmbientLightLevel = message.value > 0.0001 ? message.value : 0.0001;

    // Also make sure this change is directly communicated to HomeKit
    this.service!
      .getCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel)
      .updateValue(this.State.CurrentAmbientLightLevel);
  }

  /**
   * Handles the request to get the current ambient light level.
   */
  handleCurrentAmbientLightLevelGet(): number {
    this.platform.log.debug('Triggered GET CurrentAmbientLightLevel');
    return this.State.CurrentAmbientLightLevel;
  }
}