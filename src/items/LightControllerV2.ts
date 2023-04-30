import { PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../LoxonePlatform';
import { Control } from '../structure/LoxAPP3';
import { MoodSwitch } from './MoodSwitch';

export class LightControllerV2 {
  private device: Control;

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.device = this.accessory.context.device;

    //this.LoxoneListener();
    this.RegisterMoodSwitches();

  }

  // Create Mood Switches if enabled in config
  RegisterMoodSwitches = () => {
    if (this.platform.config.options.MoodSwitches === 'enabled') {
      const moods = JSON.parse(this.platform.LoxoneHandler.getLastCachedValue(this.device.states.moodList));
      for (const mood of moods) {
        if (mood.name !== 'Uit') {

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
}