import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Doorbell } from '../../homekit/services/Doorbell';
import { Switch } from '../../homekit/services/Switch';
import { CameraService } from '../../homekit/services/Camera';
import { CameraMotionSensor } from '../../homekit/services/CameraMotionSensor';

/**
 * Represents a Loxone Intercom accessory with optional camera integration.
 * Supports doorbell events, child switch controls, and motion detection via MJPEG analysis.
 */
export class Intercom extends LoxoneAccessory {

  protected camera?: CameraService;

  /**
   * Configures services including doorbell, camera (if present),
   * and additional sub-controls (e.g., door open button).
   */
  configureServices(): void {
    this.ItemStates = {
      [this.device.states.bell]: { service: 'PrimaryService', state: 'bell' },
    };

    this.configureCamera();      // Setup camera if present
    this.registerChildItems();   // Setup additional switches (e.g. unlock button)

    this.Service.PrimaryService = new Doorbell(this.platform, this.Accessory!);
  }

  /**
   * Detects and configures the camera associated with the intercom.
   * Supports both custom IP-based streams and Loxone-native formats.
   */
  protected async configureCamera(): Promise<void> {
    const parsedData = await this.platform.LoxoneHandler.getsecuredDetails(this.device.uuidAction);
    const videoInfo = parsedData?.LL?.value ? JSON.parse(parsedData.LL.value)?.videoInfo : undefined;

    if (!videoInfo) {
      this.platform.log.debug(`[${this.device.name}] No camera info found: Intercom without video`);
      return;
    }

    let streamUrl = 'undefined';
    let snapshotUrl = 'undefined';

    // Device type 0 indicates a custom camera configuration
    if (this.device.details.deviceType === 0) {
      streamUrl = videoInfo.streamUrl;
      // Extract IP from streamUrl for snapshot
      const ipMatch = streamUrl.match(/http:\/\/([\d.]+)/);
      const ipAddress = ipMatch?.[1];
      if (ipAddress) {
        snapshotUrl = `http://${ipAddress}/jpg/image.jpg`;
      }

    // Device has alertImage URL (Loxone native V1/XL intercom)
    } else if (videoInfo.alertImage) {
      const ipMatch = videoInfo.alertImage.match(/\/\/([^/]+)/);
      const ipAddress = ipMatch?.[1];

      if (ipAddress) {
        streamUrl = `http://${ipAddress}/mjpg/video.mjpg`;
        snapshotUrl = `http://${ipAddress}/jpg/image.jpg`;
      }
    }

    // Basic authentication for camera access
    const base64auth = Buffer.from(`${videoInfo.user}:${videoInfo.pass}`, 'utf8').toString('base64');

    this.setupCamera(streamUrl, snapshotUrl, base64auth);
  }

  /**
   * Initializes the CameraService and attaches a motion sensor.
   * Motion is detected via snapshot-based MJPEG size variation.
   */
  protected setupCamera(streamUrl: string, snapshotUrl: string, base64auth: string): void {
    this.camera = new CameraService(this.platform, this.Accessory!, streamUrl, snapshotUrl, base64auth);

    this.Service['CameraMotion'] = new CameraMotionSensor(
      this.platform,
      this.Accessory!,
      this.camera,
      { triggerDoorbell: () => (this.Service.PrimaryService as Doorbell).triggerDoorbell() },
    );
  }

  /**
   * Registers any sub-controls under the intercom (e.g., pushbuttons).
   * Each becomes an individual HomeKit switch service.
   */
  private registerChildItems(): void {
    for (const childUuid in this.device.subControls) {
      const child = this.device.subControls[childUuid];
      const serviceName = child.name.replace(/\s/g, '');

      for (const stateName in child.states) {
        const stateUUID = child.states[stateName];
        this.ItemStates[stateUUID] = { service: serviceName, state: stateName };

        this.Service[serviceName] = new Switch(this.platform, this.Accessory!, child);
      }
    }
  }
}