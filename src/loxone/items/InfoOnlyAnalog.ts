import { LoxoneAccessory } from '../../LoxoneAccessory';
import { HumiditySensor } from '../../homekit/services/HumiditySensor';
import { LightSensor } from '../../homekit/services/LightSensor';

/**
 * Loxone InfoOnlyAnalog Item
 */
export class InfoOnlyAnalog extends LoxoneAccessory {
  private ServiceType: (new (platform: any, accessory: any) => any) = HumiditySensor;

  isSupported(): boolean {

    if (this.device.name.includes(this.platform.config.InfoOnlyAnalogAlias?.Humidity)) {
      this.ServiceType = HumiditySensor; // Map InfoOnlyAnalog with Humidity Alias to HumiditySensor
      return true;
    }

    if (this.device.name.includes(this.platform.config.InfoOnlyAnalogAlias?.Brightness)) {
      this.ServiceType = LightSensor; // Map InfoOnlyAnalog with Brightness Alias to LightSensor Service
      return true;
    }
    return false;
  }

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.value]: {'service': 'PrimaryService', 'state': 'value'},
    };

    const serviceConstructor: new (platform: any, accessory: any) => any = this.ServiceType;
    this.Service.PrimaryService = new serviceConstructor(this.platform, this.Accessory);
  }
}