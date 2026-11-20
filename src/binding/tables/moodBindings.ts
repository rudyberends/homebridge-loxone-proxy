import type { LightControllerV2Control } from 'loxone-ts-client';
import type { BindingTable } from '../CharacteristicBinding';

/**
 * One LightControllerV2 mood as a Switch: on when the mood is active, and turning
 * it on selects that mood (`changeTo/{id}`). Moods are mutually exclusive, so OFF
 * sends nothing — you switch moods by turning another on (or the All-Off mood).
 */
export function moodBindings(moodId: number | string): BindingTable<LightControllerV2Control> {
  return [
    {
      char: 'On',
      get: (lc) => (lc.activeMoods ?? []).some((id) => String(id) === String(moodId)),
      set: (lc, value) => (value ? lc.selectMood(moodId) : Promise.resolve()),
      subscribeTo: 'activeMoods',
    },
  ];
}
