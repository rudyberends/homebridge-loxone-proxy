import { PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from './LoxonePlatform';
import { Control } from './loxone/StructureFile';
import { LoxoneItemStates, LoxoneUpdateMessage } from './loxone/LoxoneTypes';
import { dispatchHomeKitUpdate, HomeKitServiceAdapter } from './homekit/HomeKitServiceAdapter';
import { buildHomeKitService } from './homekit/HomeKitServiceFactory';
import { AccessoryPlan, ServicePlan } from './platform/AccessoryPlan';

/**
 * LoxoneAccessory
 * An instance of this class is created for each accessory Loxone platform registers.
 * Each accessory may expose multiple services of different service types.
 */
export class LoxoneAccessory {
  Accessory: PlatformAccessory | undefined;
  Service: Record<string, HomeKitServiceAdapter> = {};
  ItemStates: LoxoneItemStates = {};

  constructor(readonly platform: LoxonePlatform, readonly device: Control) {
    if (this.platform.AccessoryCount >= 149) {
      this.platform.log.info(
        `[${device.type}Item] Max HomeKit Accessories limit reached. Item not mapped: ${device.name}`,
      );
      return;
    }

    this.beforeSetup();

    if (!this.isSupported()) {
      this.platform.log.debug(`[${device.type}Item] Skipping unsupported item: ${device.name}`);
      return;
    }

    this.setupAccessory();
  }

  protected isSupported(): boolean {
    return true;
  }

  protected beforeSetup(): void {
    // Optional hook for composite Loxone items that fan out into child accessories.
  }

  private setupAccessory(): void {
    const uuid = this.platform.api.hap.uuid.generate(this.device.uuidAction);
    const plan = this.createAccessoryPlan(uuid);
    this.ItemStates = plan.stateBindings;
    this.Accessory = this.platform.accessoryReconciler.reconcile(plan);

    if (plan.services.length > 0) {
      this.configurePlannedServices(plan);
    } else {
      this.configureServices(this.Accessory);
    }

    this.setupListeners();
    this.afterSetup();

    this.platform.AccessoryCount++;
  }

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    return this.createBaseAccessoryPlan(uuid);
  }

  private createBaseAccessoryPlan(uuid: string): AccessoryPlan {
    const baseName = this.device.name ?? 'Unnamed';
    const roomName = this.device.room ?? 'Unknown';
    const displayName = this.platform.generateUniqueName(roomName, baseName, uuid);

    return {
      id: uuid,
      displayName,
      room: roomName,
      source: {
        type: this.device.type,
        uuidAction: this.device.uuidAction,
        originalName: baseName,
      },
      context: {
        device: this.device,
      },
      services: [],
      stateBindings: this.ItemStates,
    };
  }

  protected createSingleServicePlan(
    uuid: string,
    service: ServicePlan,
    stateBindings: LoxoneItemStates,
  ): AccessoryPlan {
    return {
      ...this.createBaseAccessoryPlan(uuid),
      services: [service],
      stateBindings,
    };
  }

  private configurePlannedServices(plan: AccessoryPlan): void {
    for (const servicePlan of plan.services) {
      this.Service[servicePlan.id] = buildHomeKitService(
        this.platform,
        this.Accessory!,
        servicePlan,
      );
    }
  }

  protected afterSetup(): void {
    // Optional hook for items that need cache replay after services are ready.
  }

  // Override this in subclasses to add specific HomeKit services
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected configureServices(accessory: PlatformAccessory): void {
    // implemented by child classes
  }

  private setupListeners(): void {
    this.platform.stateRouter.bind(this, this.ItemStates);
  }

  public callBackHandler(message: LoxoneUpdateMessage): void {
    this.platform.log.debug(`[${this.device.name}] Callback service: ${message.service}`);
    const service = this.Service[message.service];
    if (!service) {
      this.platform.log.warn(`[${this.device.name}] No HomeKit service registered for ${message.service}`);
      return;
    }

    dispatchHomeKitUpdate(service, message);
  }

  protected matchAlias(deviceName: string, alias: string): boolean {
    const aliasRegex = alias.trim().replace(/%/g, '.*').replace(/\s+/g, '\\s*');
    return new RegExp(aliasRegex, 'i').test(deviceName.trim());
  }
}
