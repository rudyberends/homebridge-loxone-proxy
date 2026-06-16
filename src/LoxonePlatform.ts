import {
  API,
  APIEvent,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { AccessoryNameRegistry } from './AccessoryNameRegistry';
import { LoxoneBindingCoordinator } from './binding/LoxoneBindingCoordinator';

/**
 * LoxonePlatform — the Homebridge dynamic platform. It connects to the Miniserver
 * via loxone-ts-client (the {@link LoxoneBindingCoordinator}) and exposes every
 * control to HomeKit through the binding engine. The reconciler and name registry
 * are the only remaining HomeKit-side glue.
 */
export class LoxonePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public readonly accessories: PlatformAccessory[] = [];

  private readonly nameRegistry: AccessoryNameRegistry;
  private readonly bindingCoordinator: LoxoneBindingCoordinator;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.nameRegistry = new AccessoryNameRegistry();
    this.bindingCoordinator = new LoxoneBindingCoordinator(this);

    this.api.on('didFinishLaunching', () => {
      void this.bindingCoordinator.start();
    });

    // Release the Miniserver connection (websocket, keep-alive timers) on shutdown.
    this.api.on(APIEvent.SHUTDOWN, () => {
      void this.bindingCoordinator.stop();
    });
  }

  /** Homebridge restores cached accessories through this on startup. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug('Loaded from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  /** Clean + unique + HAP-safe + UUID-stable name builder. */
  generateUniqueName(room: string, base: string, uuid?: string, isSubItem = false): string {
    return this.nameRegistry.generate(room, base, uuid, isSubItem);
  }

  /** The active Miniserver communication token (used by intercom talkback). */
  getCommunicationToken(): string | undefined {
    return this.bindingCoordinator.token;
  }

  /** Miniserver temperature display unit (0 = Celsius, 1 = Fahrenheit), for the thermostat binding. */
  getTemperatureDisplayUnit(): number {
    return this.bindingCoordinator.temperatureUnit;
  }
}
