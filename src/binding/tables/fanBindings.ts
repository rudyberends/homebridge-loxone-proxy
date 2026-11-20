import type { VentilationControl } from 'loxone-ts-client';
import type { BindingTable } from '../CharacteristicBinding';

/** Per-accessory memory so a bare "switch on" restores the last running speed. */
export interface FanMemory {
  lastOnSpeed: number;
}

/**
 * Ventilation → Fanv2. Loxone ventilation has no plain on/off or set-speed; manual
 * control is a timer (`setTimer/{interval}/{speed}/{modeId}/-1`), and "off" returns
 * to automatic (`setTimer/0`). `manualSeconds` is the configured override duration.
 */
export function fanBindings(manualSeconds: number, memory: FanMemory): BindingTable<VentilationControl> {
  const start = (fan: VentilationControl, speed: number): Promise<void> =>
    fan.setTimer(manualSeconds, speed, fan.mode ?? 0, -1);

  return [
    {
      char: 'Active',
      get: (fan) => ((fan.speed ?? 0) > 0 ? 1 : 0),
      set: (fan, value) => {
        if (!value) {
          return fan.stopTimer();
        }
        const current = fan.speed ?? 0;
        return start(fan, current > 0 ? current : memory.lastOnSpeed);
      },
      subscribeTo: 'speed',
    },
    {
      char: 'RotationSpeed',
      get: (fan) => {
        const speed = fan.speed ?? 0;
        if (speed > 0) {
          memory.lastOnSpeed = speed; // remember so a bare "on" restores this speed
        }
        return speed;
      },
      set: (fan, value) => {
        const speed = Number(value);
        if (speed <= 0) {
          return fan.stopTimer();
        }
        memory.lastOnSpeed = speed;
        return start(fan, speed);
      },
      subscribeTo: 'speed',
    },
  ];
}
