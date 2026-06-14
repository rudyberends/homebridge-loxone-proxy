import { LoxoneAccessory } from '../../LoxoneAccessory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';

interface VentilationCommandValue {
  speed: number;
  modeId: number;
}

/**
 * Loxone Ventilation Item.
 *
 * The Loxone Ventilation block has no plain on/off or set-speed command. Manual
 * control goes through a timer (Structure File, "Ventilation"):
 *   setTimer/{interval}/{speed}/{modeId}/{timerProfileIdx}  (profileIdx -1 = manual)
 *   setTimer/0                                              (return to automatic)
 * HomeKit has no notion of "for how long", so the manual-override duration is
 * configurable (Advanced.VentilationManualSeconds, default 1 hour).
 */
export class Ventilation extends LoxoneAccessory {

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    const manualSeconds = Number(this.platform.config.Advanced?.VentilationManualSeconds) || 3600;

    return this.createSingleServicePlan(uuid, {
      id: 'PrimaryService',
      kind: 'fanv2',
      commands: {
        setRotationSpeed: {
          action: (value: unknown) => {
            const { speed, modeId } = value as VentilationCommandValue;
            const clamped = Math.max(0, Math.min(100, Math.round(speed)));
            return `setTimer/${manualSeconds}/${clamped}/${modeId}/-1`;
          },
        },
        setVentilationAuto: {
          action: () => 'setTimer/0',
        },
      },
    }, {
      [this.device.states.mode]: { 'service': 'PrimaryService', 'state': 'mode' },
      [this.device.states.speed]: { 'service': 'PrimaryService', 'state': 'speed' },
    });
  }
}
