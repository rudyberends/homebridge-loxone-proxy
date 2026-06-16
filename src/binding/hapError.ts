import { LoxoneCommandError } from 'loxone-ts-client';
import type { LoxonePlatform } from '../LoxonePlatform';

/**
 * Maps a {@link LoxoneCommandError} to the closest HAP status, so a failed write
 * surfaces correctly in HomeKit. Shared by the BindingEngine and the stateful
 * binders (e.g. the color binder).
 */
export function toHapStatusError(platform: LoxonePlatform, error: unknown): Error {
  const hap = platform.api.hap;
  if (error instanceof LoxoneCommandError && (error.kind === 'unauthorized' || error.kind === 'locked')) {
    return new hap.HapStatusError(hap.HAPStatus.INSUFFICIENT_PRIVILEGES);
  }
  return new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
}
