import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import {
  StructureFile,
  Controls,
  MSInfo,
  Control,
  Room,
  CatValue,
} from './loxone/StructureFile';

import LoxoneHandler from './loxone/LoxoneHandler';

/**
 * LoxonePlatform
 * Main plugin class
 */
export class LoxonePlatform implements DynamicPlatformPlugin {
  public LoxoneHandler;
  public AccessoryCount = 1;
  public msInfo: MSInfo = {} as MSInfo;
  public LoxoneItems: Controls = {} as Controls;

  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  public mappedAccessories = new Set<string>();

  /** Track globally used names to prevent duplicates */
  private usedNames = new Set<string>();

  /** Map UUID → chosen unique stable name */
  private accessoryNameMap: Map<string, string> = new Map();

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.api.on('didFinishLaunching', async () => {
      await this.LoxoneInit();
    });
  }

  /**
   * Initial startup
   */
  async LoxoneInit(): Promise<void> {
    // Reset name tracking before new session
    this.displayNameCount = {};

    this.LoxoneHandler = new LoxoneHandler(this);

    await this.waitForLoxoneConfig();
    this.log.debug(
      `[LoxoneInit] Got Structure File; Modified: ${this.LoxoneHandler.loxdata.lastModified}`,
    );

    this.parseLoxoneConfig(this.LoxoneHandler.loxdata);
    this.log.info('[LoxoneInit] Loxone Platform initialized');
  }

  waitForLoxoneConfig(): Promise<void> {
    return new Promise((resolve) => {
      const i = setInterval(() => {
        if (this.LoxoneHandler.loxdata) {
          clearInterval(i);
          resolve();
        }
      }, 500);
    });
  }

  /**
   * Parse structure file
   */
  parseLoxoneConfig(config: StructureFile): void {
    this.msInfo = config.msInfo;

    const rooms: Record<string, Room> = { ...config.rooms };
    const cats: Record<string, CatValue> = { ...config.cats };

    this.LoxoneItems = { ...config.controls };

    for (const uuid in this.LoxoneItems) {
      const item = this.LoxoneItems[uuid];

      item.room = rooms[item.room]?.name ?? 'undefined';
      item.catIcon = cats[item.cat]?.image ?? 'undefined';
      item.cat = cats[item.cat]?.type ?? 'undefined';
    }

    this.mapLoxoneItems(Object.values(this.LoxoneItems)).then(() => {
      this.removeUnmappedAccessories();
    });
  }

  /**
   * Map items → accessories
   */
  async mapLoxoneItems(items: Control[]): Promise<void> {
    // Reset unique name counters before each mapping run
    this.displayNameCount = {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache: Record<string, any> = {};

    const excludedTypes = this.config.Exclusions?.split(',') ?? [];
    const roomFilterList = this.config.roomfilter?.list?.split(',') ?? [];
    const roomFilterType = this.config.roomfilter?.type || 'exclusion';

    for (const item of items) {
      try {
        const type = item.type;

        const roomExcluded =
          (roomFilterType === 'exclusion' && roomFilterList.includes(item.room.toLowerCase())) ||
          (roomFilterType === 'inclusion' && !roomFilterList.includes(item.room.toLowerCase()));

        if (roomExcluded) {
          continue;
        }

        if (excludedTypes.includes(type)) {
          continue;
        }

        if (!cache[type]) {
          cache[type] = await import(`./loxone/items/${type}`);
        }

        const file = cache[type];
        const constructorName = Object.keys(file)[0];

        new file[constructorName](this, item);
      } catch {
        this.log.info(`[mapLoxoneItem] Unsupported item type: ${item.name} → ${item.type}`);
      }
    }
  }

  /**
   * Remove unused cached accessories
   */
  removeUnmappedAccessories(): void {
    const plugin = 'homebridge-loxone-proxy';
    const platform = 'LoxonePlatform';

    this.accessories.forEach((acc) => {
      if (!this.mappedAccessories.has(acc.UUID)) {
        this.log.info('[RemoveAccessory] Removing unused accessory:', acc.displayName);
        this.api.unregisterPlatformAccessories(plugin, platform, [acc]);
      }
    });

    this.mappedAccessories.clear();
  }

  /**
   * Called at Homebridge startup to restore cached accessories
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);

    // Reset name tracking if needed when cache restores first
    if (!Object.keys(this.displayNameCount).length) {
      this.displayNameCount = {};
    }
  }

  /**
   * Sanitizes names for HomeKit compatibility.
   */
  public sanitizeName(name: string): string {
    return name
      .replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, '') // remove emoji / non-printable
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 64); // enforce HomeKit limit
  }

  /**
   * Generates unique, HomeKit-safe accessory names.
   */
  public generateUniqueName(room: string, base: string): string {
    const sanitizedRoom = this.sanitizeName(room || 'Unknown');
    const sanitizedBase = this.sanitizeName(base || 'Unnamed');

    // avoid double prefix
    const alreadyPrefixed = sanitizedBase.toLowerCase().startsWith(sanitizedRoom.toLowerCase());
    const fullBase = alreadyPrefixed ? sanitizedBase : `${sanitizedRoom} ${sanitizedBase}`;
    let finalName = fullBase;

    if (this.displayNameCount[fullBase] !== undefined) {
      this.displayNameCount[fullBase]++;
      finalName = `${fullBase}_${this.displayNameCount[fullBase]}`;
    } else {
      this.displayNameCount[fullBase] = 0;
    }

    return finalName;
  }
}