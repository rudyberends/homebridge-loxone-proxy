import { LoxoneAccessory } from '../../LoxoneAccessory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';

/**
 * Loxone IRoomControllerV2 Item
*/
export class IRoomControllerV2 extends LoxoneAccessory {

  isSupported(): boolean {
    // Ensure the accessory does NOT reuse the room name as base
    this.device.name = 'Thermostat';
    return true;
  }

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    return this.createSingleServicePlan(uuid, {
      id: 'PrimaryService',
      kind: 'thermostat',
      commands: {
        setTargetTemperature: {
          action: (value: unknown) => {
            const currentDate = new Date();
            const nextDayAtMidnight = new Date(
              currentDate.getFullYear(),
              currentDate.getMonth(),
              currentDate.getDate() + 1,
              0,
              0,
              0,
            );
            const secondsDifference = (nextDayAtMidnight.getTime() / 1000) - (new Date('2009-01-01T00:00:00Z').getTime() / 1000);
            return `override/3/[${secondsDifference}]/${value}`;
          },
        },
      },
    }, {
      [this.device.states.tempActual]: {'service': 'PrimaryService', 'state': 'tempActual'},
      [this.device.states.tempTarget]: {'service': 'PrimaryService', 'state': 'tempTarget'},
      [this.device.states.operatingMode]: {'service': 'PrimaryService', 'state': 'operatingMode'},
    });
  }
}
