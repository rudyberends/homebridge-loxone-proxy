import { LoxoneAccessory } from '../../LoxoneAccessory';
import { SecuritySystem } from '../../homekit/services/SecuritySystem';

/**
 * Loxone Alarm Item
 */
export class Alarm extends LoxoneAccessory {

  configureServices(): void {
    // Define the item states and their corresponding services
    this.ItemStates = {
      [this.device.states.armed]: {'service': 'PrimaryService', 'state': 'armed'},
      [this.device.states.level]: {'service': 'PrimaryService', 'state': 'level'},
      [this.device.states.disabledMove]: {'service': 'PrimaryService', 'state': 'disabledMove'},
    };

    // Create the SecuritySystem service and assign it to the PrimaryService
    this.Service.PrimaryService = new SecuritySystem(this.platform, this.Accessory!);
  }
}
