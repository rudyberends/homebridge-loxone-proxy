import { CharacteristicValue } from 'homebridge';
import { LightBulb } from './LightBulb';

export class ColorLightBulb extends LightBulb {
  private lastsetmode = '';
  private lastUpdate = 0;

  State = {
    On: false,
    Brightness: 0,
    Hue: 0,
    Saturation: 0,
    ColorTemperature: 153,
  };

  setupService() {
    super.setupService();

    this.service!.getCharacteristic(this.platform.Characteristic.Hue)
      .onSet(this.setHue.bind(this))
      .onGet(this.getHue.bind(this));

    this.service!.getCharacteristic(this.platform.Characteristic.Saturation)
      .onSet(this.setSaturation.bind(this))
      .onGet(this.getSaturation.bind(this));

    this.service!.getCharacteristic(this.platform.Characteristic.ColorTemperature)
      .onSet(this.setColorTemperature.bind(this))
      .onGet(this.getColorTemperature.bind(this));
  }

  async setColorState() {
    this.lastUpdate = Date.now();

    //compose hsv or temp string
    let command = '';
    if (this.lastsetmode === 'color') {
      command = `hsv(${this.State.Hue},${this.State.Saturation},${this.State.Brightness})`;
    } else if (this.lastsetmode === 'colortemperature') {
      command = `temp(${this.State.Brightness},${homekitToLoxoneColorTemperature(this.State.ColorTemperature, this)})`;
    }

    this.platform.log.info(`[${this.device.name}] HomeKit - send message: ${command}`);
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);

    this.State.On = this.State.Brightness > 0;
  }

  async setOn(value: CharacteristicValue) {
    if (!value) {
      this.State.Brightness = 0;
      this.setColorState();
    }
  }

  async setBrightness(value: CharacteristicValue) {
    this.State.Brightness = value as number;
    this.State.On = this.State.Brightness > 0;
    this.setColorState();
  }

  async setHue(value: CharacteristicValue) {
    this.State.Hue = value as number;
    this.lastsetmode = 'color';
    this.setColorState();
  }

  async getHue() {
    return this.State.Hue;
  }

  async setSaturation(value: CharacteristicValue) {
    this.State.Saturation = value as number;
    this.lastsetmode = 'color';
    this.setColorState();
  }

  async getSaturation() {
    return this.State.Saturation;
  }

  async setColorTemperature(value: CharacteristicValue) {
    this.State.ColorTemperature = value as number;
    this.lastsetmode = 'colortemperature';
    this.setColorState();
  }

  async getColorTemperature() {
    return this.State.ColorTemperature;
  }
}

// transform Homekit color temperature (expressed 140-500 to Loxone values expressed in Kelvins 2700-6500k)
function homekitToLoxoneColorTemperature(ct: number) {

  const minCtLoxone = 2700;
  const maxCtLoxone = 6500;

  const minCtHomekit = 153;
  const maxCtHomekit = 500;

  const percent = 1 - ((ct - minCtHomekit) / (maxCtHomekit - minCtHomekit));
  const newValue = Math.round(minCtLoxone + ((maxCtLoxone - minCtLoxone) * percent));

  return newValue;
}