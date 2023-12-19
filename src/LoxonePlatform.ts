import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
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
  public readonly accessories: PlatformAccessory[] = []; // this is used to track restored cached accessories

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
   * Establishes a WebSocket connection to the Loxone Miniserver and retrieves the structure file.
   */
  async LoxoneInit(): Promise<void> {
    this.LoxoneHandler = new LoxoneHandler(this);
    await this.waitForLoxoneConfig();
    this.log.debug(`[LoxoneInit] Got Structure File; Last modified on ${this.LoxoneHandler.loxdata.lastModified}`);
    this.parseLoxoneConfig(this.LoxoneHandler.loxdata);
  }

  /**
   * Waits for the Loxone configuration to be retrieved.
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
   * Parses the Loxone Structure File and collects a list of rooms, categories, and items.
   */
  parseLoxoneConfig(config: StructureFile): void {
    this.msInfo = config.msInfo;
    const LoxoneRooms: Record<string, Room> = { ...config.rooms };
    const LoxoneCats: Record<string, CatValue> = { ...config.cats };
    this.LoxoneItems = { ...config.controls };

    for (const uuid in this.LoxoneItems) {
      const Item = this.LoxoneItems[uuid];
      Item.room = LoxoneRooms[Item.room]?.name || 'undefined';
      Item.cat = LoxoneCats[Item.cat]?.type || 'undefined';
    }

    this.mapLoxoneItems(Object.values(this.LoxoneItems));
    this.removeUnmappedAccessories();
  }

  /**
   * Maps all Loxone items to their corresponding HomeKit accessories.
   */
  async mapLoxoneItems(items: Control[]): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itemCache: { [key: string]: any } = {}; // Cache object to store imported item files

    const ExcludedItems = this.config.Exclusions?.Exclusions?.split(',') ?? [];

    for (const item of items) {
      try {
        const itemType = item.type;

        if (ExcludedItems.includes(itemType)) {
          this.log.debug(`[mapLoxoneItem] Skipping Excluded ItemType: ${item.name} with type ${item.type}`);
        } else {

          if (!itemCache[itemType]) {  // Check if the item file has already been imported
            const itemFile = await import(`./loxone/items/${itemType}`);
            itemCache[itemType] = itemFile;
          }

          const itemFile = itemCache[itemType];
          const constructorName = Object.keys(itemFile)[0];
          new itemFile[constructorName](this, item);
        }
      } catch (error) {
        //console.log(error);
        this.log.debug(`[mapLoxoneItem] Skipping Unsupported ItemType: ${item.name} with type ${item.type}`);
      }
    }
  }

  /**
   * Removes cached accessories that are no longer present in the Loxone system.
   */
  removeUnmappedAccessories(): void {
    setTimeout(() => {
      this.accessories.forEach((accessory: PlatformAccessory) => {
        if (!accessory.context.mapped) {
          this.log.debug('Remove accessory: ', accessory.displayName);
          this.api.unregisterPlatformAccessories('homebridge-loxone-proxy', 'LoxonePlatform', [accessory]);
        }
      });
    }, 5000); // Delay this function for 5 seconds. Wait for all Accessories to map.
  }

  /**
   * Called when Homebridge restores cached accessories from disk at startup.
   * Sets up event handlers for characteristics and updates values.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug('Loading accessory from cache:', accessory.displayName);
    accessory.context.mapped = false; // To enable the removal of cached accessories removed from Loxone
    this.accessories.push(accessory);
  }
}