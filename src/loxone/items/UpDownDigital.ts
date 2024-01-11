import { LoxoneAccessory } from '../../LoxoneAccessory';
import { WindowCovering } from '../../homekit/services/WindowCovering';

/**
 * Loxone UpDownDigital Item
 */
export class UpDownDigital extends LoxoneAccessory {

  configureServices(): void {
    this.ItemStates = {
      [this.device.states.position]: { 'service': 'PrimaryService', 'state': 'position' },
    };

    this.Service.PrimaryService = new WindowCovering(this.platform, this.Accessory!);
  }
}
