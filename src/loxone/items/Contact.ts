import { LoxoneAccessory } from '../../LoxoneAccessory';
import { ContactSensor } from '../../homekit/services/ContactSensor';

/**
 * Loxone Window/Door Item
*/
export class Contact extends LoxoneAccessory {

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.windowStates]: {'service': 'PrimaryService', 'state': 'windowStates'},
    };

    this.Service.PrimaryService = new ContactSensor(this.platform, this.Accessory!);
  }
}