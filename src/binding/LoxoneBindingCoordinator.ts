import type { PlatformAccessory, Service } from 'homebridge';
import {
  LoxoneClient,
  type ControlHandle,
  type Logger as LoxoneLogger,
  type LoxoneClientOptions,
} from 'loxone-ts-client';
import type { LoxonePlatform } from '../LoxonePlatform';
import { sanitizeName } from '../AccessoryNameRegistry';
import {
  normalizeLoxoneConfig,
  validateLoxoneConnectionConfig,
  type LoxoneConnectionConfig,
  type NormalizedLoxoneConfig,
} from '../LoxoneConfig';
import { COMPOSITE_BINDERS, CONTROL_BINDERS, type PlannedAccessory, type ServiceBinding } from './ControlBinders';
import { RoomBridgePublisher } from './RoomBridgePublisher';

const PLUGIN_NAME = 'homebridge-loxone-proxy';
const PLATFORM_NAME = 'LoxonePlatform';
const MAX_CONNECT_ATTEMPTS = 6;

/**
 * The plugin's engine: owns the loxone-ts-client connection, discovers every
 * control, and binds it to HomeKit through the {@link ./ControlBinders} registry
 * and the {@link ./BindingEngine}. It reuses the platform's reconciler and name
 * registry, and honours the room-filter / Exclusions config; a typed control
 * handle drives the characteristics directly.
 */
export class LoxoneBindingCoordinator {
  private client: LoxoneClient | undefined;
  private started = false;
  private rebuilding = false;
  /** Per-accessory disposer, so a rebuild can drop old subscriptions before re-binding. */
  private readonly disposers = new Map<string, () => void>();
  /** Control types without a HomeKit mapping, logged once each (avoids per-rebuild spam). */
  private readonly loggedUnsupported = new Set<string>();
  /** Publishes per-room HAP bridges for rooms configured with `bridge: true`; other rooms use the main bridge. */
  private readonly publisher = new RoomBridgePublisher(this.platform);

  constructor(private readonly platform: LoxonePlatform) {}

  /** The current Miniserver communication token (for authenticated side channels, e.g. intercom talkback). */
  get token(): string | undefined {
    return this.client?.token;
  }

  /** Miniserver temperature display unit (0 = Celsius, 1 = Fahrenheit), for the thermostat binding. */
  get temperatureUnit(): number {
    return Number(this.client?.structure?.msInfo?.tempUnit) || 0;
  }

  /**
   * Connects the client (with bounded retry) and binds all controls. The initial
   * bind doesn't prune (deferred accessories — moods, irrigation zones, the
   * camera — need state that arrives in the burst); the first `statesSettled`
   * rebuild prunes anything no longer present. Idempotent.
   */
  async start(): Promise<void> {
    if (this.started) {
      this.rebuild(true);
      return;
    }
    this.started = true;

    // Fail loud on bad config instead of silently retrying an unreachable connect.
    const errors = validateLoxoneConnectionConfig(this.platform.config as LoxoneConnectionConfig);
    if (errors.length > 0) {
      this.platform.log.error(`[BindingEngine] Invalid Loxone configuration: ${errors.join(', ')}`);
      return;
    }

    const client = this.buildClient();
    this.client = client;
    // Re-bind (and prune) once the state burst settles, and again after each reconnect re-sync.
    client.on('statesSettled', () => this.rebuild(true));

    if (!(await this.connectWithRetry(client))) {
      this.platform.log.error('[BindingEngine] Could not connect to the Miniserver; no accessories available this run');
      return;
    }
    this.rebuild(false);
  }

  /** Releases the connection and all engine subscriptions (Homebridge shutdown). */
  async stop(): Promise<void> {
    this.disposers.forEach((dispose) => dispose());
    this.disposers.clear();
    await this.publisher?.dispose();
    const client = this.client;
    this.client = undefined;
    await client?.disconnect().catch(() => undefined);
  }

  private buildClient(): LoxoneClient {
    const { config } = this.platform;
    const options: LoxoneClientOptions = {
      useTls: Boolean(config.TLS),
      logger: this.loxoneLogger(),
    };
    return new LoxoneClient(this.buildHost(), config.username, config.password, options);
  }

