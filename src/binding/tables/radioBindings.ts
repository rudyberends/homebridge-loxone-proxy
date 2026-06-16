import type { RadioControl } from 'loxone-ts-client';
import type { BindingTable } from '../CharacteristicBinding';

/**
 * One radio output as a Switch. `outputId` 0 is the synthetic "All Off" entry
 * (turning it on sends `reset`); a positive id selects that output. The output
 * reads as on when it is the radio's `activeOutput`. Radio outputs are mutually
 * exclusive, so turning one OFF sends nothing (you switch off by selecting another).
 */
export function radioOutputBindings(outputId: number): BindingTable<RadioControl> {
  return [
    {
      char: 'On',
      get: (r) => (r.activeOutput ?? 0) === outputId,
      set: (r, value) => {
        if (!value) {
          return Promise.resolve();
        }
        return outputId === 0 ? r.reset() : r.select(outputId);
      },
      subscribeTo: 'activeOutput',
    },
  ];
}
