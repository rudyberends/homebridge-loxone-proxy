import { LoxoneAccessory } from '../../LoxoneAccessory';
import { WindowCovering } from '../../homekit/services/WindowCovering';

/**
 * Loxone Jaloesie Item
*/
export class Jalousie extends LoxoneAccessory {

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.up]: {'service': 'PrimaryService', 'state': 'up'},
      [this.device.states.down]: {'service': 'PrimaryService', 'state': 'down'},
      [this.device.states.position]: {'service': 'PrimaryService', 'state': 'position'},
      [this.device.states.shadePosition]: {'service': 'PrimaryService', 'state': 'shadePosition'},
    };

    this.Service.PrimaryService = new WindowCovering(this.platform, this.Accessory!);
  }
}