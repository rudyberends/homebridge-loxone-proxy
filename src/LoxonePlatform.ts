import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { StructureFile, Controls, MSInfo, Control } from './loxone/StructureFile';
import LoxoneHandler from './loxone/LoxoneHandler';

/**
 * LoxonePlatform
 * This class is the main constructor for the plugin.
 */
export class LoxonePlatform implements DynamicPlatformPlugin {

  private LoxoneRooms = {}; // Contains List of configured rooms
  private LoxoneCats = {}; // Contains List of configured Cats
  private LoxoneItems: Controls = {}; // Contains List of all Items

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public LoxoneHandler: any;
  public AccessoryCount = 1;
  public msInfo = {} as MSInfo;
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly accessories: PlatformAccessory[] = [];  // this is used to track restored cached accessories

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.api.on('didFinishLaunching', () => this.LoxoneInit());
  }

  /**
   * This function creates a websocket connection to the Loxone miniserver and
   * awaits retrieval of the structure file
   */
  async LoxoneInit(): Promise<void> {

    this.LoxoneHandler = new LoxoneHandler(this);  // New Miniserver websocket

    while (!this.LoxoneHandler.loxdata) {  // Wait for configfile. (LoxAPP3.json)
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    this.log.debug(`[LoxoneInit] Got Structure File; Last modified on ${this.LoxoneHandler.loxdata.lastModified}`);
    this.parseLoxoneConfig(this.LoxoneHandler.loxdata);
  }

  /**
   * This function parses The Loxone Structure File and collects a list of
   * Rooms, Categories, and Items.
   */
  parseLoxoneConfig(config: StructureFile): void {

    this.msInfo = config.msInfo; // MSinfo

    for (const RoomUuid in config.rooms) { // Parse Loxone Rooms
      this.LoxoneRooms[RoomUuid] = config.rooms[RoomUuid].name;
    }

    for (const CatUuid in config.cats) { // Parse Loxone Cats
      this.LoxoneCats[CatUuid] = config.cats[CatUuid].type;
    }

    for (const ItemUuid in config.controls) { // Loxone Items
      const LoxoneItem = config.controls[ItemUuid];
      this.LoxoneItems[ItemUuid] = LoxoneItem;
      this.LoxoneItems[ItemUuid].room = this.LoxoneRooms[LoxoneItem.room];
      this.LoxoneItems[ItemUuid].cat = this.LoxoneCats[LoxoneItem.cat];
    }
    this.mapLoxoneItems(this.LoxoneItems); // Map all discovered Loxone Items
    this.removeUnmappedAccessories(); // Remove Cached Items which are removed from Loxone
  }

  /**
   * This function maps all Loxone Items.
   */
  mapLoxoneItems(LoxoneItems: Controls) : void {
    for (const uuid in LoxoneItems) {
      const Item: Control = LoxoneItems[uuid];
      import(`./loxone/items/${Item.type}`)
        .then((itemFile) => {
          const constructorName = Object.keys(itemFile)[0];
          new itemFile[constructorName](this, Item);
        })
        .catch(() => {
          this.log.debug(`[mapLoxoneItem] Skipping Unsupported ItemType: ${Item.name} with type ${Item.type}`);
        });
    }
  }

  /**
   * This function Removes Cached Accessories when they are removed from Loxone.
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
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug('Loading accessory from cache:', accessory.displayName);
    accessory.context.mapped = false; // To enable the removal of cached accessories removed from Loxone
    this.accessories.push(accessory);
  }
}