import { CharacteristicValue } from 'homebridge';
import { BaseService } from './BaseService';

export class SwitchService extends BaseService {

  State = {
    On: false,
  };

  setupService() {
    const switchType = (this.device.cat === 'lights')
      ? this.platform.Service.Lightbulb
      : this.platform.Service.Switch;

    this.service = this.accessory.getService(switchType) || this.accessory.addService(switchType);

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))  // SET - bind to the `setOn` method below
      .onGet(this.getOn.bind(this)); // GET - bind to the `getOn` method below
  }

  updateService( message: { value: number} ) {
    this.platform.log.debug(`[${this.device.name}] Callback state update for Switch: ${!!message.value}`);
    this.State.On = !!message.value;

      //also make sure this change is directly communicated to HomeKit
      this.service!.getCharacteristic(this.platform.Characteristic.On).updateValue(this.State.On);
  }

  async setOn(value: CharacteristicValue) {
    this.State.On = value as boolean;
    this.platform.log.debug(`[${this.device.name}] Characteristic.On update from Homekit ->`, value);

    const command = this.State.On ? 'On' : 'Off';
    this.platform.log.debug(`[${this.device.name}] Send command to Loxone: ${command}`);
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);
  }

  async getOn(): Promise<CharacteristicValue> {
    return this.State.On;
  }
}