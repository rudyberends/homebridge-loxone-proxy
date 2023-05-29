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
  Service: Record<string, unknown> = {};
  ItemStates: Record<string, { service: string; state: string }> = {};

  constructor(
    readonly platform: LoxonePlatform,
    readonly device: Control,
  ) {

    // Don't add more than HomeKit MAX items
    if (this.platform.AccessoryCount >= 149) {
      this.platform.log.info(`[${device.type}Item] Maximum number of supported HomeKit Accessories reached. Item not Mapped`);
      return;
    }

    if (!this.isSupported()) {
      this.platform.log.debug(`[${device.type}Item] Skipping Unsupported Item: ${this.device.name}`);
      return;
    }

    this.setupAccessory();
  }

  protected isSupported(): boolean {
    return true;
  }

  private setupAccessory(): void {
    const uuid = this.platform.api.hap.uuid.generate(this.device.uuidAction);
    this.Accessory = this.getOrCreateAccessory(uuid);

    this.Accessory.context.device = this.device;
    this.Accessory.context.mapped = true;

    this.configureServices(this.Accessory);
    this.setupListeners();

    this.platform.AccessoryCount++;
  }

  private getOrCreateAccessory(uuid: string): PlatformAccessory {
    let accessory = this.platform.accessories.find((acc) => acc.UUID === uuid);

    if (!accessory) {
      accessory = new this.platform.api.platformAccessory(this.device.name, uuid);
      this.platform.api.registerPlatformAccessories('homebridge-loxone-proxy', 'LoxonePlatform', [accessory]);
      this.platform.log.debug(`[${this.device.type}Item] Adding new accessory:`, this.device.name);
    } else {
      this.platform.log.debug(`[${this.device.type}Item] Restoring accessory from cache:`, accessory.displayName);
    }

    const accessoryInfoService = accessory.getService(this.platform.Service.AccessoryInformation);
    if (accessoryInfoService) {
      accessoryInfoService
        .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Loxone')
        .setCharacteristic(this.platform.Characteristic.Model, this.device.room)
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.uuidAction)
        .setCharacteristic(this.platform.Characteristic.Name, this.device.name);
    }
    return accessory;
  }

  protected configureServices(accessory: PlatformAccessory): void {
    // Implement the configuration of services for the accessory
  }

  private setupListeners(): void {
    this.platform.log.debug(`[${this.device.name}] Register Listeners for ${this.device.type}Item`);
    for (const state in this.ItemStates) {
      this.platform.LoxoneHandler.registerListenerForUUID(state, this.callBack.bind(this));
    }
  }

  private callBack = (message: { uuid: string; state: string; service: string; value: number }): void => {
    if (message.uuid) {
      const itemState = this.ItemStates[message.uuid];
      message.service = itemState.service;
      message.state = itemState.state;

      const updateService = new Function('message', `return this.Service.${this.ItemStates[message.uuid].service}.updateService(message);`);
      updateService.call(this, message);
    }
  };
}