import { Intercom } from './Intercom';

/**
 * Loxone IntercomV2 Item
*/
export class IntercomV2 extends Intercom {

  configureCamera(): void {
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.address, (ip: string) => {
      this.platform.log.debug(`[${this.device.name}] Found Loxone Intercom on IP: ${ip}`);

      this.setupCamera(ip);
      //new Motion(this.platform, this.accessory); // Register Intercom Motion Sensor
    });
  }
}