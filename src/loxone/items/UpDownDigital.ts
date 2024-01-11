import { LoxoneAccessory } from '../../LoxoneAccessory';
import { WindowCovering } from '../../homekit/services/WindowCovering';

/**
 * Loxone UpDownDigital Item
*/
export class UpDownDigital extends LoxoneAccessory {

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.up]: {'service': 'PrimaryService', 'state': 'up'},
      [this.device.states.down]: {'service': 'PrimaryService', 'state': 'down'}
    };

    this.Service.PrimaryService = new WindowCovering(this.platform, this.Accessory!);
  }
}
