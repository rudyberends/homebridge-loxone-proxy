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

    this.device.name = `${this.device.room} Moods`;
    return this.platform.config.options.MoodSwitches === 'enabled';
  }

  configureServices(): void {
    this.ItemStates = {
      [this.device.states.activeMoods]: { service: 'PrimaryService', state: 'activeMoods' },
    };

    this.registerMoodSwitches();
  }

  // Create Mood Switches if enabled in config
  registerMoodSwitches(): void {
    const moods = JSON.parse(
      this.platform.LoxoneHandler.getLastCachedValue(this.device.states.moodList),
    );

    moods
      .filter(mood => mood.id !== 778)
      .forEach(mood => {
        const sanitizedMoodName = this.sanitizeLoxoneItemName(mood.name);

        const moodSwitchItem = {
          ...this.device,
          name: sanitizedMoodName,
          cat: mood.id,
          details: {},
          subControls: {},
        };

        const serviceType = Switch.determineSwitchType(moodSwitchItem, this.platform.config);

        this.platform.log.info(`[Mood: ${sanitizedMoodName}] resolved to service type: ${serviceType}`);

        this.Service[mood.name] =
        serviceType === 'outlet'
          ? new Outlet(this.platform, this.Accessory!, moodSwitchItem, this.handleLoxoneCommand.bind(this))
          : new SwitchService(this.platform, this.Accessory!, moodSwitchItem, this.handleLoxoneCommand.bind(this));
      });
  }

  // Create individual LightItems
  registerChildItems(): void {
    for (const childUuid in this.device.subControls) {
      const lightItem = this.device.subControls[childUuid];

      if (lightItem.uuidAction.includes('/masterValue') || lightItem.uuidAction.includes('/masterColor')) {
        continue;
      }

      lightItem.room = this.device.room;
      lightItem.cat = this.device.cat;

      const ControlClass = typeClassMap[lightItem.type];

      if (ControlClass) {
        if (lightItem.type === 'Switch') {
          const serviceType = Switch.determineSwitchType(lightItem, this.platform.config);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (lightItem.details as any).serviceType = serviceType;
        }

        new ControlClass(this.platform, lightItem);
      }
    }
  }

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

  protected handleLoxoneCommand(value: string): void {
    this.platform.log.debug(`[${this.device.name}] MoodSwitch update from Homekit ->`, value);
    const command = `changeTo/${value}`;
    this.platform.log.debug(`[${this.device.name}] Send command to Loxone: ${command}`);
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);
  }
}
