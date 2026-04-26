import { LoxoneAccessory } from '../../LoxoneAccessory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';

/**
 * Loxone Window/Door Item
*/
export class Contact extends LoxoneAccessory {

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    return this.createSingleServicePlan(uuid, { id: 'PrimaryService', kind: 'contact-sensor' }, {
      [this.device.states.windowStates]: {'service': 'PrimaryService', 'state': 'windowStates'},
    });
  }
}
