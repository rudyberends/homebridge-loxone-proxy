import type { PushbuttonControl } from 'loxone-ts-client';
import type { BindingTable } from '../CharacteristicBinding';

/**
 * Pushbutton → Switch, momentary. An ON tap sends `pulse` (a short press); OFF
 * sends nothing. Loxone pulses the `active` state back, so the switch shows on
 * then self-resets to off — exactly the momentary scene/pushbutton behaviour.
 */
export const pushbuttonBindings: BindingTable<PushbuttonControl> = [
  {
    char: 'On',
    get: (p) => p.isActive ?? false,
    set: (p, value) => (value ? p.pulse() : Promise.resolve()),
    subscribeTo: 'active',
  },
];
