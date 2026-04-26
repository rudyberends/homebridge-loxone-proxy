import { LoxoneAccessory } from '../../LoxoneAccessory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';

/**
 * Loxone Dimmer Item
*/
export class Dimmer extends LoxoneAccessory {

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    return this.createSingleServicePlan(uuid, {
      id: 'PrimaryService',
      kind: 'lightbulb',
      commands: {
        setOn: { action: (value: unknown) => value ? 'On' : 'Off' },
        setBrightness: { action: (value: unknown) => String(value) },
      },
    }, {
      [this.device.states.position]: {'service': 'PrimaryService', 'state': 'position'},
    });
  }
}
