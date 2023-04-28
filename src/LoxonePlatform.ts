import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import LoxoneHandler from './lib/LoxoneHandler';
import { LoxoneAccessory } from './LoxoneAccessory';
import { StructureFile, Controls, Control } from './structure/LoxAPP3';

export class LoxonePlatform implements DynamicPlatformPlugin {

  private LoxoneRooms = {};
  private LoxoneCats = {};
  private LoxoneItems: Controls = {};
  private LoxoneIntercomMotion = '';

  // Items supported by this Platform
  private SupportedItems = [
    'Alarm',
    'Brightness',
    'Dimmer',
    'Gate',
    'Humidity',
    'IntercomV2',
    'IRoomControllerV2',
    'Lock',
    'MoodSwitch',
    'Motion',
    'PresenceDetector',
    'Switch',
    'Ventilation',
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public LoxoneHandler: any;
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

  async LoxoneInit() {
    this.log.info('Initializing Loxone Connection');

    // New Miniserver websocket
    this.LoxoneHandler = new LoxoneHandler(this);

    // Wait for configfile. (LoxAPP3.json)
    while (!this.LoxoneHandler.loxdata) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    this.log.info(`[LoxoneInit] got structure file; last modified on ${this.LoxoneHandler.loxdata.lastModified}`);
    this.parseLoxoneConfig(this.LoxoneHandler.loxdata);
  }

  async parseLoxoneConfig(config: StructureFile) {

    // Loxone Rooms
    for (const RoomUuid in config.rooms) {
      this.LoxoneRooms[RoomUuid] = config.rooms[RoomUuid].name;
    }

    // Loxone Cats
    for (const CatUuid in config.cats) {
      this.LoxoneCats[CatUuid] = config.cats[CatUuid].type;
    }

    // Loxone Items
    for (const ItemUuid in config.controls) {

      const LoxoneItem = config.controls[ItemUuid];

      if (LoxoneItem.type === 'LightControllerV2') {
        this.parseLoxoneLightController(LoxoneItem);
      } else {
        this.LoxoneItems[ItemUuid] = LoxoneItem;
        this.LoxoneItems[ItemUuid].room = this.LoxoneRooms[LoxoneItem.room];
        this.LoxoneItems[ItemUuid].cat = this.LoxoneCats[LoxoneItem.cat];
        this.LoxoneItems[ItemUuid].type = this.checkLoxoneType(LoxoneItem);
      }
    }
    this.mapLoxoneItems(this.LoxoneItems);
  }

  parseLoxoneLightController(LightControllerV2: Control) {

    // Create Mood Switches if enabled in config
    if (this.config.options.MoodSwitches === 'enabled') {
      const moods = JSON.parse(this.LoxoneHandler.getLastCachedValue(LightControllerV2.states.moodList));
      for (const mood of moods) {
        if (mood.name !== 'Uit') {

          const MoodSwitch = Object.assign({}, LightControllerV2);

          MoodSwitch.name = `[${this.LoxoneRooms[LightControllerV2.room]}] ${mood.name}`;
          MoodSwitch.uuidAction = `${LightControllerV2.uuidAction}/${mood.name}`;
          MoodSwitch.type = 'MoodSwitch';
          MoodSwitch.cat = mood.id;
          MoodSwitch.details = {};
          MoodSwitch.subControls = {};

          this.LoxoneItems[`${LightControllerV2.uuidAction}/${mood.name}`] = MoodSwitch;
        }
      }
    }

    // Create individual Lights
    for (const childUuid in LightControllerV2.subControls) {

      const LightItem = LightControllerV2.subControls[childUuid];
      if (!(LightItem.uuidAction.indexOf('/masterValue') !== -1) || (LightItem.uuidAction.indexOf('/masterColor')) !== -1) {
        this.LoxoneItems[childUuid] = LightItem;
        this.LoxoneItems[childUuid].room = this.LoxoneRooms[LightControllerV2.room];
        this.LoxoneItems[childUuid].cat = this.LoxoneCats[LightControllerV2.cat];
        this.LoxoneItems[childUuid].type = this.checkLoxoneType(LightItem);
      }
    }
    return;
  }

  checkLoxoneType(LoxoneItem: Control) {

    // Add motionSensor state to IntercomV2 Item
    if (LoxoneItem.type === 'IntercomV2') {
      LoxoneItem.states.active = this.LoxoneIntercomMotion;
    }

    if (LoxoneItem.type === 'Switch') {
      // Map Switch with Lock Alias to LockItem
      if (this.config.switchAlias?.Lock && LoxoneItem.name.includes(this.config.switchAlias.Lock)) {
        return 'Lock';
      }
    }

    // Change Pushbutton to Switch
    if (LoxoneItem.type === 'Pushbutton') {
      return 'Switch';
    }

    if (LoxoneItem.type === 'InfoOnlyAnalog') {
      // Map InfoOnlyAnalog with Humidity Alias to HumidityItem
      if (this.config.InfoOnlyAnalogAlias?.Humidity && LoxoneItem.name.includes(this.config.InfoOnlyAnalogAlias.Humidity)) {
        return 'Humidity';
      }

      // Map InfoOnlyAnalog with Brightness Alias to HumidityItem
      if (this.config.InfoOnlyAnalogAlias?.Brightness && LoxoneItem.name.includes(this.config.InfoOnlyAnalogAlias.Brightness)) {
        return 'Brightness';
      }
    }

    if (LoxoneItem.type === 'InfoOnlyDigital') {
      // Map InfoOnlyDigital' with Motion Alias to MotionItem
      if (this.config.InfoOnlyDigitalAlias?.Motion && LoxoneItem.name.includes(this.config.InfoOnlyDigitalAlias.Motion)) {
        return 'Motion';
      }

      // Map Intercom MotionSensor to Intercom object
      if (LoxoneItem.name.includes('IntercomV2')) {
        this.LoxoneIntercomMotion = LoxoneItem.uuidAction;
      }
    }
    return LoxoneItem.type;
  }

  async mapLoxoneItems(LoxoneItems: Controls) {

    let itemid = 1;

    for (const uuid in LoxoneItems) {
      if (this.SupportedItems.includes(LoxoneItems[uuid].type)) {
        if (itemid >= 149) {
          this.log.info('[mapLoxoneitems] Maximum number of supported HomeKit items reached. Stop mapping Items.');
          return;
        }
        this.log.info(`[mapLoxoneItems][Item ${itemid}] Found item: ${LoxoneItems[uuid].name} with type ${LoxoneItems[uuid].type}`);
        new LoxoneAccessory(this, LoxoneItems[uuid]);
        itemid++;
      } else {
        this.log.debug(`[mapLoxoneitems] Skipping Unsupported item: ${LoxoneItems[uuid].name} with type ${LoxoneItems[uuid].name}`);
      }
    }
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }
}