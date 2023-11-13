import { LoxoneAccessory } from '../../LoxoneAccessory';
import { HumiditySensor } from '../../homekit/services/HumiditySensor';
import { LightSensor } from '../../homekit/services/LightSensor';
import { TemperatureSensor } from '../../homekit/services/TemperatureSensor';

/**
 * Loxone InfoOnlyAnalog Item
 */
export class InfoOnlyAnalog extends LoxoneAccessory {
  private ServiceType: (new (platform: any, accessory: any) => any) = HumiditySensor;

  // Map InfoOnlyAnalog Items with Alias
  isSupported(): boolean {
    if (this.device.name.includes(this.platform.config.InfoOnlyAnalogAlias?.Brightness)) {
      this.ServiceType = LightSensor;
    } else if (this.device.name.includes(this.platform.config.InfoOnlyAnalogAlias?.Humidity)) {
      this.ServiceType = HumiditySensor;
    } else if (this.device.name.includes(this.platform.config.InfoOnlyAnalogAlias?.Temperature)) {
      this.ServiceType = TemperatureSensor;
    } else {
      return false;
    }
    return true;
  }

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.value]: {'service': 'PrimaryService', 'state': 'value'},
    };

    const serviceConstructor: new (platform: any, accessory: any) => any = this.ServiceType;
    this.Service.PrimaryService = new serviceConstructor(this.platform, this.Accessory);
  }
}