import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Outlet } from '../../homekit/services/Outlet';
import { Switch as SwitchService } from '../../homekit/services/Switch';
import { ColorPickerV2 } from './ColorPickerV2';
import { Dimmer } from './Dimmer';
import { Switch } from './Switch';

const typeClassMap = {
  'ColorPickerV2': ColorPickerV2,
  'Dimmer': Dimmer,
  'EIBDimmer': Dimmer,
  'Switch': Switch,
};

/**
 * Loxone LightControllerV2 Item
 */
export class LightControllerV2 extends LoxoneAccessory {

  isSupported(): boolean {
    this.registerChildItems();

    // Override the base name used for the main Mood group
    this.device.name = this.platform.generateUniqueName(this.device.room, 'Moods');
    return this.platform.config.options.MoodSwitches === 'enabled';
  }

  configureServices(): void {
    this.ItemStates = {
      [this.device.states.activeMoods]: { service: 'PrimaryService', state: 'activeMoods' },
    };

    this.registerMoodSwitches();
  }

  /**
   * Registers virtual switches for moods.
   */
  registerMoodSwitches(): void {
    const moods = JSON.parse(
      this.platform.LoxoneHandler.getLastCachedValue(this.device.states.moodList),
    );

    moods
      .filter(mood => mood.id !== 778) // ignore default "off" mood
      .forEach(mood => {
        const uniqueMoodName = this.platform.generateUniqueName(this.device.room, mood.name);

        const moodSwitchItem = {
          ...this.device,
          name: uniqueMoodName,
          cat: mood.id,
          details: {},
          subControls: {},
        };

        const serviceType = Switch.determineSwitchType(moodSwitchItem, this.platform.config);

        this.platform.log.info(`[Mood: ${uniqueMoodName}] resolved to service type: ${serviceType}`);

        this.Service[mood.name] =
          serviceType === 'outlet'
            ? new Outlet(this.platform, this.Accessory!, moodSwitchItem, this.handleLoxoneCommand.bind(this))
            : new SwitchService(this.platform, this.Accessory!, moodSwitchItem, this.handleLoxoneCommand.bind(this));
      });
  }

  /**
   * Instantiates child sub-controls as accessories (ColorPickers, Dimmers, etc.)
   */
  registerChildItems(): void {
    for (const childUuid in this.device.subControls) {
      const lightItem = this.device.subControls[childUuid];

      if (lightItem.uuidAction.includes('/masterValue') || lightItem.uuidAction.includes('/masterColor')) {
        continue;
      }

      lightItem.room = this.device.room;
      lightItem.cat = this.device.cat;

      // Ensure name uniqueness before creating child accessory
      lightItem.name = this.platform.generateUniqueName(lightItem.room, lightItem.name ?? lightItem.type);

      const ControlClass = typeClassMap[lightItem.type];
      if (ControlClass) {
        if (lightItem.type === 'Switch') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (lightItem.details as any).serviceType = Switch.determineSwitchType(lightItem, this.platform.config);
        }

        new ControlClass(this.platform, lightItem);
      }
    }
  }

  /**
   * Updates mood switch states when active mood changes
   */
  protected callBackHandler(message: { uuid: string; state: string; service: string; value: string | number }): void {
    const currentIDpreg = message.value as string;
    const currentID = parseInt(currentIDpreg.replace(/[[\]']+/g, ''));

    for (const serviceName in this.Service) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service: any = this.Service[serviceName];
      message.value = currentID === parseInt(service.device.cat) ? 1 : 0;

      const updateService = new Function(
        'message',
        `return this.Service["${serviceName}"].updateService(message);`,
      );
      updateService.call(this, message);
    }
  }

  /**
   * Sends mood change command to Loxone Miniserver
   */
  protected handleLoxoneCommand(value: string): void {
    this.platform.log.debug(`[${this.device.name}] MoodSwitch update from Homekit ->`, value);
    const command = `changeTo/${value}`;
    this.platform.log.debug(`[${this.device.name}] Send command to Loxone: ${command}`);
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);
  }
}
