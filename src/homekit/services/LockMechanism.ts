import { config } from 'process';
import { BaseService } from './BaseService';

/**
 * Represents a Lock Mechanism accessory.
 */
export class LockMechanism extends BaseService {
  State = {
    LockCurrentState: 0,
    LockTargetState: 0,
  };

  /**
   * Sets up the lock mechanism service.
   */
  setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.LockMechanism) ||
      this.accessory.addService(this.platform.Service.LockMechanism);

    // Create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.LockCurrentState)
      .onGet(this.handleLockCurrentStateGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.LockTargetState)
      .onGet(this.handleLockTargetStateGet.bind(this))
      .onSet(this.handleLockTargetStateSet.bind(this));
  }

  updateService = (message: { value: number }) => {

    // If switch reversal is enabled, reverse the order of the switch
    if (this.platform.config.switchAlias?.ReverseLockSwitch) {
      message.value = message.value === 0 ? 1 : 0;
    }

    this.platform.log.debug(`[${this.device.name}] Callback state update for Lock: ${message.value}`);
    this.State.LockTargetState = message.value;

    // Also make sure this change is directly communicated to HomeKit
    this.service!
      .getCharacteristic(this.platform.Characteristic.LockTargetState)
      .updateValue(this.State.LockTargetState);

    setTimeout(() => {
      this.State.LockCurrentState = message.value;

      // Also make sure this change is directly communicated to HomeKit
      this.service!
        .getCharacteristic(this.platform.Characteristic.LockCurrentState)
        .updateValue(this.State.LockCurrentState);
    }, 5000);
  };

  /**
   * Handle requests to get the current value of the "Lock Current State" characteristic.
   */
  handleLockCurrentStateGet() {
    this.platform.log.debug('Triggered GET LockCurrentState');
    return this.State.LockCurrentState;
  }

  /**
   * Handle requests to get the current value of the "Lock Target State" characteristic.
   */
  handleLockTargetStateGet() {
    this.platform.log.debug('Triggered GET LockTargetState');
    return this.State.LockTargetState;
  }

  /**
   * Handle requests to set the "Lock Target State" characteristic.
   */
  handleLockTargetStateSet(value) {
    this.platform.log.debug('Triggered SET LockTargetState:' + value);
    const command = this.State.LockTargetState ? 'Off' : 'On';
    this.platform.log.debug(`[${this.device.name}] - send message: ${command}`);
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);
  }
}