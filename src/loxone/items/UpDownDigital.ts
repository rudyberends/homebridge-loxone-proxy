import { LoxoneAccessory } from '../../LoxoneAccessory';
import { WindowCovering } from '../../homekit/services/WindowCovering';

/**
 * Loxone UpDownDigital Item
*/
export class UpDownDigital extends LoxoneAccessory {

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.active]: {'service': 'PrimaryService', 'state': 'active'},
    };

    this.Service.PrimaryService = new WindowCovering(this.platform, this.Accessory!);
  }

  callBackHandler(message: { uuid: string; state: string; service: string; value: string | number }): void {
    console.log('!!!!!!')
    console.log(message)    

    }
}