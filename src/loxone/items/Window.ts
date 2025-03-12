import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Window as HomeKitWindow } from '../../homekit/services/Window';

/**
 * Loxone Window Item
*/
export class Window extends LoxoneAccessory {

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.position]: {'service': 'PrimaryService', 'state': 'position'},
      [this.device.states.shadePosition]: {'service': 'PrimaryService', 'state': 'targetPosition'},
      [this.device.states.direction]: {'service': 'PrimaryService', 'state': 'direction'},
      //[this.device.states.type]: {'service': 'PrimaryService', 'state': 'type'}, // Contains Window Type for Visualisation. No use for now
    };

    this.Service.PrimaryService = new HomeKitWindow(this.platform, this.Accessory!);
  }
}