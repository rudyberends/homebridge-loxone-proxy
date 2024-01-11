import { LoxoneAccessory } from '../../LoxoneAccessory';
import { MoodSwitch } from '../../homekit/services/MoodSwitch';
import { ColorPickerV2 } from './ColorPickerV2';
import { Dimmer } from './Dimmer';
import { Switch } from './Switch';

/**
 * Loxone LightControllerV2 Item
*/
export class LightControllerV2 extends LoxoneAccessory {

  isSupported(): boolean {
    this.registerChildItems();

    return (this.platform.config.options.MoodSwitches === 'enabled') ? true : false;
  }

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.activeMoods]: { 'service': 'PrimaryService', 'state': 'activeMoods' },
    };

    this.registerMoodSwitches();
  }

  // Create Mood Switches if enabled in config
  registerMoodSwitches(): void {
    const moods = JSON.parse(this.platform.LoxoneHandler.getLastCachedValue(this.device.states.moodList));
    for (const mood of moods) {
      if (mood.id !== 778) {
        const moodSwitchItem = {
          ...this.device,
          name: `${mood.name}`,
          cat: mood.id,
          details: {},
          subControls: {},
        };
        //const stateUUID = this.device.states.activeMoods;
        //this.ItemStates[stateUUID] = { service: moodSwitchItem.name, state: 'activeMoods' };
        this.Service[mood.name] = new MoodSwitch(this.platform, this.Accessory!, moodSwitchItem);
      }
    }
  }

  // Create individual LightItems
  registerChildItems(): void {
    for (const childUuid in this.device.subControls) {
      const lightItem = this.device.subControls[childUuid];
      if (
        lightItem.uuidAction.indexOf('/masterValue') !== -1 ||
        lightItem.uuidAction.indexOf('/masterColor') !== -1
      ) {
        continue;
      }

      lightItem.room = this.device.room;
      lightItem.cat = this.device.cat;

      switch (lightItem.type) {
        case 'ColorPickerV2':
          new ColorPickerV2(this.platform, lightItem);
          break;
        case 'Dimmer':
          new Dimmer(this.platform, lightItem);
          break;
        case 'Switch':
          new Switch(this.platform, lightItem);
          break;
      }
    }
  }

  protected callBackHandler(message: { uuid: string; state: string; service: string; value: string | number }): void {
    const currentID: string = message.value as unknown as string;
    message.value = currentID.replace(/[[\]']+/g, '');
    message.value = parseInt(message.value);

    for (const serviceName in this.Service) {
      const updateService = new Function('message', `return this.Service["${serviceName}"].updateService(message);`);
      updateService.call(this, message);
    }
  }
}