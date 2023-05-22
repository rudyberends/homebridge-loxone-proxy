import { LoxoneAccessory } from '../../LoxoneAccessory';
import { ColorPickerV2 } from './ColorPickerV2';
import { Dimmer } from './Dimmer';
import { Switch } from './Switch';

/**
 * Loxone LightControllerV2 Item
*/
export class LightControllerV2 extends LoxoneAccessory {

  isSupported(): boolean {
    this.registerChildItems();
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
  registerChildItems(): void {
    for (const childUuid in this.device.subControls) {
      const LightItem = this.device.subControls[childUuid];
      if (
        LightItem.uuidAction.indexOf('/masterValue') !== -1 ||
        LightItem.uuidAction.indexOf('/masterColor') !== -1
      ) {
        continue;
      }

      LightItem.room = this.device.room;
      LightItem.cat = this.device.cat;

      switch (LightItem.type) {
        case 'ColorPickerV2':
          new ColorPickerV2(this.platform, LightItem);
          break;
        case 'Dimmer':
          new Dimmer(this.platform, LightItem);
          break;
        case 'Switch':
          new Switch(this.platform, LightItem);
          break;
      }
    }
  }
}