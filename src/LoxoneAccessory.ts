import { PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from './LoxonePlatform';
import { Control } from './loxone/StructureFile';

/**
 * LoxoneAccessory
 * An instance of this class is created for each accessory Loxone platform registers.
 * Each accessory may expose multiple services of different service types.
 */
export class LoxoneAccessory {
  Accessory: PlatformAccessory | undefined;
  Service: { [key: string]: unknown } = {};
  ItemStates = {};

  constructor(
    readonly platform: LoxonePlatform,
    readonly device: Control,
  ) {

    // Don't add more than HomeKit MAX items
    if (this.platform.AccessoryCount >= 149) {
      this.platform.log.info(`[${device.type}Item] Maximum number of supported HomeKit Accessories reached. Item not Mapped`);
      return;
    }

    (this.isSupported())
      ? this.setupAccessory()
      : this.platform.log.debug(`[${device.type}Item] Skipping Unsupported Item: ${this.device.name}`);
  }

  isSupported(): boolean {
    return true;
  }

  setupAccessory(): void {

    const uuid = this.platform.api.hap.uuid.generate(this.device.uuidAction);

    this.Accessory = this.platform.accessories.find(accessory => accessory.UUID === uuid);
    const isCached = (this.Accessory) ? true : false;

    if (!this.Accessory) {
      this.Accessory = new this.platform.api.platformAccessory(this.device.name, uuid);
    }

    this.Accessory.context.device = this.device;
    this.Accessory.context.mapped = true;

    if (isCached) {
      this.platform.log.debug(`[${this.device.type}Item] Restoring accessory from cache:`, this.Accessory.displayName);
      this.platform.api.updatePlatformAccessories([this.Accessory]);
    } else {
      this.platform.log.debug(`[${this.device.type}Item] Adding new accessory:`, this.device.name);
      this.platform.api.registerPlatformAccessories('homebridge-loxone-proxy', 'LoxonePlatform', [this.Accessory]);
    }

    this.Accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Loxone')
      .setCharacteristic(this.platform.Characteristic.Model, this.device.room)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.uuidAction)
      .setCharacteristic(this.platform.Characteristic.Name, this.device.name);

    this.configureServices();
    this.setupListeners();

    this.platform.AccessoryCount++;
  }

  configureServices(): void {
    return;
  }

  setupListeners(): void {
    this.platform.log.debug(`[${this.device.name}] Register Listeners for ${this.device.type}Item`);
    for(const state in this.ItemStates) {
      this.platform.LoxoneHandler.registerListenerForUUID(state, this.callBack.bind(this));
    }
  }

  callBack = ( message: {uuid: string; state: string; service: string; value: number} ) => {
    if (message.uuid) {
      message.service = this.ItemStates[message.uuid].service;
      message.state = this.ItemStates[message.uuid].state;
      const updateService = new Function('message', `return this.Service.${this.ItemStates[message.uuid].service}.updateService(message);`);
      updateService.call(this, message);
    }
  };
}