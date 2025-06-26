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

    const getIcon = (key: 'Lock' | 'Outlet') =>
      config.switchIcon?.[key]?.toLowerCase();

    const getAlias = (key: 'Lock' | 'Outlet') =>
      config.switchAlias?.[key]?.toLowerCase();

    const matchesIcon = (icon?: string): boolean =>
      !!icon && (catIcon.includes(icon) || defaultIcon.includes(icon));

    const matchesAlias = (alias?: string): boolean =>
      !!alias && new RegExp(`\\b${alias}\\b`).test(name);

    // Check for lock
    const lockIcon = getIcon('Lock');
    const lockAlias = getAlias('Lock');

    if (matchesIcon(lockIcon) || matchesAlias(lockAlias)) {
      return 'lock';
    }

    // Check for outlet
    const outletIcon = getIcon('Outlet');
    const outletAlias = getAlias('Outlet');

    if (matchesIcon(outletIcon) || matchesAlias(outletAlias)) {
      return 'outlet';
    }

    // Fallback
    return 'switch';
  }

}
