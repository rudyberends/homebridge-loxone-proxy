import type { Service } from 'homebridge';
import type { NfcCodeTouchControl } from 'loxone-ts-client';
import type { LoxonePlatform } from '../../LoxonePlatform';

const MOTION_RESET_MS = 5000;

/**
 * Binds an NfcCodeTouch as a MotionSensor that pulses on every access. The block
 * has no on/off state; its `historyDate` (a ms timestamp) advances on every
 * access-history entry, granted or denied (Structure File, NFC Code Touch). A
 * change sets MotionDetected, which clears itself after {@link MOTION_RESET_MS}.
 * The first (replayed) historyDate is an existing entry, not a new event, so it
 * is recorded without firing.
 *
 * The keypad's bell button is not part of this block: it is wired in Config to
 * an Intercom (whose `bell` already rings the HomeKit doorbell), so it is never
 * mapped here.
 *
 * Returns a disposer that clears any pending motion reset and the subscription.
 */
export function bindNfcCodeTouch(
  platform: LoxonePlatform,
  service: Service,
  control: NfcCodeTouchControl,
): () => void {
  const C = platform.Characteristic;
  let initialized = false;
  let lastHistoryDate = 0;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  service.getCharacteristic(C.MotionDetected).onGet(() => false);

  const trigger = (): void => {
    service.updateCharacteristic(C.MotionDetected, true);
    if (resetTimer) {
      clearTimeout(resetTimer);
    }
    resetTimer = setTimeout(() => service.updateCharacteristic(C.MotionDetected, false), MOTION_RESET_MS);
    if (typeof resetTimer.unref === 'function') {
      resetTimer.unref();
    }
  };

  const onHistory = (): void => {
    const ts = control.historyDate ?? 0;
    if (!initialized) {
      initialized = true;
      lastHistoryDate = ts;
      return;
    }
    if (ts === 0 || ts === lastHistoryDate) {
      return;
    }
    lastHistoryDate = ts;
    platform.log.debug(`[${control.name}] NFC access event → motion`);
    trigger();
  };

  const dispose = control.onState('historyDate', () => onHistory(), { emitCurrent: true });
  return () => {
    if (resetTimer) {
      clearTimeout(resetTimer);
    }
    dispose();
  };
}
