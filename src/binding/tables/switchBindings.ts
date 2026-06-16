import type { SwitchControl } from 'loxone-ts-client';
import type { BindingTable } from '../CharacteristicBinding';

/**
 * On/off binding shared by every Switch that maps to a characteristic with an
 * `On` boolean — a plain Switch, an Outlet, or a non-dimmable Lightbulb.
 */
export const onOffBindings: BindingTable<SwitchControl> = [
  {
    char: 'On',
    get: (sw) => sw.isOn ?? false,
    set: (sw, value) => sw.set(Boolean(value)),
    subscribeTo: 'active',
  },
];

/**
 * Lock binding for a Switch exposed as a LockMechanism. HomeKit lock states are
 * 0 = UNSECURED, 1 = SECURED; without reversal a SECURED lock corresponds to the
 * Loxone switch being on, and `ReverseLockSwitch` flips that.
 *
 * Current state mirrors target state immediately — the live Loxone `active`
 * state is authoritative — replacing the legacy fixed 6s "locking…" animation,
 * so HomeKit now reflects the real lock state instead of an optimistic guess.
 */
export function lockBindings(reverse: boolean): BindingTable<SwitchControl> {
  const toHomeKit = (sw: SwitchControl): number => {
    const active = sw.isOn ? 1 : 0;
    return reverse ? 1 - active : active;
  };

  return [
    {
      char: 'LockCurrentState',
      get: toHomeKit,
      subscribeTo: 'active',
    },
    {
      char: 'LockTargetState',
      get: toHomeKit,
      set: (sw, value) => {
        const target = Number(value);
        const on = reverse ? target !== 0 : target === 0;
        return sw.set(on);
      },
      subscribeTo: 'active',
    },
  ];
}
