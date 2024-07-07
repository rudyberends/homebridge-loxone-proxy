/* eslint-disable @typescript-eslint/no-explicit-any */
import { LoxoneAccessory } from '../../LoxoneAccessory';
import { LeakSensor } from '../../homekit/services/LeakSensor';
import { MotionSensor } from '../../homekit/services/MotionSensor';
import { SmokeSensor } from '../../homekit/services/SmokeSensor';
import { LoxonePlatform } from '../../LoxonePlatform';  // Adjust as necessary for actual import

/**
 * Loxone InfoOnlyDigital Item
 */
export class InfoOnlyDigital extends LoxoneAccessory {
  private ServiceType: new (platform: LoxonePlatform, accessory: any, device: any, camera?: any) => any = MotionSensor;

  isSupported(): boolean {
    const { config } = this.platform;
    const aliases = config.InfoOnlyDigitalAlias;

    if (this.device.name.includes(aliases?.Motion)) {
      this.ServiceType = MotionSensor as new (platform: LoxonePlatform, accessory: any, device: any, camera?: any) => any;
    } else if (this.device.name.includes(aliases?.Smoke)) {
      this.ServiceType = SmokeSensor as new (platform: LoxonePlatform, accessory: any, device: any, camera?: any) => any;
    } else if (this.device.name.includes(aliases?.Leak)) {
      this.ServiceType = LeakSensor as new (platform: LoxonePlatform, accessory: any, device: any, camera?: any) => any;
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

    const serviceConstructor: new (platform: LoxonePlatform, accessory: any, device: any, camera?: any) => any = this.ServiceType;
    this.Service.PrimaryService = new serviceConstructor(this.platform, this.Accessory, this.device);
  }
}