  private async connectWithRetry(client: LoxoneClient): Promise<boolean> {
    for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
      try {
        await client.connect();
        this.platform.log.info(`[BindingEngine] Connected to Miniserver at ${this.buildHost()}`);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const delayMs = Math.min(30000, 2000 * 2 ** Math.min(attempt - 1, 4));
        const seconds = Math.round(delayMs / 1000);
        this.platform.log.warn(
          `[BindingEngine] Connect attempt ${attempt}/${MAX_CONNECT_ATTEMPTS} failed: ${message}. Retrying in ${seconds}s`,
        );
        await delay(delayMs);
      }
    }
    return false;
  }

  /** (Re)discovers all controls and (re)binds them to HomeKit; prunes the rest when `prune` is set. */
  private rebuild(prune: boolean): void {
    const client = this.client;
    if (!client || this.rebuilding) {
      return;
    }
    this.rebuilding = true;
    try {
      const filter = normalizeLoxoneConfig(this.platform.config);
      const seen = new Set<string>();
      let incomplete = false;

      for (const handle of client.items()) {
        if (this.isFiltered(handle, filter)) {
          continue;
        }
        // Isolate each control: one binder throwing must not abort the whole rebuild.
        try {
          for (const planned of this.plan(handle, client)) {
            const accessoryUuid = this.platform.api.hap.uuid.generate(planned.uuidSource);
            seen.add(accessoryUuid);

            const accessory = this.reconcile(accessoryUuid, planned);
            this.disposers.get(accessoryUuid)?.();
            this.disposers.set(accessoryUuid, this.applyBindings(accessory, planned));
          }
        } catch (error) {
          incomplete = true;
          this.platform.log.warn(
            `[BindingEngine] Failed to bind ${handle.type} "${handle.name}": ${(error as Error).message}`,
          );
        }
      }

      // Prune only after a fully clean rebuild: a binding error leaves `seen`
      // incomplete, and pruning then would unregister still-valid accessories.
      if (prune && incomplete) {
        this.platform.log.warn('[BindingEngine] Skipping prune this round (a control failed to bind; live set incomplete)');
      } else if (prune) {
        this.prune(seen);
      }

      // Publish any room bridge that gained its first accessory this round (no-op in single-bridge mode).
      this.publisher?.finalize();
    } finally {
      this.rebuilding = false;
    }
  }

  /** Expands a top-level control into the accessories it should produce (1 for most, several for composites). */
  private plan(handle: ControlHandle, client: LoxoneClient): PlannedAccessory[] {
    const composite = COMPOSITE_BINDERS[handle.type];
    if (composite) {
      return composite(this.platform, handle, client);
    }
    const binder = CONTROL_BINDERS[handle.type];
    if (!binder) {
      if (!this.loggedUnsupported.has(handle.type)) {
        this.loggedUnsupported.add(handle.type);
        this.platform.log.debug(`[BindingEngine] No HomeKit mapping for control type "${handle.type}" — skipping`);
      }
      return [];
    }
    const services = binder(this.platform, handle);
    if (services.length === 0) {
      return []; // the binder chose not to expose this control (e.g. an unclassified sensor)
    }
    return [{ uuidSource: handle.uuid, type: handle.type, name: handle.name, room: handle.roomName ?? 'Unassigned', services }];
  }

  /** Honours type Exclusions plus the per-room `rooms` config (legacy roomfilter as fallback). */
  private isFiltered(handle: ControlHandle, filter: NormalizedLoxoneConfig): boolean {
    if (filter.excludedTypes.includes(handle.type)) {
      return true;
    }
    const rooms = this.roomSettings();
    if (Object.keys(rooms).length > 0) {
      // Per-room model: a room is hidden only when explicitly not exposed.
      return rooms[handle.roomName ?? 'Unassigned']?.excluded === true;
    }
    // Legacy fallback: the old global roomfilter list + mode.
    const room = (handle.roomName ?? '').toLowerCase();
    const roomMatched = filter.roomFilter.rooms.includes(room);
    return filter.roomFilter.type === 'exclusion' ? roomMatched : !roomMatched;
  }

  /** Per-room settings map from config (`{ "Woonkamer": { bridge: true }, "Garage": { excluded: true } }`). */
  private roomSettings(): Record<string, { excluded?: boolean; bridge?: boolean }> {
    const rooms = (this.platform.config as { rooms?: unknown }).rooms;
    return rooms && typeof rooms === 'object'
      ? (rooms as Record<string, { excluded?: boolean; bridge?: boolean }>)
      : {};
  }

  /** Whether a room should get its own HAP bridge (vs. the main Homebridge bridge). */
  private usesBridge(room: string): boolean {
    // Loxone "central" rooms hold whole-house functions, not a real room — always main bridge.
    return this.roomSettings()[room]?.bridge === true && !this.isCentralRoom(room);
  }

  /** A Loxone "central" room (typeName 'central') groups whole-house functions, not a physical room. */
  private isCentralRoom(room: string): boolean {
    return (this.client?.rooms ?? []).some((view) => view.name === room && view.typeName === 'central');
  }

  /** Finds the cached accessory (or creates + registers it) and refreshes its AccessoryInformation. */
  private reconcile(accessoryUuid: string, planned: PlannedAccessory): PlatformAccessory {
    const displayName = this.platform.generateUniqueName(planned.room, planned.name, accessoryUuid);
    const useBridge = this.usesBridge(planned.room);
    const { accessory, isNew } = this.upsertAccessory(accessoryUuid, displayName, useBridge);
    if (isNew) {
      this.platform.log.debug(`[BindingEngine] Added accessory: ${displayName} (${planned.type})`);
    }
    accessory.context.planId = accessoryUuid;
    accessory.context.device = { type: planned.type, uuidAction: planned.uuidSource, name: planned.name, room: planned.room };
    this.updateAccessoryInformation(accessory, planned.room, planned.uuidSource, displayName);
    if (useBridge) {
      this.publisher.register(accessory, planned.room);
    }
    return accessory;
  }

  /**
   * Finds (or creates) the accessory for `id`, on the right bridge. Room-bridge
   * accessories are tracked by the publisher and NOT in `platform.accessories`;
   * main-bridge accessories are registered on Homebridge's bridge as usual. When a
   * room flips to its own bridge, the stale main-bridge accessory is dropped first.
   */
  private upsertAccessory(id: string, displayName: string, useBridge: boolean): { accessory: PlatformAccessory; isNew: boolean } {
    if (useBridge) {
      const tracked = this.publisher.get(id);
      if (tracked) {
        tracked.displayName = displayName;
        return { accessory: tracked, isNew: false };
      }
      // Room just got its own bridge — drop the stale copy from the main bridge.
      const staleIndex = this.platform.accessories.findIndex((acc) => acc.UUID === id);
      if (staleIndex !== -1) {
        this.platform.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [this.platform.accessories[staleIndex]]);
        this.platform.accessories.splice(staleIndex, 1);
      }
      return { accessory: new this.platform.api.platformAccessory(displayName, id), isNew: true };
    }

    const existing = this.platform.accessories.find((acc) => acc.UUID === id);
    if (existing) {
      // Converge cached accessories on the freshly sanitized name (older entries
      // may hold names with characters HAP rejects).
      existing.displayName = displayName;
      return { accessory: existing, isNew: false };
    }
    const accessory = new this.platform.api.platformAccessory(displayName, id);
    this.platform.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.platform.accessories.push(accessory);
    return { accessory, isNew: true };
  }

  private updateAccessoryInformation(accessory: PlatformAccessory, room: string, serialNumber: string, displayName: string): void {
    const info = accessory.getService(this.platform.Service.AccessoryInformation);
    if (!info) {
      return;
    }
    info
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Loxone')
      .setCharacteristic(this.platform.Characteristic.Model, room)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, serialNumber)
      .setCharacteristic(this.platform.Characteristic.Name, displayName);
  }

  /** Builds the planned service(s) on the accessory, binds each, prunes the rest. */
  private applyBindings(accessory: PlatformAccessory, planned: PlannedAccessory): () => void {
    const bindings = planned.services;
    const disposers: Array<() => void> = [];
    const kept = new Set<Service>();

    for (const binding of bindings) {
      const service = this.resolveService(accessory, binding);
      kept.add(service);
      // Multiple services on one accessory are distinguished by ConfiguredName.
      // (No ServiceLabel — that makes HomeKit render the tile as a numbered button
      // group, which is wrong for e.g. mood/radio switches.)
      if (bindings.length > 1 && binding.name) {
        this.nameService(service, binding.name);
      }
      disposers.push(binding.bindTo(service));
    }

    // Imperative escape hatch (e.g. the intercom camera/HKSV controller, which
    // adds its own services outside the declarative model).
    if (planned.bindAccessory) {
      disposers.push(planned.bindAccessory(accessory));
    }

    // Accessories that add services outside the plan (cameras) opt out of pruning.
    if (planned.prune !== false) {
      this.pruneOtherServices(accessory, kept);
    }
    return () => disposers.forEach((dispose) => dispose());
  }

  /** Resolves (creating if needed) the HomeKit service for a binding, by subtype when present. */
  private resolveService(accessory: PlatformAccessory, binding: ServiceBinding): Service {
    if (binding.subtype !== undefined) {
      // Providing the (displayName, subtype) ctor args satisfies the typed overload;
      // at runtime hap `new`s the concrete service subclass with those args.
      const serviceName = (binding.name && sanitizeName(binding.name)) || accessory.displayName;
      return (
        accessory.getServiceById(binding.kind, binding.subtype) ??
        accessory.addService(binding.kind, serviceName, binding.subtype)
      );
    }
    // hap's addService `new`s a bare constructor at runtime; the typed overload would
    // demand the abstract base ctor args, so route through the instance overload.
    return accessory.getService(binding.kind) ?? accessory.addService(binding.kind as unknown as Service);
  }

  private nameService(service: Service, name: string): void {
    const safe = sanitizeName(name);
    if (!safe) {
      return; // all-symbol name — leave HAP's default rather than set an invalid one
    }
    service.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
    service.setCharacteristic(this.platform.Characteristic.ConfiguredName, safe);
    service.setCharacteristic(this.platform.Characteristic.Name, safe);
  }

  /** Removes every accessory not produced in this rebuild — from both the main bridge and the room bridges. */
  private prune(seen: Set<string>): void {
    // Main-bridge accessories no longer present (incl. stale ones from older versions).
    for (const accessory of [...this.platform.accessories]) {
      if (seen.has(accessory.UUID)) {
        continue;
      }
      this.disposers.get(accessory.UUID)?.();
      this.disposers.delete(accessory.UUID);
      const index = this.platform.accessories.findIndex((acc) => acc.UUID === accessory.UUID);
      if (index !== -1) {
        this.platform.accessories.splice(index, 1);
      }
      this.platform.log.info(`[BindingEngine] Removing accessory no longer present: ${accessory.displayName}`);
      this.platform.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
    // Room-bridge accessories no longer present.
    for (const accessory of this.publisher.prune(seen)) {
      this.disposers.get(accessory.UUID)?.();
      this.disposers.delete(accessory.UUID);
      this.platform.log.info(`[BindingEngine] Removing accessory no longer present: ${accessory.displayName}`);
    }
  }

  /** Keeps the bound service(s) on an accessory; removes the rest (incl. a stale ServiceLabel from older builds). */
  private pruneOtherServices(accessory: PlatformAccessory, kept: Set<Service>): void {
    const accessoryInfo = this.platform.Service.AccessoryInformation.UUID;
    for (const service of [...accessory.services]) {
      if (kept.has(service) || service.UUID === accessoryInfo) {
        continue;
      }
      accessory.removeService(service);
    }
  }

  private buildHost(): string {
    const { host, port } = this.platform.config;
    if (!port || String(host).includes(':')) {
      return String(host);
    }
    return `${host}:${port}`;
  }

  /** Bridges loxone-ts-client's Logger onto Homebridge's logger (lib info → debug to keep the log quiet). */
  private loxoneLogger(): LoxoneLogger {
    const log = this.platform.log;
    return {
      trace: (message) => log.debug(message),
      debug: (message) => log.debug(message),
      info: (message) => log.debug(message),
      warn: (message) => log.warn(message),
      error: (message) => log.error(message),
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
