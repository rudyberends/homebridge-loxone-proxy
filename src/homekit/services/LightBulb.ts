import { CharacteristicValue } from 'homebridge';
import { SwitchService } from './Switch';

/**
 * Switch
 * Represents a Switch service for Homebridge.
 */
export class LightBulb extends SwitchService {
  State = {
    On: false,
    Brightness: 0,
  };

  /**
   * Sets up the light bulb service.
   */
  setupService(): void {
    super.setupService();

    this.service!.getCharacteristic(this.platform.Characteristic.Brightness)
      .onSet(this.setBrightness.bind(this));
  }

  /**
   * Updates the service with the new brightness value.
   * @param message - The message containing the new brightness value.
   */
  updateService(message: { value: number }): void {
    super.updateService(message);
    this.State.Brightness = message.value as number;

    // Also make sure this change is directly communicated to HomeKit
    this.service!.getCharacteristic(this.platform.Characteristic.Brightness).updateValue(this.State.Brightness);
  }

  /**
   * Sets the brightness value.
   * @param value - The brightness value to set.
   */
  async setBrightness(value: CharacteristicValue): Promise<void> {
    this.State.Brightness = value as number;
    this.platform.log.debug(`[${this.device.name}] - send message: ${this.State.Brightness}`);
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, this.State.Brightness.toString());
  }
}
