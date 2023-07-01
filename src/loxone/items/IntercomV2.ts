import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Doorbell } from '../../homekit/services/Doorbell';
import { SwitchService } from '../../homekit/services/Switch';
import { Camera } from '../../homekit/services/Camera';

/**
 * Loxone IntercomV2 Item
*/
export class IntercomV2 extends LoxoneAccessory {

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.bell]: {'service': 'PrimaryService', 'state': 'bell'},
    };

    this.Service.PrimaryService = new Doorbell(this.platform, this.Accessory!);

    // Loxone Intercom Present??
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.address, (ip: string) => {
      this.platform.log.debug(`[${this.device.name}] Found Loxone Intercom on IP: ${ip}`);

      new Camera(this.platform, this.Accessory!, ip); // Register Intercom Camera
      //new Motion(this.platform, this.accessory); // Register Intercom Motion Sensor
    });

    this.registerChildItems();
  }

  private registerChildItems(): void {
    for (const childUuid in this.device.subControls) {
      const ChildItem = this.device.subControls[childUuid];
      const serviceName = ChildItem.name;
      for (const stateName in ChildItem.states) {
        const stateUUID = ChildItem.states[stateName];
        this.ItemStates[stateUUID] = { service: serviceName, state: stateName };
        this.Service[serviceName] = new SwitchService(this.platform, this.Accessory!, ChildItem);
      }
    }
  }
}