import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Outlet } from '../../homekit/services/Outlet';
import { Switch as SwitchService } from '../../homekit/services/Switch';
import { ColorPickerV2 } from './ColorPickerV2';
import { Dimmer } from './Dimmer';
import { Switch } from './Switch';

/**
 * Mapping of Loxone subcontrol types to their HomeKit accessory classes.
 */
const typeClassMap = {
  ColorPickerV2,
  Dimmer,
  EIBDimmer: Dimmer,
  Switch,
};

/**
 * LightControllerV2
 *
 * Responsibilities:
 *  - Creates one primary accessory (the LightController itself)
 *  - Creates HomeKit services for all available moods
 *  - Creates independent accessories for each Loxone subcontrol
 */
export class LightControllerV2 extends LoxoneAccessory {

  /**
   * Determines whether this control should be exposed in HomeKit.
   */
  isSupported(): boolean {
    return this.platform.config.options.MoodSwitches === 'enabled';
  }

  /**
   * Configures the primary LightController accessory, registers
   * all mood services, and instantiates independent subcontrols.
   */
  configureServices(): void {

    // Assign a stable unique accessory name for the LightController itself.
    this.device.name = this.platform.generateUniqueName(
      this.device.room,
      'LightController',
      this.device.uuidAction,
    );

    // Create independent accessories for the Loxone subcontrols.
    this.registerChildItems();

    // Register mood state listener for this primary accessory.
    this.ItemStates = {
      [this.device.states.activeMoods]: {
        service: 'PrimaryService',
        state: 'activeMoods',
      },
    };

    this.platform.LoxoneHandler.pushCachedState(
      this,
      this.device.states.activeMoods,
    );

    this.registerMoodSwitches();
  }

  /**
   * Creates HomeKit services (Switch / Outlet) for each mood.
   * Mood services remain part of the main accessory and do not
   * receive unique accessory names.
   */
  registerMoodSwitches(): void {
    const moods = JSON.parse(
      this.platform.LoxoneHandler.getLastCachedValue(this.device.states.moodList),
    );

    moods
      .filter(m => m.id !== 778) // Skip "Off" mood
      .forEach(m => {

        // Mood services use the exact Loxone mood name
        const moodName = m.name;

        const moodItem = {
          ...this.device,
          name: moodName,
          cat: m.id,
          details: {},
          subControls: {},
        };

        const type =
          Switch.determineSwitchType(moodItem, this.platform.config);

        this.Service[moodName] =
          type === 'outlet'
            ? new Outlet(
              this.platform,
                this.Accessory!,
                moodItem,
                this.handleLoxoneCommand.bind(this),
            )
            : new SwitchService(
              this.platform,
                this.Accessory!,
                moodItem,
                this.handleLoxoneCommand.bind(this),
            );
      });
  }

  /**
   * Creates independent HomeKit accessories for each subcontrol
   * of the LightController (dimmers, color pickers, switches, etc.).
   * Name generation and uniqueness are handled by the LoxoneAccessory base class.
   */
  registerChildItems(): void {
    const subs = this.device.subControls;
    if (!subs) {
      return;
    }

    for (const uuid in subs) {
      const item = subs[uuid];
      if (!item) {
        continue;
      }

      // Skip internal master channels
      if (
        item.uuidAction?.includes('/masterValue') ||
        item.uuidAction?.includes('/masterColor')
      ) {
        continue;
      }

      item.details = item.details || {};
      item.room = this.device.room;
      item.cat = this.device.cat;

      // Preserve original Loxone naming; uniqueness is added by the subclass constructor
      if (!item.name) {
        item.name = item.type;
      }

      const Class = typeClassMap[item.type];
      if (!Class) {
        continue;
      }

      if (item.type === 'Switch') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (item.details as any).serviceType =
          Switch.determineSwitchType(item, this.platform.config);
      }

      // Instantiate a full independent accessory for this subcontrol
      new Class(this.platform, item);
    }
  }

  /**
   * Updates all mood services when the currently active mood changes.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected callBackHandler(message: any): void {
    const activeID = Number(
      String(message.value).replace(/[[\]']+/g, ''),
    );

    for (const key in this.Service) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const srv: any = this.Service[key];
      message.value = activeID === Number(srv.device.cat) ? 1 : 0;
      srv.updateService(message);
    }
  }

  /**
   * Sends the mood-change command to the Loxone Miniserver.
   */
  protected handleLoxoneCommand(value: string): void {
    this.platform.LoxoneHandler.sendCommand(
      this.device.uuidAction,
      `changeTo/${value}`,
    );
  }
}