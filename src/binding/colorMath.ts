/**
 * Colour-space conversions for the ColorPickerV2 binder — HomeKit conventions
 * (mired 153–500, hue 0–360, saturation 0–100) ↔ Loxone (Kelvin 2700–6500).
 * Ported from the legacy ColorLightBulb service so behaviour matches exactly.
 */

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/** HomeKit mired (153–500) → Loxone colour temperature in Kelvin (2700–6500). */
export function miredToKelvin(mired: number): number {
  const percent = 1 - (mired - 153) / (500 - 153);
  return Math.round(2700 + (6500 - 2700) * percent);
}

/** Loxone Kelvin (2700–6500) → HomeKit mired (153–500). */
export function kelvinToMired(kelvin: number): number {
  const percent = 1 - (kelvin - 2700) / (6500 - 2700);
  return Math.round(153 + (500 - 153) * percent);
}

/** Approximates an RGB colour for a colour temperature in Kelvin. */
export function kelvinToRgb(kelvin: number): { r: number; g: number; b: number } {
  const t = kelvin / 100;
  let red: number;
  let green: number;
  let blue: number;

  if (t <= 66) {
    red = 255;
    green = 99.4708025861 * Math.log(t) - 161.1195681661;
    blue = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    red = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    green = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    blue = 255;
  }

  return { r: clamp(red, 0, 255), g: clamp(green, 0, 255), b: clamp(blue, 0, 255) };
}

/** RGB (0–255) → HSV with hue 0–1, saturation 0–1, value 0–1. */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rn) {
      h = (gn - bn) / d + (gn < bn ? 6 : 0);
    } else if (max === gn) {
      h = (bn - rn) / d + 2;
    } else {
      h = (rn - gn) / d + 4;
    }
    h /= 6;
  }

  return { h, s: max === 0 ? 0 : d / max, v: max };
}
