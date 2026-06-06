import { LoxoneAccessory } from '../../LoxoneAccessory';
import { HomeKitServiceKind } from '../../homekit/HomeKitServiceFactory';
import { AccessoryPlan, ServicePlan } from '../../platform/AccessoryPlan';
import { ColorPickerV2 } from './ColorPickerV2';
import { Dimmer } from './Dimmer';
import { Switch } from './Switch';
import { LoxoneEventValue, LoxoneUpdateMessage } from '../LoxoneTypes';
import { dispatchHomeKitUpdate } from '../../homekit/HomeKitServiceAdapter';

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
   * Returns true only when mood switches are enabled in the plugin configuration.
   */
  isSupported(): boolean {
    return this.platform.config.options?.MoodSwitches === 'enabled';
  }

  /**
   * Always registers subcontrols as independent accessories before deciding
   * whether the mood accessory itself should be exposed.
   */
  protected beforeSetup(): void {
    this.registerChildItems();
  }

  private static readonly MOOD_LABELS = {
    namespace: 'arabic-numerals',
  } as const;

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    this.device.name = 'Moods';

    // Mood switches are not built here: the moodList state is not yet cached at
    // mapping time. They are registered once moodList arrives (see afterSetup).
    return {
      ...super.createAccessoryPlan(uuid),
      serviceLabels: LightControllerV2.MOOD_LABELS,
      services: [],
      stateBindings: {
        [this.device.states.activeMoods]: {
          service: 'PrimaryService',
          state: 'activeMoods',
        },
      },
    };
  }

  /**
   * The moodList state is never part of ItemStates, so it is not subscribed
   * through the normal binding path. Register a dedicated listener so the
   * Miniserver pushes it; mood switches are (re)built whenever it arrives.
   */
  protected afterSetup(): void {
    this.platform.LoxoneHandler.registerListenerForUUID(
      this.device.states.moodList,
      (message) => this.handleMoodList(message.value),
    );
  }

  /**
   * Builds the mood switches from a freshly received moodList payload and
   * replays the active mood so HomeKit reflects the current state.
   */
  private handleMoodList(rawMoodList: LoxoneEventValue): void {
    if (typeof rawMoodList !== 'string') {
      return;
    }

    const servicePlans = this.createMoodServicePlans(rawMoodList);
    if (servicePlans.length === 0) {
      return;
    }

    // LightControllerV2 owns only mood services on its accessory; clear the map
    // so removed moods do not linger between moodList updates.
    this.Service = {};
    this.applyServicePlans(servicePlans, LightControllerV2.MOOD_LABELS);

    this.platform.stateRouter.replayCachedState(
      this,
      this.device.states.activeMoods,
    );
  }

  /**
   * Registers virtual switches for each mood as HomeKit services
   * on the main LightController accessory.
   */
  private createMoodServicePlans(rawMoodList: string): ServicePlan[] {
    const moods = JSON.parse(rawMoodList) as { id: number; name: string }[];

    return moods
      .filter(mood => mood.id !== 778) // ignore default "off" mood
      .map(mood => {
        const moodItem = {
          ...this.device,
          name: mood.name,
          cat: String(mood.id),
          details: {},
          subControls: {},
        };

        const serviceType = Switch.determineSwitchType(moodItem, this.platform.config);
        const kind: HomeKitServiceKind = serviceType === 'outlet' ? 'outlet' : 'switch';

        return {
          id: mood.name,
          kind,
          name: mood.name,
          device: moodItem,
          commands: {
            setOn: {
              uuid: this.device.uuidAction,
              action: (value: unknown, context) =>
                value && context.device?.cat ? `changeTo/${context.device.cat}` : undefined,
              source: this.device.name,
            },
          },
        };
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
  public callBackHandler(message: LoxoneUpdateMessage): void {
    const currentID = parseInt(
      String(message.value).replace(/[[\]']+/g, ''),
      10,
    );

    for (const serviceName in this.Service) {
      const service = this.Service[serviceName];
      if (!service.device) {
        continue;
      }

      message.value = currentID === parseInt(service.device.cat, 10) ? 1 : 0;
      dispatchHomeKitUpdate(service, message);
    }
  }

}
