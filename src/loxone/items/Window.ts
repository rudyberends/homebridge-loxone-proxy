import { LoxoneAccessory } from '../../LoxoneAccessory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';

/**
 * Loxone Window Item
*/
export class Window extends LoxoneAccessory {

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    return this.createSingleServicePlan(uuid, {
      id: 'PrimaryService',
      kind: 'window',
      commands: {
        setTargetPosition: { action: (value: unknown) => `moveToPosition/${value}` },
      },
    }, {
      [this.device.states.position]: {'service': 'PrimaryService', 'state': 'position'},
      [this.device.states.targetPosition]: {'service': 'PrimaryService', 'state': 'targetPosition'},
      [this.device.states.direction]: {'service': 'PrimaryService', 'state': 'direction'},
    });
  }
}
