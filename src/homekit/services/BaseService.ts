import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { LoxonePlatform } from '../../LoxonePlatform';
import { Control } from '../../loxone/StructureFile';

export class BaseService {
  service: Service | undefined;
  device: Control;
  State = {};

  constructor(
    readonly platform: LoxonePlatform,
    readonly accessory: PlatformAccessory,
  ) {
    this.device = this.accessory.context.device;
    this.setupService();
  }

  setupService() {
    return;
  }

  protected updateCharacteristicValue(characteristic: string, value: CharacteristicValue) {
    if (this.service) {
      const characteristicInstance = this.service.getCharacteristic(characteristic);
      if (characteristicInstance) {
        characteristicInstance.updateValue(value);
      }
    }
  }
}