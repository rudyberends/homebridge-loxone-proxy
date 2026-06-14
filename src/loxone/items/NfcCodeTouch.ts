import { LoxoneAccessory } from '../../LoxoneAccessory';
import { HomeKitServiceKind } from '../../homekit/HomeKitServiceFactory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';
import { dispatchHomeKitUpdate } from '../../homekit/HomeKitServiceAdapter';
import { LoxoneUpdateMessage } from '../LoxoneTypes';

/**
 * NfcCodeTouch Item.
 *
 * The NFC Code Touch has no on/off state; per the Structure File its `historyDate`
 * state (a ms unix timestamp) advances on every access event. We treat a change
 * in historyDate as a trigger and pulse the mapped HomeKit service (a doorbell
 * press, or a momentary motion detection).
 */
type NfcCodeTouchMapping = 'DoorBell' | 'MotionSensor';

const MOTION_RESET_MS = 5000;

export class NfcCodeTouch extends LoxoneAccessory {
  private mapping: NfcCodeTouchMapping = 'DoorBell';
  private historyInitialized = false;
  private lastHistoryDate = 0;

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    this.mapping = this.platform.config.Advanced?.NfcCodeTouchMapping === 'MotionSensor'
      ? 'MotionSensor'
      : 'DoorBell';
    this.platform.log.debug(`[${this.device.name}] Configuring NfcCodeTouch as ${this.mapping}`);

    const kind: HomeKitServiceKind = this.mapping === 'DoorBell' ? 'doorbell' : 'motion-sensor';

    return this.createSingleServicePlan(uuid, { id: 'PrimaryService', kind }, {
      [this.device.states.historyDate]: { 'service': 'PrimaryService', 'state': 'historyDate' },
    });
  }

  callBackHandler(message: LoxoneUpdateMessage): void {
    const ts = Number(message.value) || 0;

    // The first callback is the replayed current historyDate (an existing entry),
    // not a new event -- record it without firing.
    if (!this.historyInitialized) {
      this.historyInitialized = true;
      this.lastHistoryDate = ts;
      return;
    }

    if (ts === 0 || ts === this.lastHistoryDate) {
      return;
    }
    this.lastHistoryDate = ts;

    const service = this.Service[message.service];
    if (!service) {
      this.platform.log.warn(`[${this.device.name}] No HomeKit service registered for ${message.service}`);
      return;
    }

    this.platform.log.debug(`[${this.device.name}] NFC access event -> ${this.mapping} trigger`);
    dispatchHomeKitUpdate(service, { ...message, value: 1 });

    // A motion sensor must clear itself so the next access can re-trigger it;
    // the doorbell is momentary on its own.
    if (this.mapping === 'MotionSensor') {
      setTimeout(() => dispatchHomeKitUpdate(service, { ...message, value: 0 }), MOTION_RESET_MS);
    }
  }
}
