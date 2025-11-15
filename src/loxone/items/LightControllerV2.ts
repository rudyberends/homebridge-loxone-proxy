import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Outlet } from '../../homekit/services/Outlet';
import { Switch as SwitchService } from '../../homekit/services/Switch';
import { ColorPickerV2 } from './ColorPickerV2';
import { Dimmer } from './Dimmer';
import { Switch } from './Switch';

const typeClassMap = {
  ColorPickerV2,
  Dimmer,
  EIBDimmer: Dimmer,
  Switch,
};

/**
 * Loxone LightControllerV2 Item
 */
export class LightControllerV2 extends LoxoneAccessory {

  isSupported(): boolean {
    // Main accessory: Mood group
    this.device.name = this.platform.generateUniqueName(
      this.device.room,
      'Moods',
      this.device.uuidAction,
    );

    return this.platform.config.options.MoodSwitches === 'enabled';
  }

  configureServices(): void {
    this.registerChildItems();

    this.ItemStates = {
      [this.device.states.activeMoods]: {
        service: 'PrimaryService',
        state: 'activeMoods',
      },
    };

    // Initial push of cached mood state
    this.platform.LoxoneHandler.pushCachedState(this, this.device.states.activeMoods);

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
      .filter(mood => mood.id !== 778) // ignore "off"
      .forEach(mood => {
        const uniqueMoodName = this.platform.generateUniqueName(
          this.device.room,
          mood.name,
          `${this.device.uuidAction}:${mood.id}`,
        );

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
   * Instantiates ColorPicker, Dimmer, Switch sub-controls
   */
  registerChildItems(): void {
    const sub = this.device.subControls;

    if (!sub || Object.keys(sub).length === 0) {
      this.platform.log.debug(`[${this.device.name}] has no subControls – skipping`);
      return;
    }

    for (const childUuid in sub) {
      const lightItem = sub[childUuid];
      if (!lightItem) {
        continue;
      }

      lightItem.details = lightItem.details || {};

      // Skip master / internal channels
      if (
        lightItem.uuidAction?.includes('/masterValue') ||
        lightItem.uuidAction?.includes('/masterColor')
      ) {
        continue;
      }

      // Inherit context
      lightItem.room = this.device.room;
      lightItem.cat = this.device.cat;

      // Unique guaranteed name
      lightItem.name = this.platform.generateUniqueName(
        lightItem.room,
        lightItem.name ?? lightItem.type,
        childUuid,
      );

      const ControlClass = typeClassMap[lightItem.type];
      if (!ControlClass) {
        this.platform.log.debug(`[${this.device.name}] Unsupported subcontrol type: ${lightItem.type}`);
        continue;
      }

      // Determine outlet vs switch for Switch type
      if (lightItem.type === 'Switch') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (lightItem.details as any).serviceType = Switch.determineSwitchType(
          lightItem,
          this.platform.config,
        );
      }

      new ControlClass(this.platform, lightItem);
    }
  }

  /**
   * Updates mood switch states when active mood changes
   */
  protected callBackHandler(message: {
    uuid: string;
    state: string;
    service: string;
    value: string | number;
  }): void {
    const currentID = parseInt(String(message.value).replace(/[[\]']+/g, ''));

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
    const command = `changeTo/${value}`;
    this.platform.log.debug(`[${this.device.name}] Send command to Loxone: ${command}`);
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);
  }
}