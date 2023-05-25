import { BaseService } from './BaseService';

/**
 * GarageDoorOpener Service
 * Represents a garage door opener accessory in HomeKit.
 */
export class GarageDoorOpener extends BaseService {
  State = {
    CurrentDoorState: 0,
    TargetDoorState: 0,
    Position: 0,
    ObstructionDetected: 0,
  };

  /**
   * Sets up the GarageDoorOpener service.
   * Creates the required characteristics and their event handlers.
   */
  setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.GarageDoorOpener) ||
      this.accessory.addService(this.platform.Service.GarageDoorOpener);

    // Create handlers for the required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.CurrentDoorState)
      .onGet(() => this.handleCurrentDoorStateGet());

    this.service.getCharacteristic(this.platform.Characteristic.TargetDoorState)
      .onGet(() => this.handleTargetDoorStateGet())
      .onSet((value) => this.handleTargetDoorStateSet(value as number));

    this.service.getCharacteristic(this.platform.Characteristic.ObstructionDetected)
      .onGet(() => this.handleObstructionDetectedGet());
  }

  /**
   * Updates the GarageDoorOpener service with the latest state.
   * @param message - The message containing the updated state and value.
   */
  updateService(message: { state: string; value: number }): void {
    this.platform.log.debug(`[${this.device.name}] ${message.state} Callback state update for Gate: ${message.value}`);

    switch (message.state) {
      case 'active':
        switch (message.value) {
          case -1: // closing
            this.State.CurrentDoorState = 3;
            break;
          case 0: // not moving
            this.State.CurrentDoorState = this.State.Position === 0 ? 1 : this.State.Position === 1 ? 0 : 4;
            break;
          case 1: // opening
            this.State.CurrentDoorState = 2;
            break;
        }
        break;
      case 'position':
        this.State.TargetDoorState = message.value === 0 ? 1 : 0;
        this.State.Position = message.value;
        break;
    }

    // Make sure the changes are communicated to HomeKit
    this.service?.getCharacteristic(this.platform.Characteristic.CurrentDoorState)?.updateValue(this.State.CurrentDoorState);
    this.service?.getCharacteristic(this.platform.Characteristic.TargetDoorState)?.updateValue(this.State.TargetDoorState);
  }

  /**
   * Handles the GET event for the CurrentDoorState characteristic.
   * @returns The current value of the CurrentDoorState characteristic.
   */
  handleCurrentDoorStateGet(): number {
    this.platform.log.debug('Triggered GET CurrentDoorState');
    return this.State.CurrentDoorState;
  }

  /**
   * Handles the GET event for the TargetDoorState characteristic.
   * @returns The current value of the TargetDoorState characteristic.
   */
  handleTargetDoorStateGet(): number {
    this.platform.log.debug('Triggered GET TargetDoorState');
    return this.State.TargetDoorState;
  }

  /**
   * Handles the SET event for the TargetDoorState characteristic.
   * @param value - The new value of the TargetDoorState characteristic.
   */
  handleTargetDoorStateSet(value: number): void {
    this.platform.log.debug('Triggered SET TargetDoorState: ' + value);
    // Handle the change in the TargetDoorState characteristic if needed
  }

  /**
   * Handles the GET event for the ObstructionDetected characteristic.
   * @returns The current value of the ObstructionDetected characteristic.
   */
  handleObstructionDetectedGet(): number {
    this.platform.log.debug('Triggered GET ObstructionDetected');
    return this.State.ObstructionDetected;
  }
}