import { LoxoneAccessory } from '../../LoxoneAccessory';
import { HomeKitServiceKind } from '../../homekit/HomeKitServiceFactory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';

/**
 * Loxone InfoOnlyDigital Item
 */
export class InfoOnlyDigital extends LoxoneAccessory {
  private serviceKind?: HomeKitServiceKind;

  isSupported(): boolean {
    const { config } = this.platform;
    const aliases: Record<string, string> = config.InfoOnlyDigitalAlias;

    const serviceTypeMap = new Map<string, HomeKitServiceKind>([
      ['Motion', 'motion-sensor'],
      ['Smoke', 'smoke-sensor'],
      ['Leak', 'leak-sensor'],
    ]);

    for (const [key, alias] of Object.entries(aliases)) {
      if (this.matchAlias(this.device.name, alias)) {
        this.serviceKind = serviceTypeMap.get(key) || this.serviceKind;

        if (this.serviceKind) {
          this.device.name = `${this.device.room} (${this.device.name})`;
          return true;
        }
      }
    }
    return false;
  }

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    return this.createSingleServicePlan(uuid, { id: 'PrimaryService', kind: this.serviceKind! }, {
      [this.device.states.active]: { service: 'PrimaryService', state: 'active' },
    });
  }
}
