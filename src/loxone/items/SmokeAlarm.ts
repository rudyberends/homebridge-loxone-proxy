import { LoxoneAccessory } from '../../LoxoneAccessory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';
import { dispatchHomeKitUpdate } from '../../homekit/HomeKitServiceAdapter';
import { LoxoneUpdateMessage } from '../LoxoneTypes';

/**
 * Loxone SmokeAlarm ("Fire/water alarm") Item.
 *
 * Per the Structure File the control monitors a combination of causes
 * (details.availableAlarms bitmask) and reports `level` (>=1 = alarm) and
 * `alarmCause` (bitmask of what tripped). We split it across the matching HomeKit
 * sensors: smoke -> SmokeSensor, water -> LeakSensor. Temperature/arc-fault have
 * no native HomeKit sensor and are not exposed.
 */
const SMOKE = 0x01;
const WATER = 0x02;

export class SmokeAlarm extends LoxoneAccessory {
  private level = 0;
  private alarmCause = 0;
  private monitorsSmoke = true;
  private monitorsWater = false;

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    const available = Number(this.device.details.availableAlarms) || 0;
    this.monitorsWater = (available & WATER) !== 0;
    // Default to smoke when availableAlarms is missing or only carries
    // temperature/arc-fault bits (which HomeKit cannot represent).
    this.monitorsSmoke = (available & SMOKE) !== 0 || !this.monitorsWater;

    const primary = this.monitorsSmoke
      ? { id: 'Smoke', kind: 'smoke-sensor' as const }
      : { id: 'Water', kind: 'leak-sensor' as const };

    const plan = this.createSingleServicePlan(uuid, primary, {
      [this.device.states.level]: { service: primary.id, state: 'level' },
      [this.device.states.alarmCause]: { service: primary.id, state: 'alarmCause' },
    });

    if (this.monitorsSmoke && this.monitorsWater) {
      plan.services.push({ id: 'Water', kind: 'leak-sensor', device: this.device });
    }

    return plan;
  }

  callBackHandler(message: LoxoneUpdateMessage): void {
    if (message.state === 'level') {
      this.level = Number(message.value) || 0;
    } else if (message.state === 'alarmCause') {
      this.alarmCause = Number(message.value) || 0;
    }

    const active = this.level >= 1;

    const smokeService = this.Service['Smoke'];
    if (smokeService) {
      // When the device only monitors smoke, any active alarm is a smoke alarm;
      // otherwise require the smoke cause bit.
      const smoke = this.monitorsWater ? (active && (this.alarmCause & SMOKE) !== 0) : active;
      dispatchHomeKitUpdate(smokeService, { ...message, value: smoke ? 1 : 0 });
    }

    const waterService = this.Service['Water'];
    if (waterService) {
      const water = active && (this.alarmCause & WATER) !== 0;
      dispatchHomeKitUpdate(waterService, { ...message, value: water ? 1 : 0 });
    }
  }
}
