import { LoxoneAccessory } from '../../LoxoneAccessory';
import { SecuritySystem } from '../../homekit/services/SecuritySystem';

/**
 * Loxone Alarm Item
*/
export class Alarm extends LoxoneAccessory {

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.armed]: {'service': 'PrimaryService', 'state': 'armed'},
    };

    this.Service.PrimaryService = new SecuritySystem(this.platform, this.Accessory!);
  }
}