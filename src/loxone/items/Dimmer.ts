import { LoxoneAccessory } from '../../LoxoneAccessory';
import { LightBulb } from '../../homekit/services/LightBulb';

/**
 * Loxone Dimmer Item
*/
export class Dimmer extends LoxoneAccessory {

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.position]: {'service': 'PrimaryService', 'state': 'position'},
    };

    this.device.cat = 'lights';  // force Lightbulb for Dimmer Items
    this.Service.PrimaryService = new LightBulb(this.platform, this.Accessory!);
  }
}