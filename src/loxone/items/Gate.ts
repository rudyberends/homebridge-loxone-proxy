import { LoxoneAccessory } from '../../LoxoneAccessory';
import { GarageDoorOpener } from '../../homekit/services/GarageDoorOpener';

/**
 * Loxone Gate Item
*/
export class Gate extends LoxoneAccessory {

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.active]: {'service': 'PrimaryService', 'state': 'active'},
      [this.device.states.position]: {'service': 'PrimaryService', 'state': 'position'},
    };

    this.Service.PrimaryService = new GarageDoorOpener(this.platform, this.Accessory!);
  }
}