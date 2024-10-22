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

    for (const [key, alias] of Object.entries(aliases)) {
      if (this.matchAlias(this.device.name, alias)) {
        const trimmedKey = key.trim();
        this.platform.log.info(`[InfoOnlyAnalogItem] Match found for alias: ${alias} for device: ${this.device.name}`);

        if (serviceTypeMap.has(trimmedKey)) {
          this.ServiceType = serviceTypeMap.get(trimmedKey);

          if (this.ServiceType) {
            this.device.name = `${this.device.room} (${this.device.name})`;
            return true;
          }
        }
      }
    }
    return false;
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
