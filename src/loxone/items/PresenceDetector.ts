import { LoxoneAccessory } from '../../LoxoneAccessory';
import { OccupancySensor } from '../../homekit/services/OccupancySensor';

/**
 * Loxone PresenceDetector Item
*/
export class PresenceDetector extends LoxoneAccessory {

  protected isSupported(): boolean {
    this.device.name = `${this.device.room} ${this.device.name}`;
    return true;
  }

  configureServices(): void {
    this.ItemStates = {
      [this.device.states.active]: {'service': 'PrimaryService', 'state': 'active'},
    };

    this.Service.PrimaryService = new OccupancySensor(this.platform, this.Accessory!);
  }
}