import { LOXONE_EPOCH_MS, type IRoomControllerV2Control } from 'loxone-ts-client';
import type { BindingTable } from '../CharacteristicBinding';

// HomeKit's CurrentTemperature/TargetTemperature are clamped to a sane room range.
const limit = (temp: number): number => Math.max(10, Math.min(38, temp));

// Loxone operatingMode (-1 Off, 0/3 Auto H+C, 1/4 Heat, 2/5 Cool) → HomeKit
// TargetHeatingCoolingState (0 Off, 1 Heat, 2 Cool, 3 Auto).
function targetMode(operatingMode: number | undefined): number {
  switch (operatingMode) {
    case -1:
      return 0;
    case 1:
    case 4:
      return 1;
    case 2:
    case 5:
      return 2;
    default:
      return 3;
  }
}

// End of an override: the next local midnight, in seconds since the Loxone epoch.
function nextMidnightLoxoneSeconds(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.round((next.getTime() - LOXONE_EPOCH_MS) / 1000);
}

export function thermostatBindings(displayUnits: number): BindingTable<IRoomControllerV2Control> {
  return [
    { char: 'CurrentTemperature', get: (c) => limit(c.temperature ?? 15), subscribeTo: 'tempActual' },
    {
      char: 'TargetTemperature',
      get: (c) => limit(c.targetTemperature ?? 15),
      // modeId 3 = Manual; override until the next midnight (spec-correct positional command).
      set: (c, value) => c.override(3, nextMidnightLoxoneSeconds(), Number(value)),
      subscribeTo: 'tempTarget',
    },
    {
      char: 'CurrentHeatingCoolingState',
      // Heating when below target, else Off (Loxone IRC exposes no live cool indicator here).
      get: (c) => ((c.temperature ?? 0) < (c.targetTemperature ?? 0) ? 1 : 0),
      subscribeTo: ['tempActual', 'tempTarget'],
    },
    {
      char: 'TargetHeatingCoolingState',
      get: (c) => targetMode(c.operatingMode),
      // Loxone drives the operating mode; HomeKit mode changes are not pushed back (legacy parity).
      set: () => Promise.resolve(),
      subscribeTo: 'operatingMode',
    },
    { char: 'TemperatureDisplayUnits', get: () => displayUnits },
  ];
}
