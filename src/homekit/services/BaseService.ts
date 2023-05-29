import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { LoxonePlatform } from '../../LoxonePlatform';
import { Control } from '../../loxone/StructureFile';

/**
 * BaseService
 * Represents a base service for other service classes in Homebridge.
 */
export class BaseService {
  service: Service | undefined;
  device: Control;
  State: { [key: string]: any } = {};

  /**
   * Constructs the BaseService.
   * @param platform - The LoxonePlatform instance.
   * @param accessory - The PlatformAccessory instance.
   */
  constructor(
    readonly platform: LoxonePlatform,
    readonly accessory: PlatformAccessory,
    readonly secondaryService?: Control, // for aditional services on same Accesory
  ) {

    this.device = (this.secondaryService)
      ? this.secondaryService
      : this.accessory.context.device;

    this.setupService();
  }

  /**
   * Sets up the service.
   * This method should be overridden by the derived classes to create the required characteristics and their event handlers.
   */
  setupService(): void {
    // This is a placeholder method that can be overridden by the derived classes.
  }

  /**
   * Updates the value of a characteristic for the service.
   * @param characteristic - The characteristic to update.
   * @param value - The new value for the characteristic.
   */
  protected updateCharacteristicValue(characteristic: string, value: CharacteristicValue): void {
    if (this.service) {
      const characteristicInstance = this.service.getCharacteristic(characteristic);
      if (characteristicInstance) {
        characteristicInstance.updateValue(value);
      }
    }
  }
}