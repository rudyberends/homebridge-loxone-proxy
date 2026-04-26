import { LoxoneAccessory } from '../../LoxoneAccessory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';

/**
 * Loxone Gate Item
*/
export class Gate extends LoxoneAccessory {

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    return this.createSingleServicePlan(uuid, {
      id: 'PrimaryService',
      kind: 'garage-door-opener',
      commands: {
        setTargetDoorState: { action: (value: unknown) => Number(value) === 0 ? 'open' : 'close' },
      },
    }, {
      [this.device.states.active]: {'service': 'PrimaryService', 'state': 'active'},
      [this.device.states.position]: {'service': 'PrimaryService', 'state': 'position'},
    });
  }
}
