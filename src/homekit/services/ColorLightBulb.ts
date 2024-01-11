import { CharacteristicValue } from 'homebridge';
import { LightBulb } from './LightBulb';

/**
 * ColorLightBulb
 * Represents a color light bulb service for Homebridge.
 */
export class ColorLightBulb extends LightBulb {
  private lastSetMode = '';
  //private lastUpdate = 0;

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
   * Updates the service with the new value.
   * @param message - The message containing the new value.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateService(message: { value: any }): void {
    this.platform.log.debug(`[${this.device.name}] Callback state update for ColorLightBulb: ${message.value}`);

    const hsvRegex = /^\W*hsv?\(([^)]*)\)\W*$/i;
    const tempRegex = /^\W*temp?\(([^)]*)\)\W*$/i;

    const parseParams = (params: string[]) => {
      const regex = /^\s*(\d*)(\.\d+)?\s*$/;
      const [mH, mS, mV] = params.map(param => param.match(regex));

      if (mH && mS && mV) {
        this.State.Hue = parseFloat((mH[1] || '0') + (mH[2] || ''));
        this.State.Saturation = parseFloat((mS[1] || '0') + (mS[2] || ''));
        this.State.Brightness = parseFloat((mV[1] || '0') + (mV[2] || ''));
        this.State.On = this.State.Brightness > 0;
        this.lastSetMode = 'color';
      }
    };

    const processHSV = (value: string) => {
      const match = value.match(hsvRegex);
      if (match) {
        const params = match[1].split(',');
        parseParams(params);
      }
    };

    const processTemp = (value: string) => {
      const match = value.match(tempRegex);
      if (match) {
        const params = match[1].split(',');
        const rgb = colorTemperatureToRGB(parseInt(params[1]));
        const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);

        this.State.ColorTemperature = loxoneToHomekitColorTemperature(parseInt(params[1]));
        this.State.Hue = 360 * hsv.h;
        this.State.Saturation = hsv.s * 100;
        this.State.Brightness = parseInt(params[0]);
        this.State.On = this.State.Brightness > 0;
        this.lastSetMode = 'colortemperature';
      }
    };

    processHSV(message.value);
    processTemp(message.value);

    this.service!.getCharacteristic(this.platform.Characteristic.Hue).updateValue(this.State.Hue);
    this.service!.getCharacteristic(this.platform.Characteristic.Saturation).updateValue(this.State.Saturation);
    this.service!.getCharacteristic(this.platform.Characteristic.ColorTemperature).updateValue(this.State.ColorTemperature);
    this.service!.getCharacteristic(this.platform.Characteristic.On).updateValue(this.State.On);
    this.service!.getCharacteristic(this.platform.Characteristic.Brightness).updateValue(this.State.Brightness);
  }

  /**
   * Sets the color state of the light bulb.
   */
  async setColorState(): Promise<void> {
    //this.lastUpdate = Date.now();

    const { device, platform, State } = this;
    const { name, uuidAction } = device;
    const { LoxoneHandler } = platform;

    let command = '';
    if (this.lastSetMode === 'color') {
      command = `hsv(${State.Hue},${State.Saturation},${State.Brightness})`;
    } else if (this.lastSetMode === 'colortemperature') {
      command = `temp(${State.Brightness},${homekitToLoxoneColorTemperature(State.ColorTemperature)})`;
    }

    platform.log.debug(`[${name}] HomeKit - send message: ${command}`);
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

// transform Homekit color temperature (expressed 140-500 to Loxone values expressed in Kelvins 2700-6500k)
function homekitToLoxoneColorTemperature(ct: number) {
  const percent = 1 - ((ct - 153) / (500 - 153));
  return Math.round(2700 + ((6500 - 2700) * percent));
}

// transform Loxone color temperature (expressed in Kelvins 2700-6500k to Homekit values 140-500)
function loxoneToHomekitColorTemperature(ct: number) {
  const percent = 1 - ((ct - 2700) / (6500 - 2700));
  return Math.round(153 + ((500 - 153) * percent));
}

/**
 * Converts color temperature in Kelvin to an RGB color.
 * @param kelvin - The color temperature in Kelvin.
 * @returns An object representing the RGB color.
 */
function colorTemperatureToRGB(kelvin: number) {

  const temperature: number = kelvin / 100;
  let red: number, green: number, blue: number;

  if (temperature <= 66) {
    red = 255;
    green = 99.4708025861 * Math.log(temperature) - 161.1195681661;
    blue = temperature <= 19 ? 0 : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;
  } else {
    red = 329.698727446 * Math.pow(temperature - 60, -0.1332047592);
    green = 288.1221695283 * Math.pow(temperature - 60, -0.0755148492);
    blue = 255;
  }

  return {
    r: clamp(red, 0, 255),
    g: clamp(green, 0, 255),
    b: clamp(blue, 0, 255),
  };
}

/**
 * Clamps a value between a minimum and maximum value.
 * @param value - The value to be clamped.
 * @param min - The minimum allowed value.
 * @param max - The maximum allowed value.
 * @returns The clamped value.
 */
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Converts RGB values to HSV (Hue, Saturation, Value) representation.
 * @param r - The red component of the RGB color (0 to 255).
 * @param g - The green component of the RGB color (0 to 255).
 * @param b - The blue component of the RGB color (0 to 255).
 * @returns An object containing the HSV components.
 */
function rgbToHsv(r: number, g: number, b: number) {
  r /= 255, g /= 255, b /= 255; // Normalize RGB values to the range of 0 to 1

  // Find the maximum and minimum values among R, G, B
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0; // Initialize hue

  // Calculate hue component
  if (d !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / d) + (g < b ? 6 : 0);
        break;
      case g:
        h = ((b - r) / d) + 2;
        break;
      case b:
        h = ((r - g) / d) + 4;
        break;
    }
    h /= 6; // Normalize hue to the range of 0 to 1
  }

  const s = max === 0 ? 0 : d / max; // Calculate saturation
  const v = max; // Value is the maximum of R, G, B

  return { h, s, v }; // Return an object containing the calculated HSV components
}