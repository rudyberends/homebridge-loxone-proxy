import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Thermostat } from '../../homekit/services/Thermostat';

/**
 * Loxone IRoomControllerV2 Item
*/
export class IRoomControllerV2 extends LoxoneAccessory {

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.tempActual]: {'service': 'PrimaryService', 'state': 'tempActual'},
      [this.device.states.tempTarget]: {'service': 'PrimaryService', 'state': 'tempTarget'},
    };

    this.Service.PrimaryService = new Thermostat(this.platform, this.Accessory!);
  }
}