import { BaseService } from './BaseService';
import { LoxoneUpdateMessage } from '../../loxone/LoxoneTypes';
import { CharacteristicValue } from 'homebridge';

export class SecuritySystem extends BaseService {
  State = {
    level: 0,
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
    if (this.State.level > 0) {
      // ALARM_TRIGGERED (4) is only valid for CurrentState; TargetState range
      // is [0..3], so leave the target at the armed mode to avoid a HAP warning
      // and a Current/Target desync.
      this.State.SecuritySystemCurrentState = 4;
    } else if (this.State.SecuritySystemCurrentState === 1 && this.State.disabledMove === 1) {
      this.State.SecuritySystemCurrentState = this.State.SecuritySystemTargetState = 2; // NIGHT_ARM
    }

    this.service!.getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
      .updateValue(this.State.SecuritySystemTargetState);
    this.service!.getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
      .updateValue(this.State.SecuritySystemCurrentState);
  }

  updateService(message: LoxoneUpdateMessage): void {
    this.platform.log.debug(`[${this.device.name}] Callback state update for SecuritySystem: ${message.state}: ${message.value}`);

    if (message.state === 'level') { // State: level
      this.State.level = Number(message.value);
    } else if (message.state === 'disabledMove') { // State: disabledMove
      this.State.disabledMove = Number(message.value);
    } else { // State: armed (Loxone reports a binary armed flag)
      // Map onto the HomeKit enum: armed => AWAY_ARM (1, may be refined to
      // NIGHT_ARM in updateAlarmState), disarmed => DISARMED/DISARM (3).
      // The previous code assigned the raw flag, so disarmed (0) showed as
      // STAY_ARM ('Armed, Home').
      this.State.SecuritySystemTargetState = this.State.SecuritySystemCurrentState = message.value ? 1 : 3;
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

      this.executeCommand('setTargetState', value);

      this.State.SecuritySystemCurrentState = value;

      this.service!.getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
        .updateValue(this.State.SecuritySystemTargetState);


    } else {
      this.platform.log.error('Invalid value type for SecuritySystemTargetState');
    }
  }
}
