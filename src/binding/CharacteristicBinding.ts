import type { CharacteristicValue } from 'homebridge';
import type { ControlHandle } from 'loxone-ts-client';

/**
 * A pure, declarative mapping of ONE HomeKit characteristic onto a typed Loxone
 * control handle. These three functions are the only per-type knowledge the
 * {@link ./BindingEngine}'s engine needs; everything else (service creation,
 * subscription, command-error mapping) is generic.
 *
 * HAP-convention math (0..100, mired, −90..90 tilt, position reversal) lives in
 * `get`/`set` — never pushed into the library.
 */
export interface CharacteristicBinding<H extends ControlHandle> {
  /** Key into `platform.Characteristic`, e.g. `'On'`, `'LockTargetState'`. */
  char: string;
  /** Reads the current HomeKit value from the handle's live typed getters. */
  get: (handle: H) => CharacteristicValue;
  /** Writes a HomeKit value back to Loxone. Omit for read-only characteristics. */
  set?: (handle: H, value: CharacteristicValue) => Promise<unknown>;
  /**
   * Name(s) of the lox-api State whose change should re-push `get()` to HomeKit.
   * Omit for derived/write-only characteristics.
   */
  subscribeTo?: string | string[];
}

/** A per-service-kind table of characteristic bindings. */
export type BindingTable<H extends ControlHandle> = ReadonlyArray<CharacteristicBinding<H>>;
