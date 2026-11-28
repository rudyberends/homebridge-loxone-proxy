import { AccessoryNameRegistry } from './AccessoryNameRegistry';
import { LoxoneBindingCoordinator } from './binding/LoxoneBindingCoordinator';
import type { Hap, HomeKitHost, HostLogger, LoxoneHomeKitConfig } from './HomeKitHost';

/**
 * The Loxone ⇄ HomeKit core: connects to the Miniserver via loxone-ts-client (the
 * {@link LoxoneBindingCoordinator}) and exposes every control to HomeKit through the
 * binding engine. It knows nothing of Homebridge: whoever runs it provides a
 * {@link HomeKitHost} (HAP, log, config, storage, the main bridge's accessories).
 */
export class LoxoneHomeKit {
  public readonly hap: Hap;
  public readonly Service: Hap['Service'];
  public readonly Characteristic: Hap['Characteristic'];
  public readonly log: HostLogger;
  public readonly config: LoxoneHomeKitConfig;

  private readonly nameRegistry = new AccessoryNameRegistry();
  private readonly bindingCoordinator: LoxoneBindingCoordinator;

  constructor(public readonly host: HomeKitHost) {
    this.hap = host.hap;
    this.Service = host.hap.Service;
    this.Characteristic = host.hap.Characteristic;
    this.log = host.log;
    this.config = host.config;
    this.bindingCoordinator = new LoxoneBindingCoordinator(this);
  }

  /** Connects to the Miniserver and binds every control (call once the host's cache is restored). */
  start(): Promise<void> {
    return this.bindingCoordinator.start();
  }

  /** Releases the Miniserver connection (websocket, keep-alive timers) and the room bridges. */
  stop(): Promise<void> {
    return this.bindingCoordinator.stop();
  }

  /** Clean + unique + HAP-safe + UUID-stable name builder. */
  generateUniqueName(room: string, base: string, uuid?: string, isSubItem = false, prefixRoom = true): string {
    return this.nameRegistry.generate(room, base, uuid, isSubItem, prefixRoom);
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
