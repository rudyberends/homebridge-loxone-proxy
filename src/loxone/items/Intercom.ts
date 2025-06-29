import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Doorbell } from '../../homekit/services/Doorbell';
import { Switch } from '../../homekit/services/Switch';
import { CameraService } from '../../homekit/services/Camera';
import { CameraMotionSensor } from '../../homekit/services/CameraMotionSensor';

/**
 * Loxone Intercom (V1) Item
*/
export class Intercom extends LoxoneAccessory {

  protected camera?: CameraService;

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.bell]: { 'service': 'PrimaryService', 'state': 'bell' },
    };

    // Loxone Camera Present??
    this.configureCamera();

    // Register pushbuttons on the intercom
    this.registerChildItems();

    this.Service.PrimaryService = new Doorbell(this.platform, this.Accessory!);
  }

  protected async configureCamera(): Promise<void> {
    const parsedData = await this.platform.LoxoneHandler.getsecuredDetails(this.device.uuidAction);
    const videoInfo = parsedData?.LL?.value ? JSON.parse(parsedData.LL.value)?.videoInfo : undefined;
    let streamUrl = 'undefined';

    if (videoInfo === undefined) { // Intercom without Camera
      this.platform.log.debug(`[${this.device.name}] Loxone Intercom without Camera`);
      return;
    }

    if (this.device.details.deviceType === 0) { // Custom Intercom
      streamUrl = videoInfo.streamUrl;
    } else if (videoInfo.alertImage) { // Loxone V1/XL Intercom
      const ipAddressMatch = videoInfo.alertImage.match(/\/\/([^/]+)/);
      const ipAddress = ipAddressMatch ? ipAddressMatch[1] : undefined;

      if (ipAddress) {
        streamUrl = `http://${ipAddress}/mjpg/video.mjpg`;
      }
    }

    // Basic Authentication
    const base64auth = Buffer.from(`${videoInfo.user}:${videoInfo.pass}`, 'utf8').toString('base64');

    this.setupCamera(streamUrl, base64auth);
  }

  protected setupCamera(streamUrl: string, base64auth: string): void {
    const enableHKSV = this.platform.config.enableHKSV ?? false;
    this.camera = new CameraService(this.platform, this.Accessory!, streamUrl, base64auth);

    // Built-in Motion Sensor Based on MJPEG Frame Size Variations
    if (enableHKSV) {
      this.Service['CameraMotion'] = new CameraMotionSensor(
        this.platform,
      this.Accessory!,
      this.camera,
      );
    }
  }

  private registerChildItems(): void {
    for (const childUuid in this.device.subControls) {
      const ChildItem = this.device.subControls[childUuid];
      const serviceName = ChildItem.name.replace(/\s/g, ''); // Removes all spaces
      for (const stateName in ChildItem.states) {
        const stateUUID = ChildItem.states[stateName];
        this.ItemStates[stateUUID] = { service: serviceName, state: stateName };
        this.Service[serviceName] = new Switch(this.platform, this.Accessory!, ChildItem);
      }
    }
  }
}