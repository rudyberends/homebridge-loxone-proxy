import type { SmokeAlarmControl } from 'loxone-ts-client';
import type { BindingTable } from '../CharacteristicBinding';

const SMOKE = 0x01;
const WATER = 0x02;

const isActive = (a: SmokeAlarmControl): boolean => (a.level ?? 0) >= 1;
const hasCause = (a: SmokeAlarmControl, bit: number): boolean => ((a.alarmCause ?? 0) & bit) !== 0;

/**
 * A SmokeAlarm split across HomeKit sensors: smoke → SmokeSensor, water →
 * LeakSensor. `level >= 1` means an alarm; `alarmCause` is a bitmask of what
 * tripped. A smoke-only device treats any alarm as smoke; a combined device
 * requires the matching cause bit.
 */
export function smokeAlarmBindings(kind: 'smoke' | 'water', monitorsWater: boolean): BindingTable<SmokeAlarmControl> {
  if (kind === 'water') {
    return [{
      char: 'LeakDetected',
      get: (a) => isActive(a) && hasCause(a, WATER),
      subscribeTo: ['level', 'alarmCause'],
    }];
  }
  return [{
    char: 'SmokeDetected',
    get: (a) => (monitorsWater ? isActive(a) && hasCause(a, SMOKE) : isActive(a)),
    subscribeTo: ['level', 'alarmCause'],
  }];
}
