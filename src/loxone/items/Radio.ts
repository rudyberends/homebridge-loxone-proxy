import { LoxoneAccessory } from '../../LoxoneAccessory';
import { HomeKitServiceKind } from '../../homekit/HomeKitServiceFactory';
import { AccessoryPlan, ServicePlan } from '../../platform/AccessoryPlan';
import { Switch } from './Switch';
import { LoxoneUpdateMessage } from '../LoxoneTypes';
import { dispatchHomeKitUpdate } from '../../homekit/HomeKitServiceAdapter';

/**
 * Loxone Radio Item
 */
export class Radio extends LoxoneAccessory {

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    return {
      ...super.createAccessoryPlan(uuid),
      pruneStale: true,
      services: this.createRadioServicePlans(),
      stateBindings: {
        [this.device.states.activeOutput]: {
          service: 'PrimaryService',
          state: 'activeOutput',
        },
      },
    };
  }

  /**
   * Registers virtual switches for radio outputs
   */
  private createRadioServicePlans(): ServicePlan[] {
    // Insert "allOff" virtual item at 0
    this.device.details!.outputs![0] = this.device.details.allOff;

    const outputs = this.device.details.outputs;
    const services: ServicePlan[] = [];

    for (const key in outputs) {
      const rawName = outputs[key];

      // Radio outputs are services within a single accessory, distinguished by
      // their subtype. They must not pass through the global accessory-name
      // registry, otherwise an output name that also occurs elsewhere in the run
      // (another control or radio block) gets a spurious " 1" suffix.
      const displayName = this.platform.generateUniqueName(
        this.device.room,
        rawName,
        undefined,
        true, // isSubItem: clean + room-prefixed name without global dedup
      );

      const radioItem = {
        ...this.device,
        name: displayName,
        type: 'Switch',
        cat: key,
        details: {},
        subControls: {},
      };

      const serviceType = Switch.determineSwitchType(radioItem, this.platform.config);

      this.platform.log.info(`[Radio: ${displayName}] resolved to service type: ${serviceType}`);

      const kind: HomeKitServiceKind = serviceType === 'outlet' ? 'outlet' : 'switch';
      services.push({
        id: `${this.device.uuidAction}:radio:${key}`,
        kind,
        name: displayName,
        device: radioItem,
        commands: {
          setOn: {
            uuid: this.device.uuidAction,
            action: (value: unknown, context) => {
              if (!value || !context.device?.cat) {
                return undefined;
              }
              const numeric = Number(context.device.cat);
              return numeric === 0 ? 'reset' : String(context.device.cat);
            },
            source: this.device.name,
          },
        },
      });
    }

    return services;
  }

  /**
   * Updates all radio switches when activeOutput changes
   */
  callBackHandler(message: LoxoneUpdateMessage): void {
    const active = Number(message.value);

    for (const serviceName in this.Service) {
      const service = this.Service[serviceName];
      if (!service.device) {
        continue;
      }

      message.value = active === Number(service.device.cat) ? 1 : 0;
      dispatchHomeKitUpdate(service, message);
    }
  }

}
