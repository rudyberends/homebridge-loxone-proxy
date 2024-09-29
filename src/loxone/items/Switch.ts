import { LoxoneAccessory } from '../../LoxoneAccessory';
import { LockMechanism } from '../../homekit/services/LockMechanism';
import { Outlet } from '../../homekit/services/Outlet';
import { Switch as SwitchService } from '../../homekit/services/Switch'; // prevents conflict with local class

/**
 * Loxone Switch Item
*/
export class Switch extends LoxoneAccessory {

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.active]: {'service': 'PrimaryService', 'state': 'active'},
    };

    // Determine the appropriate HomeKit service based on the device characteristics
    const isLock = this.device.name.includes(this.platform.config.switchAlias?.Lock);
    const isOutlet = this.device.catIcon.includes('outlet') || this.device.defaultIcon.includes('outlet');

    this.Service.PrimaryService = isOutlet
      ? new Outlet(this.platform, this.Accessory!)
      : isLock
        ? new LockMechanism(this.platform, this.Accessory!)
        : new SwitchService(this.platform, this.Accessory!);
  }
}