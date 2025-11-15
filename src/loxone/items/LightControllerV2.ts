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
    return this.platform.config.options.MoodSwitches === 'enabled';
  }

  /**
   * Configures HomeKit services for the main LightController accessory.
   * Maps the active mood state and registers one service per mood.
   */
  configureServices(): void {

    this.device.name = this.platform.generateUniqueName(this.device.room, 'Moods', this.device.uuidAction);

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
    const moods = JSON.parse(this.platform.LoxoneHandler.getLastCachedValue(this.device.states.moodList));

    moods
      .filter(mood => mood.id !== 778) // ignore default "off" mood
      .forEach(mood => {
        const moodItem = {
          ...this.device,
          name: mood.name,
          cat: mood.id,
          details: {},
          subControls: {},
        };

        const serviceType = Switch.determineSwitchType(moodItem, this.platform.config);

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
  // Skip if there are no subcontrols at all
    if (!this.device.subControls || Object.keys(this.device.subControls).length === 0) {
      this.platform.log.debug(`[${this.device.name}] has no subControls – skipping`);
      return;
    }

    for (const childUuid in this.device.subControls) {
      const lightItem = this.device.subControls[childUuid];
      if (!lightItem) {
        continue;
      }

      // Ensure we never crash when accessing details
      lightItem.details = lightItem.details || {};

      // Skip master entries (we only want actual channels)
      if (
        lightItem.uuidAction?.includes('/masterValue') ||
      lightItem.uuidAction?.includes('/masterColor')
      ) {
        continue;
      }

      // Copy inherited context
      lightItem.room = this.device.room;
      lightItem.cat = this.device.cat;

      // Ensure unique naming before registering
      lightItem.name = this.platform.generateUniqueName(
        lightItem.room,
        lightItem.name ?? lightItem.type,
      );

      // Match the correct HomeKit class for this control
      const ControlClass = typeClassMap[lightItem.type];
      if (!ControlClass) {
        this.platform.log.debug(`[${this.device.name}] Unsupported subcontrol type: ${lightItem.type}`);
        continue;
      }

      // If the control is a Switch, determine its service type (Switch vs Outlet)
      if (lightItem.type === 'Switch') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (lightItem.details as any).serviceType = Switch.determineSwitchType(
          lightItem,
          this.platform.config,
        );
      }

      // Instantiate the correct HomeKit service
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