import { BaseService } from './BaseService';

/**
 * Fanv2 Service
 * Represents a fan accessory in HomeKit with rotation speed control.
 */
export class Fanv2 extends BaseService {
  State = {
    Active: true,
    RotationSpeed: 0,
  };

  /**
   * Sets up the Fanv2 service.
   * Creates the required characteristics and their event handlers.
   */
  setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.Fanv2) ||
      this.accessory.addService(this.platform.Service.Fanv2);

    // Create handlers for the required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => this.handleActiveGet())
      .onSet((value) => this.handleActiveSet(value as boolean));

    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(() => this.handleRotationSpeedGet());
  }

  /**
   * Updates the Fanv2 service with the latest state.
   * @param message - The message containing the updated state and value.
   */
  updateService(message: { state: string; value: number }): void {
    this.platform.log.debug(`[${this.device.name}] Callback ${message.state} update for Fan: ${message.value}`);

    switch (message.state) {
      case 'mode':
        // Handle mode update if needed
        break;
      case 'speed':
        this.State.RotationSpeed = message.value;
        break;
    }

    // Make sure the changes are communicated to HomeKit
    this.service?.getCharacteristic(this.platform.Characteristic.Active)?.updateValue(this.State.Active);
    this.service?.getCharacteristic(this.platform.Characteristic.RotationSpeed)?.updateValue(this.State.RotationSpeed);
  }

  /**
   * Handles the GET event for the Active characteristic.
   * @returns The current value of the Active characteristic.
   */
  handleActiveGet(): boolean {
    this.platform.log.debug('Triggered GET Active');
    return this.State.Active;
  }

  /**
   * Handles the SET event for the Active characteristic.
   * @param value - The new value of the Active characteristic.
   */
  handleActiveSet(value: boolean): void {
    this.platform.log.debug('Triggered SET Active: ' + value);
    // Handle the change in the Active characteristic if needed
  }

  /**
   * Handles the GET event for the RotationSpeed characteristic.
   * @returns The current value of the RotationSpeed characteristic.
   */
  handleRotationSpeedGet(): number {
    this.platform.log.debug('Triggered GET RotationSpeed');
    return this.State.RotationSpeed;
  }
}