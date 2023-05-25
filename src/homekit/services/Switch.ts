import { CharacteristicValue } from 'homebridge';
import { BaseService } from './BaseService';

export class SwitchService extends BaseService {
  State = {
    On: false,
  };

  /**
   * Sets up the switch service.
   */
  setupService(): void {
    const switchType = this.device.cat === 'lights'
      ? this.platform.Service.Lightbulb
      : this.platform.Service.Switch;

    this.service = this.accessory.getService(switchType) || this.accessory.addService(switchType);

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));
  }

  /**
   * Updates the service with the new switch state.
   * @param message - The message containing the new switch state.
   */
  updateService(message: { value: number }): void {
    this.platform.log.debug(`[${this.device.name}] Callback state update for Switch: ${!!message.value}`);
    this.State.On = !!message.value;

    // Also make sure this change is directly communicated to HomeKit
    this.service!.getCharacteristic(this.platform.Characteristic.On).updateValue(this.State.On);
  }

  /**
   * Sets the switch state.
   * @param value - The switch state value to set.
   */
  async setOn(value: CharacteristicValue): Promise<void> {
    this.State.On = value as boolean;
    this.platform.log.debug(`[${this.device.name}] Characteristic.On update from Homekit ->`, value);

    const command = this.State.On ? 'On' : 'Off';
    this.platform.log.debug(`[${this.device.name}] Send command to Loxone: ${command}`);
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);
  }

  /**
   * Retrieves the current switch state.
   * @returns The current switch state.
   */
  async getOn(): Promise<CharacteristicValue> {
    return this.State.On;
  }
}