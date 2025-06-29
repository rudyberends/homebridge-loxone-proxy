import { Intercom } from './Intercom';
import { MotionSensor } from '../../homekit/services/MotionSensor';
import { CameraService } from '../../homekit/services/Camera';

export class IntercomV2 extends Intercom {

  protected camera?: CameraService;

  async configureCamera(): Promise<void> {
    let isConfigured = false;

    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.address, (ip: string) => {
      if (isConfigured) {
        return;
      }

      if (typeof ip === 'object' && ip !== null && 'value' in ip) {
        this.platform.log.debug(`[${this.device.name}] IP is an object, extracting value: ${JSON.stringify(ip)}`);
        ip = (ip as { value: string }).value;
      }

      this.platform.log.debug(`[${this.device.name}] Found Loxone Intercom on IP: ${ip}`);

      const base64auth = Buffer.from(`${this.platform.config.username}:${this.platform.config.password}`, 'utf8').toString('base64');
      const streamUrl = `http://${ip}/mjpg/video.mjpg`;

      this.setupCamera(streamUrl, base64auth);

      this.configureMotionSensor();  // Fetch Intercom MotionSensor
      isConfigured = true;
    });
  }

  async configureMotionSensor(): Promise<void> {
    const targetUuidPrefix = this.device.details.deviceUuid!.split('-')[0];
    const intercomMotionUuid = Object.keys(this.platform.LoxoneItems).filter(uuid => uuid.startsWith(targetUuidPrefix));

    if (intercomMotionUuid.length > 0) {
      const matchingDevice = this.platform.LoxoneItems[`${intercomMotionUuid}`];
      this.platform.log.debug(`[${this.device.name}] Found Loxone IntercomV2 MotionSensor`);

      const serviceName = matchingDevice.name.replace(/\s/g, ''); // Removes all spaces
      for (const stateName in matchingDevice.states) {
        const stateUUID = matchingDevice.states[stateName];
        this.ItemStates[stateUUID] = { service: serviceName, state: stateName };
        // Temporarily disabled for testing
        //this.Service[serviceName] = new MotionSensor(this.platform, this.Accessory!, matchingDevice);
      }
    } else {
      this.platform.log.debug(`[${this.device.name}] Unable to find Loxone IntercomV2 MotionSensor`);
    }
  }
}