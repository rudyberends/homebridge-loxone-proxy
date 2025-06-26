import { LoxoneAccessory } from '../../LoxoneAccessory';
import { LockMechanism } from '../../homekit/services/LockMechanism';
import { Outlet } from '../../homekit/services/Outlet';
import { Switch as SwitchService } from '../../homekit/services/Switch';

/**
 * Loxone Switch Item
 */
export class Switch extends LoxoneAccessory {

  configureServices(): void {
    this.ItemStates = {
      [this.device.states.active]: { service: 'PrimaryService', state: 'active' },
    };

    const serviceType =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.device.details as any)?.serviceType ||
      Switch.determineSwitchType(this.device, this.platform.config);

    switch (serviceType) {
      case 'lock':
        this.Service.PrimaryService = new LockMechanism(this.platform, this.Accessory!);
        break;
      case 'outlet':
        this.Service.PrimaryService = new Outlet(this.platform, this.Accessory!);
        break;
      default:
        this.Service.PrimaryService = new SwitchService(this.platform, this.Accessory!);
    }
  }

  /**
   * Determine the HomeKit service type ('lock', 'outlet', or 'switch')
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static determineSwitchType(device: any, config: Record<string, any>): 'lock' | 'outlet' | 'switch' {
    const name = device.name?.toLowerCase() || '';
    const catIcon = device.catIcon?.toLowerCase() || '';
    const defaultIcon = device.defaultIcon?.toLowerCase() || '';

    const matchesIcon = (icon: string): boolean =>
      catIcon.includes(icon) || defaultIcon.includes(icon);

    const matchesAlias = (alias?: string): boolean =>
      !!alias && new RegExp(`\\b${alias.toLowerCase()}\\b`).test(name);

    const isLock =
    matchesIcon('lock') ||
    matchesAlias(config.switchAlias?.Lock);

    if (isLock) {
      return 'lock';
    }

    const isOutlet =
    matchesIcon('outlet') ||
    matchesAlias(config.switchAlias?.Outlet);

    if (isOutlet) {
      return 'outlet';
    }

    // 🔁 Fallback
    return 'switch';
  }

}
