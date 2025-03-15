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
      this.State.ProgrammableSwitchEvent = this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS;
      this.service?.updateCharacteristic(
        this.platform.Characteristic.ProgrammableSwitchEvent,
        this.State.ProgrammableSwitchEvent,
      );
      this.platform.log.debug(`[${this.device.name}] ProgrammableSwitchEvent updated in HomeKit`);

      const motionService = this.accessory.getService(this.platform.Service.MotionSensor);
      if (motionService) {
        try {
          motionService.updateCharacteristic(this.platform.Characteristic.MotionDetected, true);
          this.platform.log.debug(`[${this.device.name}] Doorbell triggered MotionSensor for HKSV`);
        } catch (err) {
          this.platform.log.error(`[${this.device.name}] MotionSensor update failed: ${err}`);
        }
        setTimeout(() => {
          motionService.updateCharacteristic(this.platform.Characteristic.MotionDetected, false);
          this.platform.log.debug(`[${this.device.name}] MotionSensor reset`);
        }, 5000);
      } else {
        this.platform.log.warn(`[${this.device.name}] No MotionSensor found to trigger`);
      }

      if (this.camera) {
        this.platform.log.debug(`[${this.device.name}] Intercom Doorbell. Triggering HKSV recording.`);
        this.camera.updateRecordingActive(true);
      }
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