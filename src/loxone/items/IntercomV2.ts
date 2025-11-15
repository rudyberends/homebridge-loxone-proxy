import { Intercom } from './Intercom';
import { MotionSensor } from '../../homekit/services/MotionSensor';
import { CameraService } from '../../homekit/services/Camera';

/**
 * IntercomV2 is a newer generation Loxone Intercom with dynamic IP resolution
 * and support for native motion sensor integration from the Loxone system.
 */
export class IntercomV2 extends Intercom {

  protected camera?: CameraService;

  /**
   * Dynamically configures the camera stream for the intercom
   * once the Loxone system reports the IP address via the `address` state.
   * Avoids reconfiguration if already initialized.
   */
  async configureCamera(): Promise<void> {
    let isConfigured = false;

    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.address, (ip: string) => {
      if (isConfigured) {
        return;
      }

      // If the state comes wrapped in a { value } object, extract it
      if (typeof ip === 'object' && ip !== null && 'value' in ip) {
        this.platform.log.debug(`[${this.device.name}] IP is an object, extracting value: ${JSON.stringify(ip)}`);
        ip = (ip as { value: string }).value;
      }

      this.platform.log.debug(`[${this.device.name}] Resolved Intercom IP: ${ip}`);

      const base64auth = Buffer.from(`${this.platform.config.username}:${this.platform.config.password}`, 'utf8').toString('base64');
      const streamUrl = `http://${ip}/mjpg/video.mjpg`;

      this.setupCamera(streamUrl, undefined, base64auth);
      this.configureMotionSensor();

      isConfigured = true;
    });
  }

  /**
   * Attempts to locate and bind a native Loxone motion sensor associated
   * with the intercom, based on matching UUID prefixes.
   *
   * If found, adds the motion sensor to HomeKit as a MotionSensor service.
   */
  async configureMotionSensor(): Promise<void> {
    const uuidPrefix = this.device.details.deviceUuid!.split('-')[0];

    // Find all device UUIDs that share the same prefix
    const matchingUuids = Object.keys(this.platform.LoxoneItems)
      .filter(uuid => uuid.startsWith(uuidPrefix));

    if (matchingUuids.length > 0) {
      const targetUuid = matchingUuids[0]; // Assumes first match is correct
      const device = this.platform.LoxoneItems[targetUuid];

      this.platform.log.debug(`[${this.device.name}] Found matching Loxone IntercomV2 MotionSensor`);

      const serviceName = device.name.replace(/\s/g, '');

      for (const stateName in device.states) {
        const stateUUID = device.states[stateName];
        this.ItemStates[stateUUID] = { service: serviceName, state: stateName };

        this.Service[serviceName] = new MotionSensor(this.platform, this.Accessory!, device);
      }
    } else {
      this.platform.log.debug(`[${this.device.name}] No matching IntercomV2 MotionSensor found`);
    }
  }
}