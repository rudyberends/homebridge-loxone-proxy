import { LoxoneAccessory } from '../../LoxoneAccessory';
import { HomeKitServiceKind } from '../../homekit/HomeKitServiceFactory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';

/**
 * Loxone InfoOnlyAnalog Item
 */
export class InfoOnlyAnalog extends LoxoneAccessory {
  private serviceKind?: HomeKitServiceKind;

  // Check if the device is supported
  isSupported(): boolean {
    const { config } = this.platform;
    const aliases: Record<string, string> = config.InfoOnlyAnalogAlias;

    const serviceTypeMap = new Map<string, HomeKitServiceKind>([
      ['Temperature', 'temperature-sensor'],
      ['Brightness', 'light-sensor'],
      ['Humidity', 'humidity-sensor'],
    ]);

    const formatTypeMap = new Map<string, HomeKitServiceKind>([
      ['%.1f°', 'temperature-sensor'],
      ['%.0fLx', 'light-sensor'],
      ['%.0f%%', 'humidity-sensor'],
    ]);

    // Check for service type based on format first
    const format = this.device.details?.format;
    if (format && formatTypeMap.has(format)) {
      const detectedService = formatTypeMap.get(format)!;
      this.platform.log.info(`[InfoOnlyAnalogItem] Format for ${detectedService} detected for device: ${this.device.name}`);
      this.assignServiceType(detectedService);
      return true;
    }

    // Check based on name alias mapping
    for (const [key, alias] of Object.entries(aliases)) {
      if (this.matchAlias(this.device.name, alias)) {
        const trimmedKey = key.trim();
        const serviceType = serviceTypeMap.get(trimmedKey);

        if (serviceType) {
          // eslint-disable-next-line max-len
          this.platform.log.info(`[InfoOnlyAnalogItem] Matched alias: '${alias}' to service: '${trimmedKey}' for device: ${this.device.name}`);
          this.assignServiceType(serviceType);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Helper method to assign service type and update device name.
   */
  private assignServiceType(serviceType: HomeKitServiceKind): void {
    this.serviceKind = serviceType;
    this.device.name = `${this.device.room} (${this.device.name})`;
  }

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    return this.createSingleServicePlan(uuid, { id: 'PrimaryService', kind: this.serviceKind! }, {
      [this.device.states.value]: { service: 'PrimaryService', state: 'value' },
    });
  }
}
