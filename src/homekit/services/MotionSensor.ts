import { BaseService } from './BaseService';
import { PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../../LoxonePlatform';
import { CameraService } from './Camera';

/**
 * Represents a Motion Sensor accessory.
 */
export class MotionSensor extends BaseService {
  State = {
    MotionDetected: false,
  };

  private camera?: CameraService;

  constructor(platform: LoxonePlatform, accessory: PlatformAccessory, device?: any, camera?: CameraService) {
    super(platform, accessory, device);
    this.camera = camera;  // Optional camera reference
    this.setupService();
  }

  /**
   * Sets up the motion sensor service.
   */
  setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.MotionSensor) ||
      this.accessory.addService(this.platform.Service.MotionSensor);

    // Create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.MotionDetected)
      .onGet(this.handleMotionDetectedGet.bind(this));
  }

  updateService = (message: { value: number }) => {

    // Only proceed if the message value is 0 or 1 (Ignore NfcCodeTouch values other than doorbell)
    if (message.value !== 0 && message.value !== 1) {
      this.platform.log.debug(`[${this.device.name}] Ignored message value: ${message.value}`);
      return;
    }

    this.platform.log.debug(`[${this.device.name}] Callback state update for MotionSensor: ${!!message.value}`);
    this.State.MotionDetected = !!message.value;

    // Also make sure this change is directly communicated to HomeKit
    this.service!.getCharacteristic(this.platform.Characteristic.MotionDetected).updateValue(this.State.MotionDetected);

    // Trigger camera recording if motion is detected
    if (this.State.MotionDetected && this.camera) {
      this.platform.log.debug(`[${this.device.name}] Intercom MotionSensor. Triggering HKSV recording.`);
      this.camera.updateRecordingActive(true); // Trigger HKSV recording when motion starts
    }
  };

  /**
   * Handle requests to get the current value of the "Motion Detected" characteristic.
   */
  handleMotionDetectedGet() {
    this.platform.log.debug('Triggered GET MotionDetected');
    return this.State.MotionDetected;
  }
}