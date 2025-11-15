/**
 * Handles a Loxone LightControllerV2 object.
 *
 * Responsibilities:
 * - Creates one primary HomeKit accessory representing the Light Controller.
 * - Exposes individual moods as HomeKit switch or outlet services on the primary accessory.
 * - Registers each subcontrol (dimmers, switches, color outputs) as independent HomeKit accessories.
 * - Processes mood state changes and updates all mood services accordingly.
 * - Forwards HomeKit commands to the Loxone Miniserver.
 */

import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Outlet } from '../../homekit/services/Outlet';
import { Switch as SwitchService } from '../../homekit/services/Switch';
import { LightBulb } from '../../homekit/services/LightBulb';
import { ColorLightBulb } from '../../homekit/services/ColorLightBulb';
import { Switch } from './Switch';

export class LightControllerV2 extends LoxoneAccessory {

  /**
   * Determines whether this controller should be processed based on configuration.
   */
  isSupported(): boolean {
    return this.platform.config.options.MoodSwitches === 'enabled';
  }

  /**
   * Configures the main accessory, registers subcontrols as standalone accessories,
   * registers mood services on the main accessory, and initializes mood state listeners.
   */
  configureServices(): void {

    // Assign a stable, unique name to the primary accessory
    this.device.name = this.platform.generateUniqueName(
      this.device.room,
      'LightController',
      this.device.uuidAction,
    );

    // Create HomeKit accessories for child subcontrols
    this.registerChildItems();

    // Register active mood state listener
    this.ItemStates = {
      [this.device.states.activeMoods]: {
        service: 'PrimaryService',
        state: 'activeMoods',
      },
    };

    // Push cached mood state into the main accessory on startup
    this.platform.LoxoneHandler.pushCachedState(
      this,
      this.device.states.activeMoods,
    );

    // Register mood switches as services of the primary accessory
    this.registerMoodSwitches();
  }

  /**
   * Registers one HomeKit service for each defined mood.
   * The mood services are attached to the primary accessory.
   */
  registerMoodSwitches(): void {
    const moods = JSON.parse(
      this.platform.LoxoneHandler.getLastCachedValue(this.device.states.moodList),
    );

    moods
      .filter(m => m.id !== 778)
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
   * Registers each subcontrol as an individual HomeKit accessory.
   * Supported subcontrols include dimmers, switches, and color outputs.
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

      // Assign a deterministic unique name to the subcontrol accessory
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
          break;
      }
    }
  }

  /**
   * Updates all mood services on the primary accessory upon receiving an active mood state update.
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
   * Sends a mood change command to the Loxone Miniserver.
   */
  protected handleLoxoneCommand(value: string): void {
    this.platform.LoxoneHandler.sendCommand(
      this.device.uuidAction,
      `changeTo/${value}`,
    );
  }
}