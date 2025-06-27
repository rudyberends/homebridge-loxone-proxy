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
  private mappedAccessories = new Set<string>(); // tracking of mapped UUIDs

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.api.on('didFinishLaunching', async () => {
      await this.LoxoneInit();
    });
  }

  async LoxoneInit(): Promise<void> {
    this.LoxoneHandler = new LoxoneHandler(this);
    await this.waitForLoxoneConfig();
    this.log.debug(`[LoxoneInit] Got Structure File; Last modified on ${this.LoxoneHandler.loxdata.lastModified}`);
    this.parseLoxoneConfig(this.LoxoneHandler.loxdata);
  }

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

  async mapLoxoneItems(items: Control[]): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itemCache: { [key: string]: any } = {};

    const ExcludedItemTypes = this.config.Exclusions?.split(',') ?? [];
    const RoomFilterList = this.config.roomfilter?.list?.split(',') ?? [];
    const RoomFilterType = this.config.roomfilter?.type || 'exclusion';

    for (const item of items) {
      try {
        const itemType = item.type;

        const isRoomExluded =
          (RoomFilterType.toLowerCase() === 'exclusion' && RoomFilterList.includes(item.room.toLowerCase())) ||
          (RoomFilterType.toLowerCase() === 'inclusion' && !RoomFilterList.includes(item.room.toLowerCase()));

        if (isRoomExluded) {
          this.log.debug(`[mapLoxoneItem][RoomExlusion] Skipping Excluded Room: ${item.name} in room ${item.room}`);
        } else if (ExcludedItemTypes.includes(itemType)) {
          this.log.debug(`[mapLoxoneItem][ItemTypeExlusion] Skipping Excluded ItemType: ${item.name} with type ${item.type}`);
        } else {
          if (!itemCache[itemType]) {
            const itemFile = await import(`./loxone/items/${itemType}`);
            itemCache[itemType] = itemFile;
          }

          const uuid = this.api.hap.uuid.generate(item.uuidAction); // <-- consistent UUID
          this.mappedAccessories.add(uuid); // <-- ✅ mark as still in use

          const itemFile = itemCache[itemType];
          const constructorName = Object.keys(itemFile)[0];
          new itemFile[constructorName](this, item);
        }
      } catch (error) {
        this.log.debug(`[mapLoxoneItem] Skipping Unsupported ItemType: ${item.name} with type ${item.type}`);
      }
    }
  }

  /**
   * Removes cached accessories that are no longer mapped.
   */
  removeUnmappedAccessories(): void {
    const pluginName = 'homebridge-loxone-proxy';
    const platformName = 'LoxonePlatform';

    this.accessories.forEach((accessory: PlatformAccessory) => {
      if (!this.mappedAccessories.has(accessory.UUID)) {
        this.log.debug('[RemoveAccessory] Removing unused accessory:', accessory.displayName);
        this.api.unregisterPlatformAccessories(pluginName, platformName, [accessory]);
      } else {
        this.log.debug('[RemoveAccessory] Keeping mapped accessory:', accessory.displayName);
      }
    });

    this.mappedAccessories.clear(); // reset for next run
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }
}
