import { PlatformAccessory, Service } from 'homebridge';
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
      services: [{
        ...service,
        device: service.device ?? this.device,
      }],
      stateBindings,
    };
  }

  private configurePlannedServices(plan: AccessoryPlan): void {
    this.applyServicePlans(plan.services, plan.serviceLabels, plan.pruneStale);
  }

  /**
   * Builds (or reuses) the given service plans on this accessory. Safe to call
   * after setup for items whose services only become known once a Loxone state
   * arrives (e.g. LightControllerV2 moods).
   *
   * Set pruneStale only when these plans are the complete set of services for
   * the accessory; otherwise services added outside the plan (cameras, sensors
   * configured asynchronously) would be wrongly removed.
   */
  protected applyServicePlans(
    services: ServicePlan[],
    serviceLabels?: AccessoryPlan['serviceLabels'],
    pruneStale = false,
  ): void {
    if (!this.Accessory) {
      return;
    }

    this.configureServiceLabels(serviceLabels, services.length);

    const kept = new Set<Service>();
    services.forEach((servicePlan, index) => {
      const service = buildHomeKitService(
        this.platform,
        this.Accessory!,
        servicePlan,
      );
      this.configureServiceLabelIndex(serviceLabels, service, index);
      this.Service[servicePlan.id] = service;
      if (service.service) {
        kept.add(service.service);
      }
    });

    if (pruneStale) {
      this.pruneStaleServices(kept);
    }
  }

  /**
   * Removes services left over on a restored accessory that are no longer part
   * of the current plan (e.g. renamed grouped switches from older versions).
   * The reconciler only prunes whole accessories, so without this stale
   * services linger and surface as duplicate tiles in HomeKit.
   */
  private pruneStaleServices(kept: Set<Service>): void {
    const protectedTypes = new Set([
      this.platform.Service.AccessoryInformation.UUID,
      this.platform.Service.ServiceLabel.UUID,
    ]);

    for (const service of [...this.Accessory!.services]) {
      if (kept.has(service) || protectedTypes.has(service.UUID)) {
        continue;
      }
      this.platform.log.info(
        `[${this.device.name}] Removing stale service: ${service.displayName ?? service.UUID}`,
      );
      this.Accessory!.removeService(service);
    }
  }

  private configureServiceLabels(
    serviceLabels: AccessoryPlan['serviceLabels'],
    serviceCount: number,
  ): void {
    if (!serviceLabels || serviceCount < 2) {
      return;
    }

    const labelService =
      this.Accessory!.getService(this.platform.Service.ServiceLabel) ||
      this.Accessory!.addService(this.platform.Service.ServiceLabel);

    const namespace =
      serviceLabels.namespace === 'dots'
        ? this.platform.Characteristic.ServiceLabelNamespace.DOTS
        : this.platform.Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS;

    labelService.setCharacteristic(
      this.platform.Characteristic.ServiceLabelNamespace,
      namespace,
    );
  }

  private configureServiceLabelIndex(
    serviceLabels: AccessoryPlan['serviceLabels'],
    service: HomeKitServiceAdapter,
    index: number,
  ): void {
    if (!serviceLabels || !service.service) {
      return;
    }

    // ServiceLabelIndex is not a standard Switch/Outlet characteristic; register
    // it as optional so HAP does not warn each time we set the group index.
    service.service.addOptionalCharacteristic(this.platform.Characteristic.ServiceLabelIndex);
    service.service.setCharacteristic(
      this.platform.Characteristic.ServiceLabelIndex,
      index + 1,
    );
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
