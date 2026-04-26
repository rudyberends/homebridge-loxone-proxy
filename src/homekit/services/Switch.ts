import { CharacteristicValue } from 'homebridge';
import { BaseService } from './BaseService';

export class Switch extends BaseService {
  State = {
    On: false,
  };

  /**
   * Sets up the switch service.
   */
  setupService(): void {
    const switchType = this.getSwitchType();

    if (this.secondaryService) {
      const subtype = `${this.device.uuidAction}/${this.device.cat}`;
      this.service =
        this.accessory.getServiceById(switchType, subtype) ||
        this.accessory.addService(switchType, this.device.name, subtype);
    } else {
      this.service = this.accessory.getService(switchType) || this.accessory.addService(switchType);
    }

    if (this.secondaryService) {
      this.service.setCharacteristic(this.platform.Characteristic.Name, this.device.name);
      this.service.setCharacteristic(this.platform.Characteristic.ConfiguredName, this.device.name); // Not supported, but does the job
    }

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));
  }

  getSwitchType(): any {
    return this.device.cat === 'lights'
      ? this.platform.Service.Lightbulb // This is a Lightbulb (no dimming)
      : this.platform.Service.Switch;
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

    this.executeCommand('setOn', this.State.On);
  }

  /**
   * Retrieves the current switch state.
   * @returns The current switch state.
   */
  async getOn(): Promise<CharacteristicValue> {
    return this.State.On;
  }
}
