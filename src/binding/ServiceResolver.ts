import { Service, type WithUUID } from 'homebridge';
import type { ControlHandle, InfoOnlyAnalogControl, InfoOnlyDigitalControl, SwitchControl } from 'loxone-ts-client';
import type { LoxonePlatform } from '../LoxonePlatform';
import type { BindingTable } from './CharacteristicBinding';
import {
  humidityBindings,
  leakBindings,
  lightBindings,
  motionBindings,
  smokeBindings,
  temperatureBindings,
} from './tables/sensorBindings';
import { lockBindings, onOffBindings } from './tables/switchBindings';

/** The HomeKit service kind a control resolves to, plus the table that drives it. */
export interface ResolvedService<H extends ControlHandle> {
  kind: WithUUID<typeof Service>;
  table: BindingTable<H>;
}

interface SwitchAliasConfig {
  Lock?: string;
  Outlet?: string;
  ReverseLockSwitch?: boolean;
}

type SwitchKind = 'lock' | 'outlet' | 'lightbulb' | 'switch';

/**
 * Picks the HomeKit service kind for a Switch from DECLARED metadata — the
 * category type, the category/control icon, an explicit `details.serviceType` —
 * plus the user's `switchAlias` config. No name/icon regex guessing buried in a
 * service class. A Switch becomes a Lightbulb (category `lights`), a
 * LockMechanism, an Outlet, or a plain Switch.
 */
export function resolveSwitchService(platform: LoxonePlatform, sw: SwitchControl): ResolvedService<SwitchControl> {
  const alias = (platform.config.switchAlias ?? {}) as SwitchAliasConfig;

  switch (classifySwitch(sw, alias)) {
    case 'lock':
      return { kind: platform.Service.LockMechanism, table: lockBindings(Boolean(alias.ReverseLockSwitch)) };
    case 'outlet':
      return { kind: platform.Service.Outlet, table: onOffBindings };
    case 'lightbulb':
      return { kind: platform.Service.Lightbulb, table: onOffBindings };
    default:
      return { kind: platform.Service.Switch, table: onOffBindings };
  }
}

/**
 * Resolves an InfoOnlyAnalog sensor to a HomeKit sensor kind from the library's
 * `control.sensorKind` — which already guards ambiguous units (a power `%`, a
 * valve/level `%`, or a set-point is NOT classified as humidity/temperature), so
 * the classification stays consistent everywhere — falling back to the explicit
 * `InfoOnlyAnalogAlias` config. Returns `undefined` when it is not a recognised
 * sensor (not exposed — matches the legacy "unsupported" skip).
 */
export function resolveAnalogSensor(
  platform: LoxonePlatform,
  sensor: InfoOnlyAnalogControl,
): ResolvedService<InfoOnlyAnalogControl> | undefined {
  switch (sensor.control.sensorKind) {
    case 'temperature':
      return { kind: platform.Service.TemperatureSensor, table: temperatureBindings };
    case 'illuminance':
      return { kind: platform.Service.LightSensor, table: lightBindings };
    case 'humidity':
      return { kind: platform.Service.HumiditySensor, table: humidityBindings };
    default:
      break; // power / pressure / unclassified → try the explicit alias config
  }

  // Parity fallback: explicit name-alias config (InfoOnlyAnalogAlias).
  const aliases = (platform.config.InfoOnlyAnalogAlias ?? {}) as Record<string, string>;
  for (const [key, alias] of Object.entries(aliases)) {
    if (!matchInfoAlias(sensor.name, alias)) {
      continue;
    }
    if (key.trim() === 'Temperature') {
      return { kind: platform.Service.TemperatureSensor, table: temperatureBindings };
    }
    if (key.trim() === 'Brightness') {
      return { kind: platform.Service.LightSensor, table: lightBindings };
    }
    if (key.trim() === 'Humidity') {
      return { kind: platform.Service.HumiditySensor, table: humidityBindings };
    }
  }
  return undefined;
}

/**
 * Resolves an InfoOnlyDigital sensor to a HomeKit sensor kind from the explicit
 * `InfoOnlyDigitalAlias` config (Motion / Smoke / Leak). Returns `undefined`
 * when no alias matches (not exposed — matches the legacy behaviour).
 */
export function resolveDigitalSensor(
  platform: LoxonePlatform,
  sensor: InfoOnlyDigitalControl,
): ResolvedService<InfoOnlyDigitalControl> | undefined {
  const aliases = (platform.config.InfoOnlyDigitalAlias ?? {}) as Record<string, string>;
  for (const [key, alias] of Object.entries(aliases)) {
    if (!matchInfoAlias(sensor.name, alias)) {
      continue;
    }
    if (key === 'Motion') {
      return { kind: platform.Service.MotionSensor, table: motionBindings };
    }
    if (key === 'Smoke') {
      return { kind: platform.Service.SmokeSensor, table: smokeBindings };
    }
    if (key === 'Leak') {
      return { kind: platform.Service.LeakSensor, table: leakBindings };
    }
  }
  return undefined;
}

function classifySwitch(sw: SwitchControl, alias: SwitchAliasConfig): SwitchKind {
  const override = readServiceTypeOverride(sw);
  if (override === 'lock' || override === 'outlet') {
    return override;
  }

  // A `switch` override skips icon/alias detection but still allows lights → Lightbulb.
  if (override !== 'switch') {
    if (matchesIcon(sw, 'lock') || matchesAlias(sw.name, alias.Lock)) {
      return 'lock';
    }
    if (matchesIcon(sw, 'outlet') || matchesAlias(sw.name, alias.Outlet)) {
      return 'outlet';
    }
  }

  return sw.category?.type === 'lights' ? 'lightbulb' : 'switch';
}

function readServiceTypeOverride(sw: SwitchControl): string | undefined {
  const serviceType = sw.control.details['serviceType'];
  return typeof serviceType === 'string' ? serviceType : undefined;
}

function matchesIcon(sw: SwitchControl, needle: string): boolean {
  return [sw.control.categoryIcon, sw.control.defaultIcon].some(
    (icon) => (icon ?? '').toLowerCase().includes(needle),
  );
}

// Switch aliases match on whole words (legacy Switch.determineSwitchType).
function matchesAlias(name: string, alias?: string): boolean {
  if (!alias) {
    return false;
  }
  return new RegExp(`\\b${alias.toLowerCase()}\\b`, 'i').test(name);
}

// InfoOnly aliases use Loxone's `%` wildcard convention (legacy LoxoneAccessory.matchAlias).
function matchInfoAlias(name: string, alias?: string): boolean {
  if (!alias) {
    return false;
  }
  const pattern = alias.trim().replace(/%/g, '.*').replace(/\s+/g, '\\s*');
  return new RegExp(pattern, 'i').test(name.trim());
}
