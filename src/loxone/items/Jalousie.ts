import { LoxoneAccessory } from '../../LoxoneAccessory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';

/**
 * Loxone Jaloesie Item
*/
export class Jalousie extends LoxoneAccessory {

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    return this.createSingleServicePlan(uuid, {
      id: 'PrimaryService',
      kind: 'window-covering',
      commands: {
        setTargetPosition: { action: (value: unknown) => `manualPosition/${value}` },
        setTargetHorizontalTiltAngle: { action: (value: unknown) => `manualLamelle/${value}` },
      },
    }, {
      [this.device.states.up]: {'service': 'PrimaryService', 'state': 'up'},
      [this.device.states.down]: {'service': 'PrimaryService', 'state': 'down'},
      [this.device.states.position]: {'service': 'PrimaryService', 'state': 'position'},
      [this.device.states.shadePosition]: {'service': 'PrimaryService', 'state': 'shadePosition'},
    });
  }
}
