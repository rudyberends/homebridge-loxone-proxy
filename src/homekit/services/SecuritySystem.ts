import { BaseService } from './BaseService';
import { CharacteristicValue } from 'homebridge';

export class SecuritySystem extends BaseService {
  State = {
    disabledMove: 1,
    SecuritySystemCurrentState: 3,
    SecuritySystemTargetState: 3,
  };

  setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.SecuritySystem) ||
      this.accessory.addService(this.platform.Service.SecuritySystem);

    this.service.getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
      .onGet(this.handleSecuritySystemCurrentStateGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
      .onGet(this.handleSecuritySystemTargetStateGet.bind(this))
      .onSet(this.handleSecuritySystemTargetStateSet.bind(this));
  }

  updateAlarmState(): void {
    if (this.State.SecuritySystemCurrentState === 1 && this.State.disabledMove === 1) {
      this.State.SecuritySystemCurrentState = this.State.SecuritySystemTargetState = 2;
    }

    this.service!.getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
      .updateValue(this.State.SecuritySystemTargetState);
    this.service!.getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
      .updateValue(this.State.SecuritySystemCurrentState);
  }

  updateService(message: { state: string; value: number }): void {
    this.platform.log.debug(`[${this.device.name}] Callback state update for SecuritySystem: ${message.state}: ${message.value}`);

    if (message.state === 'disabledMove') { // State: disabledMove
      this.State.disabledMove = message.value;
    } else { // State: armed
      this.State.SecuritySystemTargetState = this.State.SecuritySystemCurrentState = message.value;
    }
    this.updateAlarmState();
  }

  handleSecuritySystemCurrentStateGet(): number {
    this.platform.log.debug('Triggered GET SecuritySystemCurrentState');
    return this.State.SecuritySystemCurrentState;
  }

  handleSecuritySystemTargetStateGet(): number {
    this.platform.log.debug('Triggered GET SecuritySystemTargetState');
    return this.State.SecuritySystemTargetState;
  }

  handleSecuritySystemTargetStateSet(value: CharacteristicValue): void {
    if (typeof value === 'number') { // Handle the set operation based on the provided number value
      this.platform.log.debug('Triggered SET SecuritySystemTargetState:' + value);
    } else {
      this.platform.log.error('Invalid value type for SecuritySystemTargetState');
    }
  }
}