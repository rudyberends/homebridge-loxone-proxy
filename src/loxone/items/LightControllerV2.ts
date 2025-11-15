import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Outlet } from '../../homekit/services/Outlet';
import { Switch as SwitchService } from '../../homekit/services/Switch';
import { LightBulb } from '../../homekit/services/LightBulb';
import { ColorLightBulb } from '../../homekit/services/ColorLightBulb';
import { Switch } from './Switch';

/**
 * LightControllerV2
 *
 * Represents a Loxone Light Controller including:
 *  • One main HomeKit accessory (room + "LightController")
 *  • Child subcontrols exposed as HomeKit services (dimmer, color light, switches)
 *  • Mood switches exposed as HomeKit services
 *
 * NOTE:
 * Subcontrols and moods are *not* separate accessories. They are individual
 * HomeKit services attached to the single LightController accessory.
 */
export class LightControllerV2 extends LoxoneAccessory {

  /**
   * Checks if moods are enabled in plugin configuration.
   */
  isSupported(): boolean {
    return this.platform.config.options.MoodSwitches === 'enabled';
  }

  /**
   * Main accessory setup:
   *  1. Assign unique/stable accessory name
   *  2. Register all child subcontrols as HomeKit services
   *  3. Register active mood listener
   *  4. Create mood switches
   */
  configureServices(): void {

    // 1 — Main accessory naming
    this.device.name = this.platform.generateUniqueName(
      this.device.room,
      'LightController',
      this.device.uuidAction,
    );

    // 2 — Create child services
    this.registerChildItems();

    // 3 — Track active mood
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

    // 4 — Create mood switch services
    this.registerMoodSwitches();
  }

  /**
   * Creates one HomeKit switch per available mood.
   * All mood switches belong to the main LightController accessory.
   */
  registerMoodSwitches(): void {
    const moods = JSON.parse(
      this.platform.LoxoneHandler.getLastCachedValue(this.device.states.moodList),
    );

    moods
      .filter(m => m.id !== 778) // skip the "off" mood
      .forEach(m => {
        const moodName = this.platform.generateUniqueName(
          this.device.room,
          m.name,
          `${this.device.uuidAction}:${m.id}`,
        );

        const moodItem = {
          ...this.device,
          name: moodName,
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
   * Registers services for each child subcontrol under this LightController.
   * Subcontrols are not separate accessories.
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

      // Skip master channels
      if (
        item.uuidAction?.includes('/masterValue') ||
        item.uuidAction?.includes('/masterColor')
      ) {
        continue;
      }

      item.details = item.details || {};
      item.room = this.device.room;
      item.cat = this.device.cat;

      item.name = this.platform.generateUniqueName(
        item.room,
        item.name ?? item.type,
        uuid,
      );

      switch (item.type) {

        case 'Dimmer':
        case 'EIBDimmer':
          this.Service[item.name] =
            new LightBulb(this.platform, this.Accessory!, item, this.handleLoxoneCommand.bind(this));
          break;

        case 'ColorPickerV2':
          this.Service[item.name] =
            new ColorLightBulb(this.platform, this.Accessory!, item, this.handleLoxoneCommand.bind(this));
          break;

        case 'Switch':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (item.details as any).serviceType =
            Switch.determineSwitchType(item, this.platform.config);

          this.Service[item.name] =
            item.details.serviceType === 'outlet'
              ? new Outlet(this.platform, this.Accessory!, item, this.handleLoxoneCommand.bind(this))
              : new SwitchService(this.platform, this.Accessory!, item, this.handleLoxoneCommand.bind(this));
          break;

        default:
          // Unsupported control → ignore
          break;
      }
    }
  }

  /**
   * Updates all mood switch services when the active mood changes.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected callBackHandler(message: any): void {
    const activeID = Number(String(message.value).replace(/[[\]']+/g, ''));

    for (const key in this.Service) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service: any = this.Service[key];
      message.value = activeID === Number(service.device.cat) ? 1 : 0;
      service.updateService(message);
    }
  }

  /**
   * Sends the changeTo/<id> command to the Miniserver.
   */
  protected handleLoxoneCommand(value: string): void {
    this.platform.LoxoneHandler.sendCommand(
      this.device.uuidAction,
      `changeTo/${value}`,
    );
  }
}