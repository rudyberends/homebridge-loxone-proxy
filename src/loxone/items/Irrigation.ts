import { LoxoneAccessory } from '../../LoxoneAccessory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';

/**
 * Represents a Loxone-controlled Irrigation accessory in HomeKit.
 * This class maps the irrigation controller and ensures that the
 * necessary states (rainActive, currentZone, zones) are tracked,
 * and the zones state is manually pushed from cache if Loxone does not emit it.
 */
export class Irrigation extends LoxoneAccessory {
  /**
   * Plans HomeKit services and relevant state listeners.
   */
  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    return this.createSingleServicePlan(uuid, {
      id: 'PrimaryService',
      kind: 'irrigation-system',
      commands: {
        selectZone: { action: (value: unknown) => `select/${value}` },
        setZoneDuration: {
          action: (value: unknown) => {
            const payload = value as { id?: number; duration?: number };
            return `setDuration/${payload.id ?? 0}=${payload.duration ?? 0}`;
          },
        },
      },
    }, {
      [this.device.states.zones]: { service: 'PrimaryService', state: 'zones' },
      [this.device.states.currentZone]: { service: 'PrimaryService', state: 'currentZone' },
    });
  }

  protected afterSetup(): void {
    this.platform.stateRouter.replayCachedState(this, this.device.states.zones);
  }
}
