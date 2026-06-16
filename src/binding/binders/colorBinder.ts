import type { Service } from 'homebridge';
import type { ColorPickerV2Control } from 'loxone-ts-client';
import type { LoxonePlatform } from '../../LoxonePlatform';
import { kelvinToMired, kelvinToRgb, miredToKelvin, rgbToHsv } from '../colorMath';
import { toHapStatusError } from '../hapError';

/**
 * Binds a ColorPickerV2 to a Lightbulb with colour + colour-temperature support.
 *
 * Stateful by necessity: HomeKit writes On/Brightness/Hue/Saturation/
 * ColorTemperature as SEPARATE characteristic sets, but Loxone expects one
 * combined `hsv(h,s,v)` / `temp(brightness,kelvin)` command — so the binder keeps
 * the accumulated state, tracks which mode the last edit implied, and re-sends the
 * full command on each change. Incoming `color` state updates parse back into the
 * five characteristics (a `temp(...)` is also rendered as hue/sat for display).
 *
 * Returns a disposer that drops the `color` subscription.
 */
export function bindColorPicker(platform: LoxonePlatform, service: Service, control: ColorPickerV2Control): () => void {
  const C = platform.Characteristic;
  const state = { On: false, Brightness: 0, Hue: 0, Saturation: 0, ColorTemperature: 153 };
  let mode: 'color' | 'colortemperature' = 'color';
  let lastOnBrightness = 100;

  const rememberOnBrightness = (): void => {
    if (state.Brightness > 0) {
      lastOnBrightness = state.Brightness;
    }
  };

  const send = async (): Promise<void> => {
    try {
      if (mode === 'colortemperature') {
        await control.setTemperature(state.Brightness, miredToKelvin(state.ColorTemperature));
      } else {
        await control.setRgb(state.Hue, state.Saturation, state.Brightness);
      }
      state.On = state.Brightness > 0;
      rememberOnBrightness();
    } catch (error) {
      throw toHapStatusError(platform, error);
    }
  };

  service.getCharacteristic(C.On)
    .onGet(() => state.On)
    .onSet(async (value) => {
      if (!value) {
        rememberOnBrightness();
        state.Brightness = 0;
        await send();
        return;
      }
      state.On = true;
      if (state.Brightness === 0) {
        state.Brightness = lastOnBrightness;
        await send();
      }
    });

  service.getCharacteristic(C.Brightness)
    .onGet(() => state.Brightness)
    .onSet(async (value) => {
      state.Brightness = Number(value);
      state.On = state.Brightness > 0;
      await send();
    });

  service.getCharacteristic(C.Hue)
    .onGet(() => state.Hue)
    .onSet(async (value) => {
      state.Hue = Number(value);
      mode = 'color';
      await send();
    });

  service.getCharacteristic(C.Saturation)
    .onGet(() => state.Saturation)
    .onSet(async (value) => {
      state.Saturation = Number(value);
      mode = 'color';
      await send();
    });

  service.getCharacteristic(C.ColorTemperature)
    .onGet(() => state.ColorTemperature)
    .onSet(async (value) => {
      state.ColorTemperature = Number(value);
      mode = 'colortemperature';
      await send();
    });

  const applyColor = (): void => {
    const color = control.color;
    if (!color) {
      return;
    }
    if (color.kind === 'hsv') {
      state.Hue = color.hue;
      state.Saturation = color.saturation;
      state.Brightness = color.brightness;
      mode = 'color';
    } else if (color.kind === 'temp') {
      const rgb = kelvinToRgb(color.kelvin);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      state.ColorTemperature = kelvinToMired(color.kelvin);
      state.Hue = 360 * hsv.h;
      state.Saturation = hsv.s * 100;
      state.Brightness = color.brightness;
      mode = 'colortemperature';
    } else {
      return; // raw/unparseable — leave the last known state
    }
    state.On = state.Brightness > 0;
    rememberOnBrightness();

    service.getCharacteristic(C.On).updateValue(state.On);
    service.getCharacteristic(C.Brightness).updateValue(state.Brightness);
    service.getCharacteristic(C.Hue).updateValue(state.Hue);
    service.getCharacteristic(C.Saturation).updateValue(state.Saturation);
    service.getCharacteristic(C.ColorTemperature).updateValue(state.ColorTemperature);
  };

  return control.onState('color', () => applyColor(), { emitCurrent: true });
}
