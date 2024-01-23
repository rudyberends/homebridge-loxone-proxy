import { MotionSensor } from '../../homekit/services/MotionSensor';
import { Intercom } from './Intercom';

/**
 * Loxone IntercomV2 Item
*/
export class IntercomV2 extends Intercom {

  async configureCamera(): Promise<void> {
    let isConfigured = false;

    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.address, (ip: string) => {
      if (isConfigured) {
        return;
      }

      this.platform.log.debug(`[${this.device.name}] Found Loxone Intercom on IP: ${ip}`);
      this.setupCamera(`http://${ip}/mjpg/video.mjpg`);
      this.configureMotionSensor();  // Fetch Intercom MotionSensor;
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
        this.Service[serviceName] = new MotionSensor(this.platform, this.Accessory!, matchingDevice); // Register Intercom Motion Sensor
      }
    } else {
      this.platform.log.debug(`[${this.device.name}] Unable to find Loxone IntercomV2 MotionSensor`);
    }
  }
}