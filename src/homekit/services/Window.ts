import { BaseService } from './BaseService';

export class Window extends BaseService {
  State: { CurrentPosition: number; PositionState: number; TargetPosition: number } = {
    CurrentPosition: 0,
    PositionState: 2,
    TargetPosition: 0,
  };

  /**
   * Sets up the Window service.
   * Creates the required characteristics and their event handlers.
   */
  setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.Window) ||
      this.accessory.addService(this.platform.Service.Window);

    // Create handlers for the required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.CurrentPosition)
      .onGet(() => this.handleCurrentPosition());

    this.service.getCharacteristic(this.platform.Characteristic.TargetPosition)
      .onGet(() => this.handleTargetPositionGet())
      .onSet((value) => this.handleTargetPositionSet(value as number));

    this.service.getCharacteristic(this.platform.Characteristic.PositionState)
      .onGet(() => this.handlePositionState());
  }

  /**
   * Updates the Window service with the latest state.
   * @param message - The message containing the updated state and value.
   */
  updateService(message: { state: string; value: number }): void {
    this.platform.log.debug(`[${this.device.name}] Full Callback Message:`, message);

    switch (message.state) {
      case 'direction':
        switch (message.value) {
          case -1:
            this.State.PositionState = this.platform.Characteristic.PositionState.DECREASING;
            break;
          case 0:
            this.State.PositionState = this.platform.Characteristic.PositionState.STOPPED;
            break;
          case 1:
            this.State.PositionState = this.platform.Characteristic.PositionState.INCREASING;
            break;
        }
        this.platform.log.debug(`[${this.device.name}] Updated PositionState: ${this.State.PositionState}`);
        this.service?.getCharacteristic(this.platform.Characteristic.PositionState)?.updateValue(this.State.PositionState);
        break;

      case 'position':
        this.State.CurrentPosition = Math.round(message.value * 100);
        this.platform.log.debug(`[${this.device.name}] Updated CurrentPosition: ${this.State.CurrentPosition}`);
        this.service?.getCharacteristic(this.platform.Characteristic.CurrentPosition)?.updateValue(this.State.CurrentPosition);
        break;

      case 'targetPosition':
        this.State.TargetPosition = Math.round(message.value * 100);
        this.platform.log.debug(`[${this.device.name}] Updated TargetPosition: ${this.State.TargetPosition}`);
        this.service?.getCharacteristic(this.platform.Characteristic.TargetPosition)?.updateValue(this.State.TargetPosition);
        break;

      default:
        this.platform.log.warn(`[${this.device.name}] Unknown state received: ${message.state}`);
        break;
    }
  }



  /**
   * Handles the GET event for the CurrentPosition characteristic.
   * @returns The current value of the CurrentPosition characteristic.
   */
  handleCurrentPosition(): number {
    this.platform.log.debug('Triggered GET handleCurrentPosition');
    return this.State.CurrentPosition;
  }

  /**
   * Handles the GET event for the TargetPosition characteristic.
   * @returns The target value of the TargetPosition characteristic.
   */
  handleTargetPositionGet(): number {
    this.platform.log.debug('Triggered GET handleTargetPosition');
    return this.State.TargetPosition;
  }

  handleTargetPositionSet(value) {
    this.platform.log.debug(`[${this.device.name}] Triggered SET TargetPosition:` + value);

    const command = `moveToPosition/${value}`;
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);
  }

  /**
   * Handles the GET event for the PositionState characteristic.
   * @returns The current position state.
   */
  handlePositionState(): number {
    this.platform.log.debug('Triggered GET handlePositionState');
    return this.State.PositionState;
  }
}