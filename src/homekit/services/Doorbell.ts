import { BaseService } from './BaseService';
import { CameraService } from './Camera';

/**
 * Doorbell Service
 * Represents a doorbell accessory in HomeKit.
 */
export class Doorbell extends BaseService {
  State = {
    ProgrammableSwitchEvent: 0,
  };

  private camera?: CameraService;

  constructor(platform: any, accessory: any, camera?: CameraService) {
    super(platform, accessory);
    this.camera = camera; // Store CameraService instance
    this.setupService();
  }

  /**
   * Sets up the Doorbell service.
   * Creates the required characteristics and their event handlers.
   */
  setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.Doorbell) ||
      this.accessory.addService(this.platform.Service.Doorbell);

    // Create handler for the ProgrammableSwitchEvent characteristic
    this.service.getCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent)
      .onGet(() => this.handleProgrammableSwitchEventGet());
  }

  /**
   * Updates the Doorbell service with the latest state.
   * @param message - The message containing the updated value.
   */
  updateService(message: { value: number }): void {
    this.platform.log.debug(`[${this.device.name}] Callback state update for Doorbell: ${message.value}`);

    if (message.value === 1) {
      // Make sure the change is communicated to HomeKit
      this.service?.getCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent)
        ?.updateValue(this.State.ProgrammableSwitchEvent);
    }
  }

  /**
   * Handles the GET event for the ProgrammableSwitchEvent characteristic.
   * @returns The current value of the ProgrammableSwitchEvent characteristic.
   */
  handleProgrammableSwitchEventGet(): number {
    this.platform.log.debug('Triggered GET ProgrammableSwitchEvent');
    return this.State.ProgrammableSwitchEvent;
  }
}