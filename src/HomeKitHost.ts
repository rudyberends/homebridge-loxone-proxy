import type { Accessory } from 'hap-nodejs';

/**
 * The HAP library as the host provides it at runtime. Homebridge hands its own copy
 * (`api.hap`); a standalone host passes `require('hap-nodejs')`. The core never imports
 * hap-nodejs values itself, so services and characteristics always come from the
 * host's instance.
 */
export type Hap = typeof import('hap-nodejs');

/** The log the core writes to (Homebridge's `Logger` fits). */
export interface HostLogger {
  debug(message: string, ...parameters: unknown[]): void;
  info(message: string, ...parameters: unknown[]): void;
  warn(message: string, ...parameters: unknown[]): void;
  error(message: string, ...parameters: unknown[]): void;
}

/**
 * The plugin's settings: the Miniserver connection plus the optional mapping, room and
 * HKSV options (see config.schema.json). Loosely typed, as the host reads it from JSON.
 */
export interface LoxoneHomeKitConfig {
  host?: string;
  port?: number | string;
  username?: string;
  password?: string;
  TLS?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * An accessory as the core uses it: a hap-nodejs accessory plus a `context` the host
 * persists with it (Homebridge's `PlatformAccessory` fits).
 */
export type HomeKitAccessory = Pick<
  Accessory,
  'UUID' | 'displayName' | 'services' | 'getService' | 'getServiceById' | 'addService' | 'removeService' | 'configureController'
> & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: Record<string, any>;
};

/** The accessories on the host's main bridge, restored from its cache on start. */
export interface AccessoryStore {
  /** Every accessory currently on the main bridge (cached or registered since). */
  all(): readonly HomeKitAccessory[];
  /** A new accessory, not yet on any bridge. */
  create(displayName: string, uuid: string): HomeKitAccessory;
  /** Puts an accessory on the main bridge. */
  register(accessory: HomeKitAccessory): void;
  /** Takes an accessory off the main bridge (and out of the cache). */
  unregister(accessory: HomeKitAccessory): void;
  /** The hap-nodejs accessory behind one, for bridging it on a room bridge. */
  hapAccessory(accessory: HomeKitAccessory): Accessory;
}

/**
 * Everything the Loxone ⇄ HomeKit core needs from whoever runs it: Homebridge (the
 * plugin) or a standalone process that publishes its own HAP bridge.
 */
export interface HomeKitHost {
  readonly hap: Hap;
  readonly log: HostLogger;
  readonly config: LoxoneHomeKitConfig;
  /** A directory the core may write files to (the room-bridge pairing manifest). */
  readonly storagePath: string;
  readonly accessories: AccessoryStore;
  /** Calls `listener` once when the host shuts down. */
  onShutdown(listener: () => void): void;
}
