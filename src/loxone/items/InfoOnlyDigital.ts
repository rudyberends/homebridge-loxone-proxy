import { LoxoneAccessory } from '../../LoxoneAccessory';
import { LeakSensor } from '../../homekit/services/LeakSensor';
import { MotionSensor } from '../../homekit/services/MotionSensor';
import { SmokeSensor } from '../../homekit/services/SmokeSensor';
import { LoxonePlatform } from '../../LoxonePlatform';  // Adjust as necessary for actual import
import { Control } from '../StructureFile';

/**
 * Loxone InfoOnlyDigital Item
 */
export class InfoOnlyDigital extends LoxoneAccessory {
  private ServiceType?: new (platform: LoxonePlatform, accessory: any, device: any, camera?: any) => any; // Optional ServiceType

  constructor(platform: LoxonePlatform, device: Control) {
    super(platform, device);
  }

  isSupported(): boolean {
    const { config } = this.platform;
    const aliases: Record<string, string> = config.InfoOnlyDigitalAlias;

    const serviceTypeMap = new Map<string, new (platform: LoxonePlatform, accessory: any, device: any, camera?: any) => any>([
      ['Motion', MotionSensor],
      ['Smoke', SmokeSensor],
      ['Leak', LeakSensor],
    ]);

    for (const [key, alias] of Object.entries(aliases)) {
      if (this.matchAlias(this.device.name, alias)) {
        this.ServiceType = serviceTypeMap.get(key) || this.ServiceType; // Get service type from the map or retain default

        if (this.ServiceType) {
          this.device.name = `${this.device.room} (${this.device.name})`;
          return true;
        }
      }
    }
    return false;
  }

  configureServices(): void {
    this.ItemStates = {
      [this.device.states.active]: { service: 'PrimaryService', state: 'active' },
    };

    if (this.ServiceType) {
      this.Service.PrimaryService = new this.ServiceType(this.platform, this.Accessory, this.device);
    }
  }
}
