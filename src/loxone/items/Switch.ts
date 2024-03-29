import { LoxoneAccessory } from '../../LoxoneAccessory';
import { LockMechanism } from '../../homekit/services/LockMechanism';
import { Switch as SwitchService } from '../../homekit/services/Switch'; // prevents conflict with local class

/**
 * Loxone Switch Item
*/
export class Switch extends LoxoneAccessory {

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.active]: {'service': 'PrimaryService', 'state': 'active'},
    };

    this.Service.PrimaryService = (this.device.name.includes(this.platform.config.switchAlias?.Lock))
      ? new LockMechanism(this.platform, this.Accessory!)
      : new SwitchService(this.platform, this.Accessory!);
  }
}