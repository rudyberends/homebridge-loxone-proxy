import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Fanv2 } from '../../homekit/services/Fanv2';

/**
 * Loxone Ventilation Item
*/
export class Ventiltion extends LoxoneAccessory {

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.mode]: {'service': 'PrimaryService', 'state': 'mode'},
      [this.device.states.speed]: {'service': 'PrimaryService', 'state': 'speed'},
    };

    this.Service.PrimaryService = new Fanv2(this.platform, this.Accessory!);
  }
}