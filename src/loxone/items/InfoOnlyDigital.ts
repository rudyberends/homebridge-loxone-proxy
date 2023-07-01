import { LoxoneAccessory } from '../../LoxoneAccessory';
import { MotionSensor } from '../../homekit/services/MotionSensor';

/**
 * Loxone InfoOnlyDigital Item
 */
export class InfoOnlyDigital extends LoxoneAccessory {
  private ServiceType: (new (platform: any, accessory: any) => any) = MotionSensor;


  isSupported(): boolean {
    if (this.device.name.includes(this.platform.config.InfoOnlyDigitalAlias?.Motion)) {
      this.ServiceType = MotionSensor;
      return true;
    }
    return false;
  }

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.active]: {'service': 'PrimaryService', 'state': 'active'},
    };

    const serviceConstructor: new (platform: any, accessory: any) => any = this.ServiceType;
    this.Service.PrimaryService = new serviceConstructor(this.platform, this.Accessory);
  }
}