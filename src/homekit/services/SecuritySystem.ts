import { BaseService } from './BaseService';
import { CharacteristicValue } from 'homebridge';

export class SecuritySystem extends BaseService {
  State = {
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

  updateService(message: { value: number }): void {
    this.platform.log.debug(`[${this.device.name}] Callback state update for SecuritySystem: ${message.value}`);

    this.State.SecuritySystemTargetState = message.value;
    this.State.SecuritySystemCurrentState = message.value;

    this.service!.getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
      .updateValue(this.State.SecuritySystemTargetState);
    this.service!.getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
      .updateValue(this.State.SecuritySystemCurrentState);
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
    if (typeof value === 'number') {
      // Handle the set operation based on the provided number value
      this.platform.log.debug('Triggered SET SecuritySystemTargetState:' + value);
    } else {
      this.platform.log.error('Invalid value type for SecuritySystemTargetState');
    }
  }
}