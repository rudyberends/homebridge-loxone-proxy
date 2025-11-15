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
 * Loxone LightControllerV2
 *
 * Creates:
 *  - One main accessory (mood group)
 *  - Mood switches as HomeKit services on the main accessory
 *  - Subcontrols (dimmers, color pickers, switches) as independent accessories
 */
export class LightControllerV2 extends LoxoneAccessory {

  /**
   * Determines whether this control is supported.
   * Always registers subcontrols as independent accessories.
   * Returns true only when mood switches are enabled in the plugin configuration.
   */
  isSupported(): boolean {
    this.registerChildItems();

    // Set the base name for the main mood accessory
    this.device.name = this.platform.generateUniqueName(
      this.device.room,
      'Moods',
      this.device.uuidAction,
    );

    return this.platform.config.options.MoodSwitches === 'enabled';
  }

  /**
   * Configures HomeKit services for the main LightController accessory.
   * Maps the active mood state and registers one service per mood.
   */
  configureServices(): void {
    this.ItemStates = {
      [this.device.states.activeMoods]: {
        service: 'PrimaryService',
        state: 'activeMoods',
      },
    };

    // Push cached activeMoods state to initialize mood switches
    this.platform.LoxoneHandler.pushCachedState(
      this,
      this.device.states.activeMoods,
    );

    this.registerMoodSwitches();
  }

  /**
   * Registers virtual switches for each mood as HomeKit services
   * on the main LightController accessory.
   */
  registerMoodSwitches(): void {
    const moods = JSON.parse(
      this.platform.LoxoneHandler.getLastCachedValue(this.device.states.moodList),
    );

    moods
      .filter(mood => mood.id !== 778) // ignore default "off" mood
      .forEach(mood => {
        const moodItem = {
          ...this.device,
          // moods keep their original name (no room prefix)
          name: mood.name,
          cat: mood.id,
          details: {},
          subControls: {},
        };

        const serviceType = Switch.determineSwitchType(
          moodItem,
          this.platform.config,
        );

        this.Service[mood.name] =
          serviceType === 'outlet'
            ? new Outlet(this.platform, this.Accessory!, moodItem, this.handleLoxoneCommand.bind(this))
            : new SwitchService(this.platform, this.Accessory!, moodItem, this.handleLoxoneCommand.bind(this));
      });
  }

  /**
   * Instantiates subcontrols (ColorPickerV2, Dimmer, Switch, etc.)
   * as independent accessories.
   *
   * Each subcontrol gets its own accessory instance via its own item class.
   * Name uniqueness and HomeKit-safe naming are handled by LoxoneAccessory.
   */
  registerChildItems(): void {
    const subs = this.device.subControls;
    if (!subs || Object.keys(subs).length === 0) {
      return;
    }

    for (const childUuid in subs) {
      const lightItem = subs[childUuid];
      if (!lightItem) {
        continue;
      }

      // Skip master channels used for aggregate values
      if (
        lightItem.uuidAction?.includes('/masterValue') ||
        lightItem.uuidAction?.includes('/masterColor')
      ) {
        continue;
      }

      lightItem.details = lightItem.details || {};
      lightItem.room = this.device.room;
      lightItem.cat = this.device.cat;

      if (!lightItem.name) {
        lightItem.name = lightItem.type;
      }

      const ControlClass = typeClassMap[lightItem.type];
      if (!ControlClass) {
        continue;
      }

      if (lightItem.type === 'Switch') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (lightItem.details as any).serviceType =
          Switch.determineSwitchType(lightItem, this.platform.config);
      }

      // Each child becomes its own accessory
      new ControlClass(this.platform, lightItem);
    }
  }

  /**
   * Updates mood switch services when the active mood changes.
   * Sets the active mood switch to "on" and all others to "off".
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected callBackHandler(message: any): void {
    const currentID = parseInt(
      String(message.value).replace(/[[\]']+/g, ''),
      10,
    );

    for (const serviceName in this.Service) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service: any = this.Service[serviceName];
      message.value = currentID === parseInt(service.device.cat, 10) ? 1 : 0;
      service.updateService(message);
    }
  }

  /**
   * Sends a mood change command to the Loxone Miniserver.
   */
  protected handleLoxoneCommand(value: string): void {
    const command = `changeTo/${value}`;
    this.platform.LoxoneHandler.sendCommand(
      this.device.uuidAction,
      command,
    );
  }
}