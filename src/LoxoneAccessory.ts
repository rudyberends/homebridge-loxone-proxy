import { PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from './LoxonePlatform';
import { Control } from './structure/LoxAPP3';

// Loxone Items
import { Alarm } from './items/Alarm';
import { Brightness } from './items/Brightness';
import { ColorPickerV2 } from './items/ColorPickerV2';
import { Dimmer } from './items/Dimmer';
import { Gate } from './items/Gate';
import { Humidiy } from './items/Humidity';
import { IntercomV2 } from './items/IntercomV2';
import { IRoomControllerV2 } from './items/IRoomControllerV2';
import { Lock } from './items/Lock';
import { MoodSwitch } from './items/MoodSwitch';
import { Motion } from './items/Motion';
import { PresenceDetector } from './items/PresenceDetector';
import { Switch } from './items/Switch';
import { Ventilation } from './items/Ventilation';

export class LoxoneAccessory {

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly device: Control,
  ) {

    const uuid = this.platform.api.hap.uuid.generate(this.device.uuidAction);
    const existingAccessory = this.platform.accessories.find(accessory => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      this.platform.log.debug('[LoxoneAccesory] Item already mapped. Restoring accessory from cache:', existingAccessory.displayName);

      // update the accessory.context
      existingAccessory.context.device = this.device;
      existingAccessory.context.mapped = true;

      this.platform.api.updatePlatformAccessories([existingAccessory]);

      // create the accessory handler for the restored accessory
      this.mapLoxoneItem(existingAccessory);

    } else {
      // the accessory does not yet exist, so we need to create it
      this.platform.log.debug('[LoxoneAccesory] Adding new accessory:', this.device.name);

      // create a new accessory
      const accessory = new this.platform.api.platformAccessory(this.device.name, uuid);

      // store a copy of the device object in the `accessory.context`
      accessory.context.device = this.device;
      accessory.context.mapped = true;

      // create the accessory handler for the newly create accessory
      this.mapLoxoneItem(accessory);

      // link the accessory to your platform
      this.platform.api.registerPlatformAccessories('homebridge-loxone-proxy', 'LoxonePlatform', [accessory]);
    }
  }

  mapLoxoneItem(accessory: PlatformAccessory) {

    this.platform.log.debug('[mapLoxoneItem] Mapping Loxone item to accessory:', this.device.name);
    // set accessory information
    accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Loxone')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.room)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.uuidAction)
      .setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    switch (accessory.context.device.type) {

      case 'Alarm':
        new Alarm(this.platform, accessory);
        break;

      case 'Brightness':
        new Brightness(this.platform, accessory);
        break;

      case 'ColorPickerV2':
        new ColorPickerV2(this.platform, accessory);
        break;


      case 'IntercomV2':
        new IntercomV2(this.platform, accessory);
        break;

      case 'Humidity':
        new Humidiy(this.platform, accessory);
        break;

      case 'Switch':
        new Switch(this.platform, accessory);
        break;

      case 'Lock':
        new Lock(this.platform, accessory);
        break;

      case 'Motion':
        new Motion(this.platform, accessory);
        break;

      case 'PresenceDetector':
        new PresenceDetector(this.platform, accessory);
        break;

      case 'Gate':
        new Gate(this.platform, accessory);
        break;

      case 'Dimmer':
        new Dimmer(this.platform, accessory);
        break;

      case 'MoodSwitch':
        new MoodSwitch(this.platform, accessory);
        break;

      case 'IRoomControllerV2':
        new IRoomControllerV2(this.platform, accessory);
        break;

      case 'Ventilation':
        new Ventilation(this.platform, accessory);
        break;
    }
  }
}