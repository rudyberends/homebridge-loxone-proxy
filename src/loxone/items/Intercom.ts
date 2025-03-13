import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Doorbell } from '../../homekit/services/Doorbell';
import { Switch } from '../../homekit/services/Switch';
import { CameraService } from '../../homekit/services/Camera';

/**
 * Represents an Intercom accessory for Loxone integration with HomeKit.
 * Manages a doorbell service, optional camera with HKSV recording, and child switch items.
 * Extends `LoxoneAccessory` to inherit common Loxone-to-HomeKit functionality.
 * @class
 * @extends {LoxoneAccessory}
 */
export class Intercom extends LoxoneAccessory {
  /**
   * A dictionary of HomeKit services associated with this intercom, keyed by service name.
   * @type {{ [key: string]: any }}
   */
  Service: { [key: string]: any } = {};

  /**
   * The optional camera service instance for video streaming and recording.
   * Initialized in `configureCamera` if the intercom supports a camera.
   * @type {CameraService | undefined}
   */
  camera?: CameraService;

  /**
   * Configures the services for this intercom accessory, including doorbell, camera, and child items.
   * Sets up event handlers for doorbell presses to trigger camera recording.
   */
  configureServices(): void {
    // Map the Loxone bell state to the primary doorbell service
    this.ItemStates = {
      [this.device.states.bell]: { service: 'PrimaryService', state: 'bell' },
    };

    // Initialize the primary doorbell service
    this.Service.PrimaryService = new Doorbell(this.platform, this.Accessory!);
    this.Service.PrimaryService.getCharacteristic(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent)
      .onSet(async (value, callback) => {
        this.platform.log.debug('Doorbell pressed');
        if (this.camera) {
          this.camera.updateRecordingActive(true); // Trigger HKSV recording on doorbell press
        }
        callback();
      });

    // Configure the camera and child items
    this.configureCamera();
    this.registerChildItems();
  }

  /**
   * Configures the camera service for this intercom, if supported.
   * Fetches secured details from Loxone to determine the stream URL and credentials.
   * @protected
   * @returns {Promise<void>} A promise that resolves when the camera is configured or skipped.
   */
  protected async configureCamera(): Promise<void> {
    const parsedData = await this.platform.LoxoneHandler.getsecuredDetails(this.device.uuidAction);
    const videoInfo = parsedData?.LL?.value ? JSON.parse(parsedData.LL.value)?.videoInfo : undefined;
    let streamUrl = 'undefined';

    // Skip camera configuration if no video info is available
    if (videoInfo === undefined) {
      this.platform.log.debug(`[${this.device.name}] Loxone Intercom without Camera`);
      return;
    }

    // Determine the stream URL based on device type or alert image
    if (this.device.details.deviceType === 0) {
      streamUrl = videoInfo.streamUrl;
    } else if (videoInfo.alertImage) {
      const ipAddressMatch = videoInfo.alertImage.match(/\/\/([^/]+)/);
      const ipAddress = ipAddressMatch ? ipAddressMatch[1] : undefined;
      if (ipAddress) {
        streamUrl = `http://${ipAddress}/mjpg/video.mjpg`;
      }
    }

    // Create base64-encoded credentials and initialize the camera service
    const base64auth = Buffer.from(`${videoInfo.user}:${videoInfo.pass}`, 'utf8').toString('base64');
    this.camera = new CameraService(this.platform, this.Accessory!, streamUrl, base64auth);
  }

  /**
   * Registers child items (e.g., switches) associated with this intercom as additional services.
   * Iterates through sub-controls in the Loxone device configuration.
   * @private
   */
  private registerChildItems(): void {
    for (const childUuid in this.device.subControls) {
      const ChildItem = this.device.subControls[childUuid];
      const serviceName = ChildItem.name.replace(/\s/g, '');
      for (const stateName in ChildItem.states) {
        const stateUUID = ChildItem.states[stateName];
        this.ItemStates[stateUUID] = { service: serviceName, state: stateName };
        // Initialize a Switch service for each child item
        this.Service[serviceName] = new Switch(this.platform, this.Accessory!);
      }
    }
  }
}