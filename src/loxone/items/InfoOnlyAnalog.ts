import { LoxoneAccessory } from '../../LoxoneAccessory';
import { HumiditySensor } from '../../homekit/services/HumiditySensor';
import { LightSensor } from '../../homekit/services/LightSensor';
import { TemperatureSensor } from '../../homekit/services/TemperatureSensor';

/**
 * Loxone InfoOnlyAnalog Item
 */
export class InfoOnlyAnalog extends LoxoneAccessory {
  private ServiceType?: new (platform: any, accessory: any) => any;

  // Check if the device is supported
  isSupported(): boolean {
    const { config } = this.platform;
    const aliases: Record<string, string> = config.InfoOnlyAnalogAlias;

    const serviceTypeMap = new Map<string, new (platform: any, accessory: any) => any>([
      ['Temperature', TemperatureSensor],
      ['Brightness', LightSensor],
      ['Humidity', HumiditySensor],
    ]);

    const formatTypeMap = new Map<string, new (platform: any, accessory: any) => any>([
      ['%.1f°', TemperatureSensor],
    ]);

    // Check for service type based on format first
    const format = this.device.details?.format;
    if (format && formatTypeMap.has(format)) {
      const detectedService = formatTypeMap.get(format)!; // Using non-null assertion because we know it's defined
      const serviceName = detectedService.name;
      this.platform.log.info(`[InfoOnlyAnalogItem] Format for ${serviceName} detected for device: ${this.device.name}`);
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
  private assignServiceType(serviceType: new (platform: any, accessory: any) => any): void {
    this.ServiceType = serviceType;
    this.device.name = `${this.device.room} (${this.device.name})`;
  }

  configureServices(): void {
    this.ItemStates = {
      [this.device.states.value]: { service: 'PrimaryService', state: 'value' },
    };

    if (this.ServiceType) {
      this.Service.PrimaryService = new this.ServiceType(this.platform, this.Accessory);
    }
  }
}
