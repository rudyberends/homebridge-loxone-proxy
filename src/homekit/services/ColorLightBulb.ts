import { CharacteristicValue } from 'homebridge';
import { LightBulb } from './LightBulb';

/**
 * ColorLightBulb
 * Represents a color light bulb service for Homebridge.
 */
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

  /**
   * Sets up the color light bulb service.
   */
  setupService(): void {
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

  /**
   * Sets the color state of the light bulb.
   */
  async setColorState(): Promise<void> {
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

  /**
   * Sets the "On" characteristic of the light bulb.
   * @param value - The new value for the "On" characteristic.
   */
  async setOn(value: CharacteristicValue): Promise<void> {
    if (!value) {
      this.State.Brightness = 0;
      this.setColorState();
    }
  }

  /**
   * Sets the "Brightness" characteristic of the light bulb.
   * @param value - The new value for the "Brightness" characteristic.
   */
  async setBrightness(value: CharacteristicValue): Promise<void> {
    this.State.Brightness = value as number;
    this.State.On = this.State.Brightness > 0;
    this.setColorState();
  }

  /**
   * Sets the "Hue" characteristic of the light bulb.
   * @param value - The new value for the "Hue" characteristic.
   */
  async setHue(value: CharacteristicValue): Promise<void> {
    this.State.Hue = value as number;
    this.lastSetMode = 'color';
    this.setColorState();
  }

  /**
   * Gets the current value of the "Hue" characteristic.
   * @returns The current value of the "Hue" characteristic.
   */
  async getHue(): Promise<CharacteristicValue> {
    return this.State.Hue;
  }

  /**
   * Sets the "Saturation" characteristic of the light bulb.
   * @param value - The new value for the "Saturation" characteristic.
   */
  async setSaturation(value: CharacteristicValue): Promise<void> {
    this.State.Saturation = value as number;
    this.lastSetMode = 'color';
    this.setColorState();
  }

  /**
   * Gets the current value of the "Saturation" characteristic.
   * @returns The current value of the "Saturation" characteristic.
   */
  async getSaturation(): Promise<CharacteristicValue> {
    return this.State.Saturation;
  }

  /**
   * Sets the "ColorTemperature" characteristic of the light bulb.
   * @param value - The new value for the "ColorTemperature" characteristic.
   */
  async setColorTemperature(value: CharacteristicValue): Promise<void> {
    this.State.ColorTemperature = value as number;
    this.lastSetMode = 'colortemperature';
    this.setColorState();
  }

  /**
   * Gets the current value of the "ColorTemperature" characteristic.
   * @returns The current value of the "ColorTemperature" characteristic.
   */
  async getColorTemperature(): Promise<CharacteristicValue> {
    return this.State.ColorTemperature;
  }
}