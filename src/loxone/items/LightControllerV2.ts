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
 * Loxone LightControllerV2
 *
 * Creates:
 *  - One main accessory (LightController)
 *  - Mood switches as HomeKit services
 *  - Subcontrols as **independent accessories**
 */
export class LightControllerV2 extends LoxoneAccessory {

  isSupported(): boolean {
    return this.platform.config.options.MoodSwitches === 'enabled';
  }

  configureServices(): void {

    this.device.name = this.platform.generateUniqueName(
      this.device.room,
      'Moods',
      this.device.uuidAction,
    );

    // Create standalone accessories for subcontrols
    this.registerChildItems();

    // Map mood state to the primary service
    this.ItemStates = {
      [this.device.states.activeMoods]: {
        service: 'PrimaryService',
        state: 'activeMoods',
      },
    };

    this.platform.LoxoneHandler.pushCachedState(this, this.device.states.activeMoods);

    // Add mood-switch services
    this.registerMoodSwitches();
  }

  /**
   * Create a HomeKit service for each mood on the main accessory.
   */
  registerMoodSwitches(): void {
    const moods = JSON.parse(
      this.platform.LoxoneHandler.getLastCachedValue(this.device.states.moodList),
    );

    moods
      .filter(m => m.id !== 778) // skip "off"
      .forEach(m => {

        const name = this.platform.generateUniqueName(
          this.device.room,
          m.name,
          `${this.device.uuidAction}:${m.id}`,
        );

        const moodItem = {
          ...this.device,
          name,
          cat: m.id,
          details: {},
          subControls: {},
        };

        const type = Switch.determineSwitchType(moodItem, this.platform.config);

        this.Service[m.name] =
          type === 'outlet'
            ? new Outlet(this.platform, this.Accessory!, moodItem, this.handleLoxoneCommand.bind(this))
            : new SwitchService(this.platform, this.Accessory!, moodItem, this.handleLoxoneCommand.bind(this));
      });
  }

  /**
   * Create **independent accessories** for each subcontrol.
   * Naming is left untouched — LoxoneAccessory handles uniqueness.
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

      // Preserve original Loxone naming
      item.details = item.details || {};
      item.room = this.device.room;
      item.cat = this.device.cat;

      if (!item.name) {
        item.name = item.type;
      }

      const Class = typeClassMap[item.type];
      if (!Class) {
        continue;
      }

      if (item.type === 'Switch') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (item.details as any).serviceType = Switch.determineSwitchType(item, this.platform.config);
      }

      // Each child becomes a fully independent accessory:
      new Class(this.platform, item);
    }
  }

  /**
   * Updates all mood switches when the active mood changes.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected callBackHandler(message: any): void {
    const activeID = parseInt(String(message.value).replace(/[[\]']+/g, ''), 10);

    for (const key in this.Service) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const srv: any = this.Service[key];
      message.value = activeID === Number(srv.device.cat) ? 1 : 0;
      srv.updateService(message);
    }
  }

  /**
   * Sends a Loxone mood-change command.
   */
  protected handleLoxoneCommand(value: string): void {
    this.platform.LoxoneHandler.sendCommand(
      this.device.uuidAction,
      `changeTo/${value}`,
    );
  }
}