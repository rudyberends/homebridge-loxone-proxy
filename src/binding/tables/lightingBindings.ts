import type { DimmerControl } from 'loxone-ts-client';
import type { BindingTable } from '../CharacteristicBinding';

/**
 * Dimmer (and EIBDimmer, which reuses this) → Lightbulb. Both On and Brightness
 * derive from the single `position` state (0–100); `setPosition` clamps to the
 * control's `[min, max]`.
 */
export const dimmerBindings: BindingTable<DimmerControl> = [
  {
    char: 'On',
    get: (d) => (d.position ?? 0) > 0,
    set: (d, value) => (value ? d.on() : d.off()),
    subscribeTo: 'position',
  },
  {
    char: 'Brightness',
    get: (d) => d.position ?? 0,
    set: (d, value) => d.setPosition(Number(value)),
    subscribeTo: 'position',
  },
];
