import { LoxoneAccessory } from '../../LoxoneAccessory';
import { LeakSensor } from '../../homekit/services/LeakSensor';
import { MotionSensor } from '../../homekit/services/MotionSensor';
import { SmokeSensor } from '../../homekit/services/SmokeSensor';

/**
 * Loxone InfoOnlyDigital Item
 */
export class InfoOnlyDigital extends LoxoneAccessory {
  private ServiceType: (new (platform: any, accessory: any) => any) = MotionSensor;


  isSupported(): boolean {
    const { config } = this.platform;
    const aliases = config.InfoOnlyDigitalAlias;

    if (this.device.name.includes(aliases?.Motion)) {
      this.ServiceType = MotionSensor;
    } else if (this.device.name.includes(aliases?.Smoke)) {
      this.ServiceType = SmokeSensor;
    } else if (this.device.name.includes(aliases?.Leak)) {
      this.ServiceType = LeakSensor;
    } else {
      return false;
    }
    this.device.name = `${this.device.room} (${this.device.name})`;
    return true;
  }

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.active]: {'service': 'PrimaryService', 'state': 'active'},
    };

    const serviceConstructor: new (platform: any, accessory: any) => any = this.ServiceType;
    this.Service.PrimaryService = new serviceConstructor(this.platform, this.Accessory);
  }
}