import type { Service } from 'homebridge';
import type { NfcCodeTouchControl } from 'loxone-ts-client';
import type { LoxonePlatform } from '../../LoxonePlatform';

/** How an NFC Code Touch access event surfaces in HomeKit. */
export type NfcMapping = 'DoorBell' | 'MotionSensor';

const MOTION_RESET_MS = 5000;

/**
 * Binds an NfcCodeTouch as a momentary trigger. It has no on/off state; its
 * `historyDate` (a ms timestamp) advances on every access. A change fires the
 * mapped HomeKit service — a doorbell press, or a motion detection that clears
 * itself after {@link MOTION_RESET_MS}. The first (replayed) historyDate is an
 * existing entry, not a new event, so it is recorded without firing.
 *
 * Returns a disposer that clears any pending motion reset and the subscription.
 */
export function bindNfcCodeTouch(
  platform: LoxonePlatform,
  service: Service,
  control: NfcCodeTouchControl,
  mapping: NfcMapping,
): () => void {
  const C = platform.Characteristic;
  let initialized = false;
  let lastHistoryDate = 0;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  if (mapping === 'DoorBell') {
    service.getCharacteristic(C.ProgrammableSwitchEvent).onGet(() => C.ProgrammableSwitchEvent.SINGLE_PRESS);
  } else {
    service.getCharacteristic(C.MotionDetected).onGet(() => false);
  }

  const trigger = (): void => {
    if (mapping === 'DoorBell') {
      service.updateCharacteristic(C.ProgrammableSwitchEvent, C.ProgrammableSwitchEvent.SINGLE_PRESS);
      return;
    }
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
    platform.log.debug(`[${control.name}] NFC access event → ${mapping} trigger`);
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
