import type { InfoOnlyAnalogControl, InfoOnlyDigitalControl, PresenceDetectorControl } from 'loxone-ts-client';
import type { BindingTable } from '../CharacteristicBinding';

// --- analog (InfoOnlyAnalog → temperature / humidity / light) ----------------

export const temperatureBindings: BindingTable<InfoOnlyAnalogControl> = [
  { char: 'CurrentTemperature', get: (s) => s.value ?? 0, subscribeTo: 'value' },
];

export const humidityBindings: BindingTable<InfoOnlyAnalogControl> = [
  { char: 'CurrentRelativeHumidity', get: (s) => s.value ?? 0, subscribeTo: 'value' },
];

export const lightBindings: BindingTable<InfoOnlyAnalogControl> = [
  // HAP's CurrentAmbientLightLevel range is 0.0001–100000 lux; an outdoor sensor
  // can exceed the top, so clamp both ends.
  { char: 'CurrentAmbientLightLevel', get: (s) => Math.min(Math.max(s.value ?? 0, 0.0001), 100000), subscribeTo: 'value' },
];

// --- digital (InfoOnlyDigital → motion / smoke / leak) -----------------------

export const motionBindings: BindingTable<InfoOnlyDigitalControl> = [
  { char: 'MotionDetected', get: (s) => s.isActive ?? false, subscribeTo: 'active' },
];

export const smokeBindings: BindingTable<InfoOnlyDigitalControl> = [
  { char: 'SmokeDetected', get: (s) => s.isActive ?? false, subscribeTo: 'active' },
];

export const leakBindings: BindingTable<InfoOnlyDigitalControl> = [
  { char: 'LeakDetected', get: (s) => s.isActive ?? false, subscribeTo: 'active' },
];

// --- presence (PresenceDetector → occupancy) ---------------------------------

export const occupancyBindings: BindingTable<PresenceDetectorControl> = [
  { char: 'OccupancyDetected', get: (s) => s.active ?? false, subscribeTo: 'active' },
];
