import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { LoxonePlatform } from '../LoxonePlatform';
import { Control } from '../structure/LoxAPP3';

export class ColorPickerV2 {
  private service: Service;
  private device: Control;

  private lastsetmode = '';
  private lastUpdate = 0;

  private State = {
    On: false,
    Brightness: 0,
    Hue: 0,
    Saturation: 0,
    ColorTemperature: 153,
  };

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.device = this.accessory.context.device;

    this.service =
      this.accessory.getService(this.platform.Service.Lightbulb) ||
      this.accessory.addService(this.platform.Service.Lightbulb);

    this.LoxoneListener();

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))   // SET - bind to the `setOn` method below
      .onGet(this.getOn.bind(this));  // GET - bind to the `getOn` method below

    this.service.getCharacteristic(this.platform.Characteristic.Brightness)
      .onSet(this.setBrightness.bind(this))
      .onGet(this.getBrightness.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.Hue)
      .onSet(this.setHue.bind(this))
      .onGet(this.getHue.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.Saturation)
      .onSet(this.setSaturation.bind(this))
      .onGet(this.getSaturation.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.ColorTemperature)
      .onSet(this.setColorTemperature.bind(this))
      .onGet(this.getColorTemperature.bind(this));
  }

  // Register a listener to be notified of changes in this items value
  LoxoneListener = () => {

    this.platform.log.debug(`[${this.device.name}] Register Listener for ColorPicker`);
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.color, this.callBack.bind(this));
  };

  callBack = ( value: string ) => {
    this.platform.log.debug(`[${this.device.name}] Callback state update for ColorPicker: ${value}`);

    // Code taken from Homebridge-Loxone-Connect
    //incoming value is a HSV string that needs to be parsed
    let m;

    // eslint-disable-next-line no-cond-assign
    if (m = value.match(/^\W*hsv?\(([^)]*)\)\W*$/i)) {
      const params = m[1].split(',');
      const re = /^\s*(\d*)(\.\d+)?\s*$/;
      let mH, mS, mV;
      if (
        params.length >= 3 &&
            (mH = params[0].match(re)) &&
            (mS = params[1].match(re)) &&
            (mV = params[2].match(re))
      ) {
        this.State.Hue = parseFloat((mH[1] || '0') + (mH[2] || ''));
        this.State.Saturation = parseFloat((mS[1] || '0') + (mS[2] || ''));
        this.State.Brightness = parseFloat((mV[1] || '0') + (mV[2] || ''));
        this.State.On = this.State.Brightness > 0;

        this.lastsetmode = 'color';
      }

    // eslint-disable-next-line no-cond-assign
    } else if (m = value.match(/^\W*temp?\(([^)]*)\)\W*$/i)) {
      const params = m[1].split(',');

      this.lastsetmode = 'colortemperature';

      this.State.Brightness = parseInt(params[0]);
      this.State.ColorTemperature = loxoneToHomekitColorTemperature(parseInt(params[1]), this);
      this.State.On = this.State.Brightness > 0;

      const rgb = colorTemperatureToRGB(parseInt(params[1]));
      const hsv: { h: number; s: number; v: number} = rgbToHsv(rgb.r, rgb.g, rgb.b);

      const new_hue = 360 * hsv.h;
      const new_sat = hsv.s * 100;

      this.State.Hue = new_hue;
      this.State.Saturation = new_sat;

      this.service
        .getCharacteristic(this.platform.Characteristic.On)
        .updateValue(this.State.On);
    }

    //also make sure this change is directly communicated to HomeKit
    this.service
      .getCharacteristic(this.platform.Characteristic.Hue)
      .updateValue(this.State.Hue);
    this.service
      .getCharacteristic(this.platform.Characteristic.Saturation)
      .updateValue(this.State.Saturation);
    this.service
      .getCharacteristic(this.platform.Characteristic.ColorTemperature)
      .updateValue(this.State.ColorTemperature);
    this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .updateValue(this.State.On);
    this.service
      .getCharacteristic(this.platform.Characteristic.Brightness)
      .updateValue(this.State.Brightness);
  };

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

  async getOn(): Promise<CharacteristicValue> {
    const isOn = this.State.On;
    this.platform.log.debug('Get Characteristic On ->', isOn);
    return isOn;
  }

  async setBrightness(value: CharacteristicValue) {
    this.State.Brightness = value as number;
    this.State.On = this.State.Brightness > 0;
    this.setColorState();
  }

  async getBrightness() {
    return this.State.Brightness;
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

// transform Loxone color temperature (expressed in Kelvins 2700-6500k to Homekit values 140-500)
function loxoneToHomekitColorTemperature(ct, obj) {

  const minCtLoxone = 2700;
  const maxCtLoxone = 6500;

  const minCtHomekit = 153;
  const maxCtHomekit = 500;

  const percent = 1 - ((ct - minCtLoxone) / (maxCtLoxone - minCtLoxone));
  const newValue = Math.round(minCtHomekit + ((maxCtHomekit - minCtHomekit) * percent));

  //obj.log('loxoneToHomekitColorTemperature - Loxone Value: ' + ct);
  //obj.log('loxoneToHomekitColorTemperature - Percent: ' + percent + '%');
  //obj.log('loxoneToHomekitColorTemperature - Homekit Value: ' + newValue);

  return newValue;
}

// transform Homekit color temperature (expressed 140-500 to Loxone values expressed in Kelvins 2700-6500k)
function homekitToLoxoneColorTemperature(ct, obj) {

  const minCtLoxone = 2700;
  const maxCtLoxone = 6500;

  const minCtHomekit = 153;
  const maxCtHomekit = 500;

  const percent = 1 - ((ct - minCtHomekit) / (maxCtHomekit - minCtHomekit));
  const newValue = Math.round(minCtLoxone + ((maxCtLoxone - minCtLoxone) * percent));

  //obj.log('homekitToLoxoneColorTemperature - Homekit Value: ' + ct);
  //obj.log('homekitToLoxoneColorTemperature - Percent: ' + percent + '%');
  //obj.log('homekitToLoxoneColorTemperature - Loxone Value: ' + newValue);

  return newValue;
}

/**
* Converts an RGB color value to HSL. Conversion formula
* adapted from http://en.wikipedia.org/wiki/HSL_color_space.
* Assumes r, g, and b are contained in the set [0, 255] and
* returns h, s, and l in the set [0, 1].
*
* @param   Number  r       The red color value
* @param   Number  g       The green color value
* @param   Number  b       The blue color value
* @return  Array           The HSL representation
*/
function rgbToHsl(r, g, b) {
  r /= 255, g /= 255, b /= 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h;
  let s;
  const l = (max + min) / 2;

  if (max == min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }

    h /= 6;
  }

  return {
    h,
    s,
    l,
  };
}

