import { CharacteristicValue } from 'homebridge';
import { LightBulb } from './LightBulb';

export class ColorLightBulb extends LightBulb {
  private lastSetMode = '';
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

    const { Characteristic } = this.platform;

    this.service!
      .getCharacteristic(Characteristic.Hue)
      .onSet(this.setHue.bind(this))
      .onGet(this.getHue.bind(this));

    this.service!
      .getCharacteristic(Characteristic.Saturation)
      .onSet(this.setSaturation.bind(this))
      .onGet(this.getSaturation.bind(this));

    this.service!
      .getCharacteristic(Characteristic.ColorTemperature)
      .onSet(this.setColorTemperature.bind(this))
      .onGet(this.getColorTemperature.bind(this));
  }

  async setColorState() {
    this.lastUpdate = Date.now();

    const { device, platform, State } = this;
    const { name, uuidAction } = device;
    const { LoxoneHandler } = platform;

    let command = '';
    if (this.lastSetMode === 'color') {
      command = `hsv(${State.Hue},${State.Saturation},${State.Brightness})`;
    } else if (this.lastSetMode === 'colortemperature') {
      // command = `temp(${State.Brightness},${homekitToLoxoneColorTemperature(State.ColorTemperature, this)})`;
    }

    platform.log.info(`[${name}] HomeKit - send message: ${command}`);
    LoxoneHandler.sendCommand(uuidAction, command);

    State.On = State.Brightness > 0;
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
    this.lastSetMode = 'color';
    this.setColorState();
  }

  async getHue() {
    return this.State.Hue;
  }

  async setSaturation(value: CharacteristicValue) {
    this.State.Saturation = value as number;
    this.lastSetMode = 'color';
    this.setColorState();
  }

  async getSaturation() {
    return this.State.Saturation;
  }

  async setColorTemperature(value: CharacteristicValue) {
    this.State.ColorTemperature = value as number;
    this.lastSetMode = 'colortemperature';
    this.setColorState();
  }

  async getColorTemperature() {
    return this.State.ColorTemperature;
  }
}