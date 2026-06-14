import { BaseService } from './BaseService';
import { LoxoneUpdateMessage } from '../../loxone/LoxoneTypes';

/**
 * Fanv2 Service
 * Represents a fan accessory in HomeKit with rotation speed control.
 */
export class Fanv2 extends BaseService {
  State = {
    Active: 0, // 0 = INACTIVE, 1 = ACTIVE (derived from the Loxone speed state)
    RotationSpeed: 0,
    mode: 0, // id of the active Loxone ventilation mode, needed to build setTimer
    lastOnSpeed: 100, // remembered speed so toggling Active on restores it
  };

  /**
   * Sets up the Fanv2 service.
   * Creates the required characteristics and their event handlers.
   */
  setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.Fanv2) ||
      this.accessory.addService(this.platform.Service.Fanv2);

    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => this.handleActiveGet())
      .onSet((value) => this.handleActiveSet(value as number));

    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(() => this.handleRotationSpeedGet())
      .onSet((value) => this.handleRotationSpeedSet(value as number));
  }

  /**
   * Updates the Fanv2 service with the latest state.
   * @param message - The message containing the updated state and value.
   */
  updateService(message: LoxoneUpdateMessage): void {
    this.platform.log.debug(`[${this.device.name}] Callback ${message.state} update for Fan: ${message.value}`);

    switch (message.state) {
      case 'mode':
        this.State.mode = Number(message.value);
        break;
      case 'speed': {
        const speed = Number(message.value);
        this.State.RotationSpeed = speed;
        this.State.Active = speed > 0 ? 1 : 0;
        if (speed > 0) {
          this.State.lastOnSpeed = speed;
        }
        break;
      }
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
   * Loxone Ventilation has no hard on/off: "off" returns control to the
   * Miniserver's automatic mode (setTimer/0), "on" starts a manual override at
   * the last known speed. See Ventilation item for the command strings.
   */
  handleActiveSet(value: number): void {
    this.platform.log.debug(`[${this.device.name}] Triggered SET Active: ${value}`);
    if (value === 0) {
      this.executeCommand('setVentilationAuto');
    } else {
      const speed = this.State.RotationSpeed > 0 ? this.State.RotationSpeed : this.State.lastOnSpeed;
      this.executeCommand('setRotationSpeed', { speed, modeId: this.State.mode });
    }
  }

  /**
   * Handles the GET event for the RotationSpeed characteristic.
   * @returns The current value of the RotationSpeed characteristic.
   */
  handleRotationSpeedGet(): number {
    this.platform.log.debug('Triggered GET RotationSpeed');
    return this.State.RotationSpeed;
  }

  /**
   * Handles the SET event for the RotationSpeed characteristic by starting a
   * manual ventilation timer at the requested speed in the current mode.
   */
  handleRotationSpeedSet(value: number): void {
    this.platform.log.debug(`[${this.device.name}] Triggered SET RotationSpeed: ${value}`);
    if (value <= 0) {
      this.executeCommand('setVentilationAuto');
      return;
    }
    this.State.lastOnSpeed = value;
    this.executeCommand('setRotationSpeed', { speed: value, modeId: this.State.mode });
  }
}