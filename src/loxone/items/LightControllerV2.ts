import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Dimmer } from './Dimmer';
import { Switch } from './Switch';

/**
 * Loxone Switch Item
*/
export class LightControllerV2 extends LoxoneAccessory {

  isSupported(): boolean {

    this.RegisterChildItems();
    return false;
  }

  configureServices(): void {

    /*
    this.ItemStates = {
      [this.device.states.active]: {'service': 'PrimaryService', 'state': 'active'},
    };

    this.Service.PrimaryService = (this.device.name.includes(this.platform.config.switchAlias?.Lock))
      ? new LockMechanism(this.platform, this.Accessory!)
      : new SwitchService(this.platform, this.Accessory!);
      */
  }

  // Create individual Lights
  RegisterChildItems() {
    for (const childUuid in this.device.subControls) {
      const LightItem = this.device.subControls[childUuid];
      if (!(LightItem.uuidAction.indexOf('/masterValue') !== -1) || (LightItem.uuidAction.indexOf('/masterColor')) !== -1) {
        LightItem.room = this.device.room;
        LightItem.cat = this.device.cat;

        switch (LightItem.type) {
          case 'Dimmer':
            new Dimmer(this.platform, LightItem);
            break;
          case 'Switch':
            new Switch(this.platform, LightItem);
        }
      }
    }
  }
}