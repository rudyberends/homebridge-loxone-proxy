import { LoxoneAccessory } from '../../LoxoneAccessory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';

/**
 * Loxone PresenceDetector Item
*/
export class PresenceDetector extends LoxoneAccessory {

  protected isSupported(): boolean {
    this.device.name = `${this.device.room} ${this.device.name}`;
    return true;
  }

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    return this.createSingleServicePlan(uuid, { id: 'PrimaryService', kind: 'occupancy-sensor' }, {
      [this.device.states.active]: {'service': 'PrimaryService', 'state': 'active'},
    });
  }
}
