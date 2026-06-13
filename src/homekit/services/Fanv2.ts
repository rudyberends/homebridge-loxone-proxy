import { BaseService } from './BaseService';

/**
 * Fanv2 Service
 * Represents a fan accessory in HomeKit with rotation speed control.
 */
export class Fanv2 extends BaseService {
  State = {
    Active: 0, // 0 = INACTIVE, 1 = ACTIVE (derived from the Loxone speed state)
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
      .onSet((value) => this.handleActiveSet(value as number));

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
        this.State.Active = message.value > 0 ? 1 : 0;
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
  handleActiveGet(): number {
    this.platform.log.debug('Triggered GET Active');
    return this.State.Active;
  }

  /**
   * Handles the SET event for the Active characteristic.
   *
   * The Loxone Ventilation block does not expose a verified on/off command in
   * the Structure File, so the fan cannot be driven from HomeKit. Rather than
   * report a phantom success (the old no-op left HomeKit showing the requested
   * state forever), re-assert the real device state so the toggle snaps back.
   * @param value - The requested value of the Active characteristic.
   */
  handleActiveSet(value: number): void {
    this.platform.log.warn(
      `[${this.device.name}] Ventilation on/off is not controllable from HomeKit (requested ${value}); reflecting device state`,
    );
    setTimeout(() => {
      this.service?.getCharacteristic(this.platform.Characteristic.Active)?.updateValue(this.State.Active);
    }, 0);
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