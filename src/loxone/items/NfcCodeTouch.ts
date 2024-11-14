import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Doorbell } from '../../homekit/services/Doorbell';

/**
 * NfcCodeTouch Item
*/
export class NfcCodeTouch extends LoxoneAccessory {

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.events]: { 'service': 'PrimaryService', 'state': 'bell' },
    };

    this.Service.PrimaryService = new Doorbell(this.platform, this.Accessory!);
  }
}