import { PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../LoxonePlatform';
import { LoxoneAccessory } from '../LoxoneAccessory';
import { Control } from '../structure/LoxAPP3';
import { MoodSwitch } from './MoodSwitch';

export class LightControllerV2 {
  private device: Control;

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.device = this.accessory.context.device;
    this.RegisterMoodSwitches();
    this.RegisterChildItems();
  }

  // Create Mood Switches if enabled in config
  RegisterMoodSwitches = () => {
    if (this.platform.config.options.MoodSwitches === 'enabled') {
      const moods = JSON.parse(this.platform.LoxoneHandler.getLastCachedValue(this.device.states.moodList));
      for (const mood of moods) {
        if (mood.id !== 778) {
          const MoodSwitchItem = Object.assign({}, this.device);
          MoodSwitchItem.name = `[${this.device.room}] ${mood.name}`;
          MoodSwitchItem.cat = mood.id;
          MoodSwitchItem.details = {};
          MoodSwitchItem.subControls = {};
          new MoodSwitch(this.platform, this.accessory, MoodSwitchItem);
        }
      }
    }
  };

  // Create Mood Switches if enabled in config
  RegisterChildItems = () => {
    // Create individual Lights
    for (const childUuid in this.device.subControls) {
      const LightItem = this.device.subControls[childUuid];
      if (!(LightItem.uuidAction.indexOf('/masterValue') !== -1) || (LightItem.uuidAction.indexOf('/masterColor')) !== -1) {
        LightItem.room = this.device.room;
        LightItem.cat = this.device.cat;
        new LoxoneAccessory(this.platform, LightItem);
      }
    }
  };
}