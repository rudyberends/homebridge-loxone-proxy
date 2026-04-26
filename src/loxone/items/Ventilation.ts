import { LoxoneAccessory } from '../../LoxoneAccessory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';

/**
 * Loxone Ventilation Item
*/
export class Ventilation extends LoxoneAccessory {

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    return this.createSingleServicePlan(uuid, { id: 'PrimaryService', kind: 'fanv2' }, {
      [this.device.states.mode]: {'service': 'PrimaryService', 'state': 'mode'},
      [this.device.states.speed]: {'service': 'PrimaryService', 'state': 'speed'},
    });
  }
}
