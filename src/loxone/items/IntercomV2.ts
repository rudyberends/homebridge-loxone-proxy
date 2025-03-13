import { LoxoneAccessory } from '../../LoxoneAccessory';
import { MotionSensor } from '../../homekit/services/MotionSensor'; // Adjust path as needed
import { CameraService } from '../../homekit/services/Camera';

/**
 * Represents an Intercom V2 accessory for Loxone integration with HomeKit.
 * Manages a camera service and an associated motion sensor, enabling HomeKit Secure Video (HKSV)
 * recording when motion is detected. Extends `LoxoneAccessory` for Loxone-to-HomeKit functionality.
 * @class
 * @extends {LoxoneAccessory}
 */
export class IntercomV2 extends LoxoneAccessory {
  /**
   * A dictionary of HomeKit services (MotionSensor instances) associated with this intercom, keyed by service name.
   * @type {{ [key: string]: MotionSensor }}
   */
  Service: { [key: string]: MotionSensor } = {};

  /**
   * The optional camera service instance for video streaming and recording.
   * Initialized in `configureCamera` when the intercom’s IP is resolved.
   * @type {CameraService | undefined}
   */
  camera?: CameraService;

  /**
   * Configures the services for this Intercom V2 accessory.
   * Initiates camera configuration, which in turn sets up the motion sensor.
   * @returns {Promise<void>} A promise that resolves when services are fully configured.
   */
  async configureServices(): Promise<void> {
    await this.configureCamera();
  }

  /**
   * Configures the camera service by registering a listener for the intercom’s IP address.
   * Once the IP is received, initializes the camera and configures the motion sensor.
   * @returns {Promise<void>} A promise that resolves when the camera is configured or skipped.
   */
  async configureCamera(): Promise<void> {
    let isConfigured = false;
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.address, (ip: string) => {
      if (isConfigured) {
        return;
      }
      this.platform.log.debug(`[${this.device.name}] Found Loxone Intercom on IP: ${ip}`);
      this.camera = new CameraService(this.platform, this.Accessory!, `http://${ip}/mjpg/video.mjpg`);
      this.configureMotionSensor();
      isConfigured = true;
    });
  }

  /**
   * Configures the motion sensor associated with this intercom and links it to camera recording.
   * Sets up a motion sensor service and triggers HKSV recording when motion is detected.
   * @returns {Promise<void>} A promise that resolves when the motion sensor is configured.
   */
  async configureMotionSensor(): Promise<void> {
    const targetUuidPrefix = this.device.details.deviceUuid!.split('-')[0];
    const intercomMotionUuid = Object.keys(this.platform.LoxoneItems).filter(uuid => uuid.startsWith(targetUuidPrefix));

    if (intercomMotionUuid.length > 0) {
      const matchingDevice = this.platform.LoxoneItems[intercomMotionUuid[0]];
      const serviceName = matchingDevice.name.replace(/\s/g, '');

      for (const stateName in matchingDevice.states) {
        const stateUUID = matchingDevice.states[stateName];
        this.ItemStates[stateUUID] = { service: serviceName, state: 'motion' };

        // Initialize the motion sensor service
        this.Service[serviceName] = new MotionSensor(this.platform, this.Accessory!, matchingDevice);

        // Use MotionSensor's getCharacteristic method
        this.Service[serviceName].getCharacteristic(this.platform.api.hap.Characteristic.MotionDetected)
          .onSet(async (value, callback) => {
            if (value && this.camera) {
              this.camera.updateRecordingActive(true); // Trigger HKSV recording when motion starts
            } else if (!value && this.camera) {
              this.camera.updateRecordingActive(false); // Stop recording when motion ends
            }
            callback();
          });
      }
    }
  }
}