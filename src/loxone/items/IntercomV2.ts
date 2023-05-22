import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Doorbell } from '../../homekit/services/Doorbell';
import { SwitchService } from '../../homekit/services/Switch';

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
      //new Camera(this.platform, this.accessory, ip); // Register InterCom Camera
      //new Motion(this.platform, this.accessory); // Register InterCom Motion Sensor
    });

    this.registerChildItems();
  }

  private registerChildItems(): void {
    for (const childUuid in this.device.subControls) {
      const ChildItem = this.device.subControls[childUuid];
      const serviceName = ChildItem.name; // Use the child item's name as the service name
      for (const stateName in ChildItem.states) {
        const stateUUID = ChildItem.states[stateName];
        this.ItemStates[stateUUID] = { service: serviceName, state: stateName };
        this.Service[serviceName] = new SwitchService(this.platform, this.Accessory!);
      }
    }
  }
}