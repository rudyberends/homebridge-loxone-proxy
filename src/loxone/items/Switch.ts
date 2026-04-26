import { LoxoneAccessory } from '../../LoxoneAccessory';
import { HomeKitServiceKind } from '../../homekit/HomeKitServiceFactory';
import { AccessoryPlan, CommandBinding } from '../../platform/AccessoryPlan';

/**
 * Loxone Switch Item
 */
export class Switch extends LoxoneAccessory {

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    const serviceType =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.device.details as any)?.serviceType ||
      Switch.determineSwitchType(this.device, this.platform.config);

    const kind: HomeKitServiceKind =
      serviceType === 'lock'
        ? 'lock-mechanism'
        : serviceType === 'outlet'
          ? 'outlet'
          : 'switch';

    const commands: Record<string, CommandBinding> = serviceType === 'lock'
      ? {
        setTargetState: {
          action: (value: unknown) => {
            const reverse = this.platform.config.switchAlias?.ReverseLockSwitch;
            const target = Number(value);
            return reverse
              ? (target === 0 ? 'Off' : 'On')
              : (target === 0 ? 'On' : 'Off');
          },
        },
      }
      : {
        setOn: {
          action: (value: unknown) => value ? 'On' : 'Off',
        },
      };

    return this.createSingleServicePlan(uuid, { id: 'PrimaryService', kind, commands }, {
      [this.device.states.active]: {
        service: 'PrimaryService',
        state: 'active',
      },
    });
  }

  /**
   * Determine service type ('lock', 'outlet', or 'switch')
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static determineSwitchType(device: any, config: Record<string, any>): 'lock' | 'outlet' | 'switch' {
    const name = (device.name || '').toLowerCase();
    const icon1 = (device.catIcon || '').toLowerCase();
    const icon2 = (device.defaultIcon || '').toLowerCase();

    const matchesIcon = (icon: string): boolean =>
      icon1.includes(icon) || icon2.includes(icon);

    const matchesAlias = (alias?: string): boolean =>
      !!alias && new RegExp(`\\b${alias.toLowerCase()}\\b`, 'i').test(name);

    // lock?
    if (matchesIcon('lock') || matchesAlias(config.switchAlias?.Lock)) {
      return 'lock';
    }

    // outlet?
    if (matchesIcon('outlet') || matchesAlias(config.switchAlias?.Outlet)) {
      return 'outlet';
    }

    // default
    return 'switch';
  }
}
