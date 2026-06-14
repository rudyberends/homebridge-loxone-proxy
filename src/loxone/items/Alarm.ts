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
            // HAP SecuritySystemTargetState: 0=STAY_ARM(home), 1=AWAY_ARM,
            // 2=NIGHT_ARM, 3=DISARM. Only DISARM may map to 'off' -- the previous
            // code disarmed the alarm when the user picked 'Home'. Loxone arms via
            // delayedon/{1 with movement, 0 without}.
            const target = Number(value);
            if (target === 3) {
              return 'off';
            }
            if (target === 0 || target === 1) {
              return 'delayedon/1'; // home / away -> arm with movement
            }
            if (target === 2) {
              return 'delayedon/0'; // night -> arm without movement
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
