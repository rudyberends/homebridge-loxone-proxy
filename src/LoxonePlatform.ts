import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import { StructureFile, Controls, MSInfo, Control, Room, CatValue } from './loxone/StructureFile';
import LoxoneHandler from './loxone/LoxoneHandler';

/**
 * LoxonePlatform
 * This class is the main constructor for the plugin.
 */
export class LoxonePlatform implements DynamicPlatformPlugin {
  public LoxoneHandler;
  public AccessoryCount = 1;
  public msInfo: MSInfo = {} as MSInfo;
  public LoxoneItems: Controls = {} as Controls;
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly accessories: PlatformAccessory[] = []; // restored cached accessories
  public mappedAccessories = new Set<string>();          // tracking of mapped UUIDs
  private usedNames = new Set<string>();                 // ensures global uniqueness
  private accessoryNameMap: Map<string, string> = new Map(); // uuid → assigned name

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
   * Initializes the Loxone system and starts accessory mapping
   */
  async LoxoneInit(): Promise<void> {
    // Reset name tracking before new session
    this.usedNames.clear();
    this.accessoryNameMap.clear();

    this.LoxoneHandler = new LoxoneHandler(this);
    await this.waitForLoxoneConfig();
    this.log.debug(`[LoxoneInit] Got Structure File; Last modified on ${this.LoxoneHandler.loxdata.lastModified}`);
    this.parseLoxoneConfig(this.LoxoneHandler.loxdata);
    this.log.info('[LoxoneInit] Loxone Platform initialized successfully');
  }

  /**
   * Waits until the structure file is received from Loxone
   */
  waitForLoxoneConfig(): Promise<void> {
    return new Promise<void>((resolve) => {
      const waitInterval = setInterval(() => {
        if (this.LoxoneHandler.loxdata) {
          clearInterval(waitInterval);
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * Parses the structure file and begins item mapping
   */
  parseLoxoneConfig(config: StructureFile): void {
    this.msInfo = config.msInfo;
    const LoxoneRooms: Record<string, Room> = { ...config.rooms };
    const LoxoneCats: Record<string, CatValue> = { ...config.cats };
    this.LoxoneItems = { ...config.controls };

    for (const uuid in this.LoxoneItems) {
      const Item = this.LoxoneItems[uuid];
      Item.room = LoxoneRooms[Item.room]?.name || 'undefined';
      Item.catIcon = LoxoneCats[Item.cat]?.image || 'undefined';
      Item.cat = LoxoneCats[Item.cat]?.type || 'undefined';
    }

    this.mapLoxoneItems(Object.values(this.LoxoneItems)).then(() => {
      this.removeUnmappedAccessories();
    });
  }

  /**
   * Maps all Loxone items to their HomeKit accessories
   */
  async mapLoxoneItems(items: Control[]): Promise<void> {
    // Reset name tracking for the new mapping cycle
    this.usedNames.clear();
    this.accessoryNameMap.clear();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itemCache: { [key: string]: any } = {};

    const ExcludedItemTypes = this.config.Exclusions?.split(',') ?? [];
    const RoomFilterList = this.config.roomfilter?.list?.split(',') ?? [];
    const RoomFilterType = this.config.roomfilter?.type || 'exclusion';

    for (const item of items) {
      try {
        const itemType = item.type;

        this.log.debug(`[mapLoxoneItems] ${item.name} UUID: ${item.uuidAction}`);

        const isRoomExcluded =
          (RoomFilterType.toLowerCase() === 'exclusion' && RoomFilterList.includes(item.room.toLowerCase())) ||
          (RoomFilterType.toLowerCase() === 'inclusion' && !RoomFilterList.includes(item.room.toLowerCase()));

        if (isRoomExcluded) {
          this.log.debug(`[mapLoxoneItem][RoomExclusion] Skipping Excluded Room: ${item.name} in room ${item.room}`);
        } else if (ExcludedItemTypes.includes(itemType)) {
          this.log.debug(`[mapLoxoneItem][ItemTypeExclusion] Skipping Excluded ItemType: ${item.name} with type ${item.type}`);
        } else {
          if (!itemCache[itemType]) {
            const itemFile = await import(`./loxone/items/${itemType}`);
            itemCache[itemType] = itemFile;
          }

          const itemFile = itemCache[itemType];
          const constructorName = Object.keys(itemFile)[0];
          new itemFile[constructorName](this, item);
        }
      } catch (error) {
        this.log.debug(error instanceof Error ? error.message : String(error));
        this.log.info(`[mapLoxoneItem] Skipping Unsupported ItemType: ${item.name} with type ${item.type}`);
      }
    }
  }

  /**
   * Removes Homebridge-cached accessories that were not re-mapped during this session.
   */
  removeUnmappedAccessories(): void {
    const pluginName = 'homebridge-loxone-proxy';
    const platformName = 'LoxonePlatform';

    this.accessories.forEach((accessory: PlatformAccessory) => {
      if (!this.mappedAccessories.has(accessory.UUID)) {
        this.log.info('[RemoveAccessory] Removing unused accessory:', accessory.displayName);
        this.api.unregisterPlatformAccessories(pluginName, platformName, [accessory]);
      } else {
        this.log.debug('[RemoveAccessory] Keeping mapped accessory:', accessory.displayName);
      }
    });

    this.mappedAccessories.clear(); // Reset after cleanup
  }

  /**
   * Called at Homebridge startup to restore cached accessories
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);

    // Zorg dat deze naam niet nogmaals gebruikt wordt
    this.usedNames.add(accessory.displayName);
  }

  /**
   * Generates unique, HomeKit-safe accessory names.
   */
  generateUniqueName(room: string, base: string, uuid?: string): string {
    // If already assigned for this uuid → reuse
    if (uuid && this.accessoryNameMap.has(uuid)) {
      return this.accessoryNameMap.get(uuid)!;
    }

    const clean = (s: string) =>
      s
        .replace(/\(.*?\)/g, '')                // remove parenthesis content
        .replace(/[^\p{L}\p{N}\s']/gu, '')      // letters, numbers, spaces, apostrophes only
        .replace(/\s+/g, ' ')
        .trim();

    const cleanRoom = clean(room || 'Unknown');
    const cleanBase = clean(base || 'Unnamed');
    const baseName = `${cleanRoom} ${cleanBase}`.trim();

    // Find unique name
    let finalName = baseName;
    let counter = 1;

    while (this.usedNames.has(finalName)) {
      finalName = `${baseName} ${counter++}`;
    }

    // Reserve this name
    this.usedNames.add(finalName);

    if (uuid) {
      this.accessoryNameMap.set(uuid, finalName);
    }

    return finalName;
  }
}