/**
* Converts an RGB color value to HSV. Conversion formula
* adapted from http://en.wikipedia.org/wiki/HSV_color_space.
* Assumes r, g, and b are contained in the set [0, 255] and
* returns h, s, and v in the set [0, 1].
*
* @param   Number  r       The red color value
* @param   Number  g       The green color value
* @param   Number  b       The blue color value
* @return  Array           The HSV representation
*/
function rgbToHsv(r, g, b) {
  r /= 255, g /= 255, b /= 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h;
  const v = max;

  const d = max - min;
  const s = max === 0 ? 0 : d / max;

  if (max === min) {
    h = 0; // achromatic
  } else {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }

    h /= 6;
  }

  //return [ h, s, v ];

  return {
    h,
    s,
    v,
  };
}

// From http://www.tannerhelland.com/4435/convert-temperature-rgb-algorithm-code/
// Start with a temperature, in Kelvin, somewhere between 1000 and 40000.  (Other values may work,
//  but I can't make any promises about the quality of the algorithm's estimates above 40000 K.)
function colorTemperatureToRGB(kelvin){
  const temp = kelvin / 100;
  let red, green, blue;

  if( temp <= 66 ){

    red = 255;

    green = temp;
    green = 99.4708025861 * Math.log(green) - 161.1195681661;


    if( temp <= 19){

      blue = 0;

    } else {

      blue = temp-10;
      blue = 138.5177312231 * Math.log(blue) - 305.0447927307;

    }

  } else {

    red = temp - 60;
    red = 329.698727446 * (red ** -0.1332047592);

    green = temp - 60;
    green = 288.1221695283 * (green ** -0.0755148492);

    blue = 255;

  }


  return {
    r : parseInt(clamp(red, 0, 255)),
    g : parseInt(clamp(green, 0, 255)),
    b : parseInt(clamp(blue, 0, 255)),
  };
}

function clamp( x, min, max ) {
  if(x<min){
    return min;
  }
  if(x>max){
    return max;
  }
  return x;
}
