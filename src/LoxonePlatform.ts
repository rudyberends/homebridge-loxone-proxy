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
    this.usedNames.clear();
    this.accessoryNameMap.clear();

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

  configureAccessory(acc: PlatformAccessory): void {
    this.log.debug('Loaded from cache:', acc.displayName);
    this.accessories.push(acc);
  }

  /**
   * Clean + unique + HAP-safe + UUID-stable name builder
   */
  generateUniqueName(
    room: string,
    base: string,
    uuid?: string,
    isSubItem = false,
  ): string {

    // --- Sanitizer: keep inner text of parentheses, drop parentheses only ---
    const clean = (s: string) =>
      s
        .replace(/\((.*?)\)/g, '$1')                // "(MH06)" → "MH06"
        .replace(/[^\p{L}\p{N}\s']/gu, '')          // allowed: letters, digits, space, apostrophe
        .replace(/\s+/g, ' ')                       // collapse spaces
        .trim();

    const cleanRoom = clean(room || 'Unknown');
    const cleanBase = clean(base || 'Unnamed');

    // --- Ensure no duplicate prefix ---
    const alreadyPrefixed =
    cleanBase.toLowerCase().startsWith(cleanRoom.toLowerCase()) ||
    cleanBase.toLowerCase().startsWith(cleanRoom.toLowerCase() + ' ');

    const baseName = alreadyPrefixed
      ? cleanBase
      : `${cleanRoom} ${cleanBase}`;

    // --- SUBITEMS NEVER GET SUFFIXES ---
    if (isSubItem) {
      return baseName;
    }

    // --- ACCESSORY: ensure global unique name ---
    // reuse existing mapping if UUID exists
    if (uuid && this.accessoryNameMap.has(uuid)) {
      return this.accessoryNameMap.get(uuid)!;
    }

    let finalName = baseName;
    let counter = 1;

    while (this.usedNames.has(finalName)) {
      finalName = `${baseName} ${counter++}`;
    }

    this.usedNames.add(finalName);

    // store stable mapping
    if (uuid) {
      this.accessoryNameMap.set(uuid, finalName);
    }

    return finalName;
  }
}