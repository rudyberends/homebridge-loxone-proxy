import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Doorbell } from '../../homekit/services/Doorbell';
import { SwitchService } from '../../homekit/services/Switch';
import { Camera } from '../../homekit/services/Camera';

interface VideoInfo {
  alertImage: string;
  streamUrl: string;
  deviceUuid: string;
  user: string;
  pass: string;
}

interface LLData {
  control: string;
  value: string;
  Code: string;
}

/**
 * Loxone Intercom (V1) Item
*/
export class Intercom extends LoxoneAccessory {

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.bell]: { 'service': 'PrimaryService', 'state': 'bell' },
    };

    this.Service.PrimaryService = new Doorbell(this.platform, this.Accessory!);

    // Loxone Camera Present??
    this.configureCamera();

    // Register pushbuttons on the intercom
    this.registerChildItems();
  }

  protected configureCamera(): void {
    this.platform.LoxoneHandler.getsecuredDetails(this.device.uuidAction)
      .then((parsedData: { LL: LLData }) => {

        // Parse the nested JSON string inside the 'value' property
        const valueData: { videoInfo: VideoInfo } = JSON.parse(parsedData.LL.value);

        // Extract IP address from alertImage
        const alertImageURL = valueData.videoInfo.alertImage;
        const ipAddressRegex = /\/\/([^/]+)/;
        const ipAddressMatch = alertImageURL.match(ipAddressRegex);
        const ipAddress = ipAddressMatch ? ipAddressMatch[1] : undefined;

        // Basic Authentication
        const base64auth = Buffer.from(`${valueData.videoInfo.user}:${valueData.videoInfo.pass}`, 'utf8').toString('base64');

        this.setupCamera(ipAddress, base64auth);
      });
  }

  protected setupCamera(ipAddress: string | undefined, base64auth?: string | undefined): void {
    new Camera(this.platform, this.Accessory!, ipAddress, base64auth); // Register Intercom Camera
  }

  private registerChildItems(): void {
    for (const childUuid in this.device.subControls) {
      const ChildItem = this.device.subControls[childUuid];
      const serviceName = ChildItem.name.replace(/\s/g, ''); // Removes all spaces
      for (const stateName in ChildItem.states) {
        const stateUUID = ChildItem.states[stateName];
        this.ItemStates[stateUUID] = { service: serviceName, state: stateName };
        this.Service[serviceName] = new SwitchService(this.platform, this.Accessory!, ChildItem);
      }
    }
  }
}