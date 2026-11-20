import type { AlarmControl } from 'loxone-ts-client';
import type { BindingTable } from '../CharacteristicBinding';

// HAP SecuritySystem states: 0 STAY_ARM, 1 AWAY_ARM, 2 NIGHT_ARM, 3 DISARM(ED), 4 ALARM_TRIGGERED.
// Armed with movement disabled is shown as Night, otherwise Away.
const armedMode = (a: AlarmControl): number => (a.disabledMove ? 2 : 1);

export const alarmBindings: BindingTable<AlarmControl> = [
  {
    char: 'SecuritySystemCurrentState',
    get: (a) => {
      if ((a.level ?? 0) > 0) {
        return 4; // an active alarm level → triggered
      }
      if (!a.armed) {
        return 3; // disarmed
      }
      return armedMode(a);
    },
    subscribeTo: ['armed', 'level', 'disabledMove'],
  },
  {
    char: 'SecuritySystemTargetState',
    // Target never shows TRIGGERED (out of its 0..3 range); it stays at the armed mode.
    get: (a) => (!a.armed ? 3 : armedMode(a)),
    set: (a, value) => {
      const target = Number(value);
      if (target === 3) {
        return a.off(); // disarm
      }
      if (target === 2) {
        return a.delayedOnWithMovement(false); // night → arm without movement
      }
      return a.delayedOnWithMovement(true); // home/away → arm with movement
    },
    subscribeTo: ['armed', 'disabledMove'],
  },
];
