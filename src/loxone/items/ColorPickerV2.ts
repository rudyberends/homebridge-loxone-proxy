import { LoxoneAccessory } from '../../LoxoneAccessory';
import { ColorLightBulb } from '../../homekit/services/ColorLightBulb';

/**
 * Loxone Dimmer Item
*/
export class ColorPickerV2 extends LoxoneAccessory {

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.color]: {'service': 'PrimaryService', 'state': 'color'},
    };

    this.Service.PrimaryService = new ColorLightBulb(this.platform, this.Accessory!);
  }
}