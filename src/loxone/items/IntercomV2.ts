import { MotionSensor } from '../../homekit/services/MotionSensor';
import { Intercom } from './Intercom';

/**
 * Loxone IntercomV2 Item
*/
export class IntercomV2 extends Intercom {

  async configureCamera(): Promise<void> {
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.address, (ip: string) => {
      this.platform.log.debug(`[${this.device.name}] Found Loxone Intercom on IP: ${ip}`);

      this.setupCamera(`http://${ip}/mjpg/video.mjpg`);

      // Fetch Intercon MotionSensor;
      this.configureMotionSensor();
    });
  }

  async configureMotionSensor(): Promise<void> {
    const targetUuidPrefix = this.device.details.deviceUuid!.split('-')[0];
    const intercomMotionUuid = Object.keys(this.platform.LoxoneItems).filter(uuid => uuid.startsWith(targetUuidPrefix));

    if (intercomMotionUuid) {
      const matchingDevice = this.platform.LoxoneItems[`${intercomMotionUuid}`];
      this.platform.log.debug(`[${this.device.name}] Found Loxone Intercom MotionSensor`);

      const serviceName = matchingDevice.name.replace(/\s/g, ''); // Removes all spaces
      for (const stateName in matchingDevice.states) {
        const stateUUID = matchingDevice.states[stateName];
        this.ItemStates[stateUUID] = { service: serviceName, state: stateName };
        this.Service[serviceName] = new MotionSensor(this.platform, this.Accessory!, matchingDevice); // Register Intercom Motion Sensor
      }
    } else {
      this.platform.log.debug(`[${this.device.name}] Unable to find Loxone Intercom MotionSensor`);
    }
  }
}