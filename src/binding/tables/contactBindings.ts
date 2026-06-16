import type { WindowMonitorControl } from 'loxone-ts-client';
import type { BindingTable } from '../CharacteristicBinding';

/**
 * One monitored window/door of a WindowMonitor → ContactSensorState. A window is
 * "open" (1, CONTACT_NOT_DETECTED) when open or tilted, else closed (0); the lock
 * bits are ignored, and an offline/unknown window reads closed (the safe default).
 */
export function contactBindings(windowIndex: number): BindingTable<WindowMonitorControl> {
  return [
    {
      char: 'ContactSensorState',
      get: (m) => {
        const window = m.windowStatuses?.[windowIndex];
        return window && (window.open || window.tilted) ? 1 : 0;
      },
      subscribeTo: 'windowStates',
    },
  ];
}
