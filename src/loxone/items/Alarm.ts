import { LoxoneAccessory } from '../../LoxoneAccessory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';

/**
 * Loxone Alarm Item
 */
export class Alarm extends LoxoneAccessory {

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    return this.createSingleServicePlan(uuid, {
      id: 'PrimaryService',
      kind: 'security-system',
      commands: {
        setTargetState: {
          action: (value: unknown) => {
            const target = Number(value);
            if (target === 0 || target === 3) {
              return 'off';
            }
            if (target === 1) {
              return 'delayedon/1';
            }
            if (target === 2) {
              return 'delayedon/0';
            }
            return undefined;
          },
        },
      },
    }, {
      [this.device.states.armed]: {'service': 'PrimaryService', 'state': 'armed'},
      [this.device.states.level]: {'service': 'PrimaryService', 'state': 'level'},
      [this.device.states.disabledMove]: {'service': 'PrimaryService', 'state': 'disabledMove'},
    });
  }
}
