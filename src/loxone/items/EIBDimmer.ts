import { LoxoneAccessory } from '../../LoxoneAccessory';
import { LightBulb } from '../../homekit/services/LightBulb';

/**
 * Loxone Dimmer Item
*/
export class EIBDimmer extends LoxoneAccessory {

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.position]: {'service': 'PrimaryService', 'state': 'position'},
    };

    this.Service.PrimaryService = new LightBulb(this.platform, this.Accessory!);
  }
}