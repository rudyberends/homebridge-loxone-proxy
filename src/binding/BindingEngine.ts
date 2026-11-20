import type { Characteristic, Service, WithUUID } from 'homebridge';
import type { ControlHandle } from 'loxone-ts-client';
import type { LoxonePlatform } from '../LoxonePlatform';
import type { BindingTable } from './CharacteristicBinding';
import { toHapStatusError } from './hapError';

type CharacteristicConstructor = WithUUID<new () => Characteristic>;

/**
 * Wires a binding table onto a HomeKit service: an `onGet`/`onSet` handler and a
 * live-state subscription per characteristic. Generic over every control type —
 * the only per-type knowledge lives in the table.
 *
 * Build the service BEFORE calling this: `subscribeTo` replays the current value
 * synchronously (`emitCurrent`), so the characteristic must already exist.
 *
 * Returns a disposer that drops the state subscriptions; call it before
 * re-binding the same service on a rebuild so listeners don't accumulate.
 */
export function bindCharacteristics<H extends ControlHandle>(
  platform: LoxonePlatform,
  service: Service,
  handle: H,
  bindings: BindingTable<H>,
): () => void {
  const disposers: Array<() => void> = [];
  const characteristics = platform.Characteristic as unknown as Record<string, CharacteristicConstructor>;

  for (const binding of bindings) {
    const ctor = characteristics[binding.char];
    if (!ctor) {
      platform.log.warn(`[BindingEngine] Unknown characteristic "${binding.char}" on ${handle.name}`);
      continue;
    }

    const characteristic = service.getCharacteristic(ctor);
    characteristic.onGet(() => binding.get(handle));

    if (binding.set) {
      const set = binding.set;
      characteristic.onSet(async (value) => {
        try {
          await set(handle, value);
        } catch (error) {
          throw toHapStatusError(platform, error);
        }
      });
    }

    for (const state of toArray(binding.subscribeTo)) {
      try {
        disposers.push(
          handle.onState(state, () => characteristic.updateValue(binding.get(handle)), { emitCurrent: true }),
        );
      } catch (error) {
        // A control may legitimately lack an optional state (structure variation);
        // skip its live push — onGet still serves the current value — rather than
        // failing the whole bind via requireState's fail-loud throw.
        platform.log.warn(
          `[BindingEngine] ${handle.name}: cannot subscribe to "${state}" for ${binding.char} (${(error as Error).message})`,
        );
      }
    }
  }

  return () => disposers.forEach((dispose) => dispose());
}

function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}
