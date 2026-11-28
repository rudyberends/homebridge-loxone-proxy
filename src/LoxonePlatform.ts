import { API, APIEvent, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import type { Accessory } from 'hap-nodejs';

import type { AccessoryStore, HomeKitAccessory, HomeKitHost } from './HomeKitHost';
import { LoxoneHomeKit } from './LoxoneHomeKit';

const PLUGIN_NAME = 'homebridge-loxone-proxy';
const PLATFORM_NAME = 'LoxonePlatform';

/**
 * LoxonePlatform — the Homebridge dynamic platform. A thin host around the
 * {@link LoxoneHomeKit} core: it hands the core Homebridge's HAP, log, config and
 * storage, and keeps the main bridge's accessories in Homebridge's cache.
 */
export class LoxonePlatform implements DynamicPlatformPlugin {
  public readonly accessories: PlatformAccessory[] = [];
  private readonly homekit: LoxoneHomeKit;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.homekit = new LoxoneHomeKit(this.host());

    this.api.on('didFinishLaunching', () => {
      void this.homekit.start();
    });

    // Release the Miniserver connection (websocket, keep-alive timers) on shutdown.
    this.api.on(APIEvent.SHUTDOWN, () => {
      void this.homekit.stop();
    });
  }

  /** Homebridge restores cached accessories through this on startup. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug('Loaded from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  private host(): HomeKitHost {
    const api = this.api;
    const cached = this.accessories;
    const accessories: AccessoryStore = {
      all: () => cached,
      create: (displayName, uuid) => new api.platformAccessory(displayName, uuid),
      register: (accessory) => {
        api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory as PlatformAccessory]);
        cached.push(accessory as PlatformAccessory);
      },
      unregister: (accessory) => {
        const index = cached.findIndex((acc) => acc.UUID === accessory.UUID);
        if (index !== -1) {
          cached.splice(index, 1);
        }
        api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory as PlatformAccessory]);
      },
      // Homebridge wraps a hap-nodejs Accessory; that's what a Bridge bridges.
      hapAccessory: (accessory: HomeKitAccessory) =>
        (accessory as unknown as { _associatedHAPAccessory: Accessory })._associatedHAPAccessory,
    };
    return {
      hap: api.hap,
      log: this.log,
      config: this.config,
      storagePath: api.user.storagePath(),
      accessories,
      onShutdown: (listener) => {
        api.on(APIEvent.SHUTDOWN, listener);
      },
    };
  }
}
