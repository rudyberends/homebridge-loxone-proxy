import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Thermostat } from '../../homekit/services/Thermostat';

/**
 * Loxone IRoomControllerV2 Item
*/
export class IRoomControllerV2 extends LoxoneAccessory {

  isSupported(): boolean {
    // Ensure the accessory does NOT reuse the room name as base
    this.device.name = 'Thermostat';
    return true;
  }

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.tempActual]: {'service': 'PrimaryService', 'state': 'tempActual'},
      [this.device.states.tempTarget]: {'service': 'PrimaryService', 'state': 'tempTarget'},
      [this.device.states.operatingMode]: {'service': 'PrimaryService', 'state': 'operatingMode'},
    };

    this.Service.PrimaryService = new Thermostat(this.platform, this.Accessory!);
  }
}