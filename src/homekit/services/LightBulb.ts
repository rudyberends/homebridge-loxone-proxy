import { CharacteristicValue } from 'homebridge';
import { SwitchService } from './Switch';

export class LightBulb extends SwitchService {

  State = {
    On: false,
    Brightness: 0,
  };

  setupService() {
    super.setupService();

    this.service!.getCharacteristic(this.platform.Characteristic.Brightness)
      .onSet(this.setBrightness.bind(this)); // SET - bind to the 'setBrightness` method below
  }

  updateService( message: { value: number} ) {
    super.updateService(message);
    this.State.Brightness = message.value as number;

    //also make sure this change is directly communicated to HomeKit
    this.service!.getCharacteristic(this.platform.Characteristic.Brightness).updateValue(this.State.Brightness);
  }

  async setBrightness(value: CharacteristicValue) {
    this.State.Brightness = value as number;
    this.platform.log.debug(`[${this.device.name}] - send message: ${this.State.Brightness}`);
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, this.State.Brightness);
  }
}