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

  constructor(readonly platform: LoxonePlatform, readonly device: Control) {
    // Prevent exceeding the HomeKit accessory limit
    if (this.platform.AccessoryCount >= 149) {
      this.platform.log.info(`[${device.type}Item] Max HomeKit Accessories limit reached. Item not mapped: ${this.device.name}`);
      return;
    }

    // Check if the accessory is supported before proceeding
    if (!this.isSupported()) {
      this.platform.log.debug(`[${device.type}Item] Skipping unsupported item: ${this.device.name}`);
      return;
    }

    // Set up the accessory
    this.setupAccessory();
  }

  // Method to check if the device is supported (to be overridden by subclasses)
  protected isSupported(): boolean {
    return true;
  }

  // Generic setup method for accessory configuration
  private setupAccessory(): void {
    const uuid = this.platform.api.hap.uuid.generate(this.device.uuidAction);
    this.Accessory = this.getOrCreateAccessory(uuid);

    // Store device information in the accessory context
    this.Accessory.context.device = this.device;
    this.Accessory.context.mapped = true;

    // Call the subclass method to configure services
    this.configureServices(this.Accessory);

    // Set up listeners for state changes
    this.setupListeners();

    // Increment accessory count after successful setup
    this.platform.AccessoryCount++;
  }

  private sanitizeName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9\s']/g, '')
      .trim()
      .replace(/\s+/g, ' ');
  }


  // Create or retrieve an existing accessory by UUID
  private getOrCreateAccessory(uuid: string): PlatformAccessory {
    let accessory = this.platform.accessories.find((acc) => acc.UUID === uuid);
    const sanitizedName = this.sanitizeName(this.device.name);

    if (!accessory) {
      accessory = new this.platform.api.platformAccessory(sanitizedName, uuid);
      this.platform.api.registerPlatformAccessories('homebridge-loxone-proxy', 'LoxonePlatform', [accessory]);
      this.platform.log.debug(`[${this.device.type}Item] Adding new accessory: ${sanitizedName} (original: ${this.device.name})`);
    } else {
      // Update name if it differs
      if (accessory.displayName !== sanitizedName) {
        accessory.displayName = sanitizedName;
        this.platform.api.updatePlatformAccessories([accessory]);
      }
      this.platform.log.debug(`[${this.device.type}Item] Restoring accessory from cache: ${accessory.displayName} ` +
        `(original: ${this.device.name})`);
    }

    // Update accessory information
    const accessoryInfoService = accessory.getService(this.platform.Service.AccessoryInformation);
    if (accessoryInfoService) {
      accessoryInfoService
        .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Loxone')
        .setCharacteristic(this.platform.Characteristic.Model, this.device.room)
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.uuidAction)
        .setCharacteristic(this.platform.Characteristic.Name, sanitizedName);
    }
    return accessory;
  }

  // Method to be overridden by subclasses for configuring services
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected configureServices(accessory: PlatformAccessory): void {
    // Implement the configuration of services for the accessory
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected handleLoxoneCommand(value: string): void {
    this.platform.log.info(`[${this.device.name}][handleLoxoneCommand] Function Not Implemented`);
  }

  // Register listeners for state changes
  private setupListeners(): void {
    this.platform.log.debug(`[${this.device.name}] Registering Listeners for ${this.device.type}Item`);
    for (const state in this.ItemStates) {
      this.platform.LoxoneHandler.registerListenerForUUID(state, this.callBack.bind(this));
    }
  }

  // Callback handler for state changes
  private callBack = (message: { uuid: string; state: string; service: string; value: string | number }): void => {
    if (message.uuid) {
      const itemState = this.ItemStates[message.uuid];
      message.service = itemState.service;
      message.state = itemState.state;
      this.callBackHandler(message);
    }
  };

  // Method to be overridden by subclasses for handling state changes
  protected callBackHandler(message: { uuid: string; state: string; service: string; value: string | number }): void {
    this.platform.log.debug(`[${this.device.name}] Callback service: ${message.service}`);
    const updateService = new Function('message', `return this.Service.${message.service}.updateService(message);`);
    updateService.call(this, message);
  }

  protected matchAlias(deviceName: string, alias: string): boolean {
    const aliasRegex = alias.trim().replace(/%/g, '.*').replace(/\s+/g, '\\s*');
    return new RegExp(aliasRegex, 'i').test(deviceName.trim());
  }
}
