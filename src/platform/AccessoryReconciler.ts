import type { PlatformAccessory } from 'homebridge';
import type { LoxonePlatform } from '../LoxonePlatform';
import type { AccessoryPlan } from './AccessoryPlan';

const PLUGIN_NAME = 'homebridge-loxone-proxy';
const PLATFORM_NAME = 'LoxonePlatform';

export class AccessoryReconciler {
  private readonly mappedAccessories = new Set<string>();

  constructor(private readonly platform: LoxonePlatform) {}

  beginRun(): void {
    this.mappedAccessories.clear();
  }

  reconcile(plan: AccessoryPlan): PlatformAccessory {
    let accessory = this.platform.accessories.find((acc) => acc.UUID === plan.id);

    if (!accessory) {
      accessory = new this.platform.api.platformAccessory(plan.displayName, plan.id);
      this.platform.api.registerPlatformAccessories(
        PLUGIN_NAME,
        PLATFORM_NAME,
        [accessory],
      );

      this.platform.log.debug(
        `[${plan.source.type}Item] Adding new accessory: ${plan.displayName} (original: ${plan.source.originalName})`,
      );
    } else {
      this.platform.log.debug(
        `[${plan.source.type}Item] Restoring accessory from cache: ${accessory.displayName} (original: ${plan.source.originalName})`,
      );
    }

    // Converge cached accessories on the freshly sanitized name. Older cache
    // entries may hold names with characters HAP rejects (parentheses, %, …).
    accessory.displayName = plan.displayName;

    accessory.context.device = plan.context.device;
    accessory.context.mapped = true;
    accessory.context.planId = plan.id;

    this.updateAccessoryInformation(accessory, plan);
    this.mappedAccessories.add(accessory.UUID);

    return accessory;
  }

  removeUnmapped(): void {
    this.platform.accessories.forEach((accessory) => {
      if (!this.mappedAccessories.has(accessory.UUID)) {
        this.platform.log.info('[RemoveAccessory] Removing unused accessory:', accessory.displayName);
        this.platform.api.unregisterPlatformAccessories(
          PLUGIN_NAME,
          PLATFORM_NAME,
          [accessory],
        );
      }
    });

    this.mappedAccessories.clear();
  }

  private updateAccessoryInformation(
    accessory: PlatformAccessory,
    plan: AccessoryPlan,
  ): void {
    const accessoryInfoService = accessory.getService(this.platform.Service.AccessoryInformation);
    if (!accessoryInfoService) {
      return;
    }

    accessoryInfoService
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Loxone')
      .setCharacteristic(this.platform.Characteristic.Model, plan.room)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, plan.source.uuidAction)
      .setCharacteristic(this.platform.Characteristic.Name, plan.displayName);
  }
}

