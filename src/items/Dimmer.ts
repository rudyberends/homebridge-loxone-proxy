import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { LoxonePlatform } from '../LoxonePlatform';
import { Control } from '../structure/LoxAPP3';

export class Dimmer {
  private service: Service;
  private device: Control;

  private State = {
    On: false,
    Brightness: 0,
  };

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.service = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);
    this.device = this.accessory.context.device;

    this.LoxoneListener();

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))   // SET - bind to the `setOn` method below
      .onGet(this.getOn.bind(this));  // GET - bind to the `getOn` method below

    this.service.getCharacteristic(this.platform.Characteristic.Brightness)
      .onSet(this.setBrightness.bind(this)); // SET - bind to the 'setBrightness` method below
  }

  // Register a listener to be notified of changes in this items value
  LoxoneListener = () => {
    this.platform.log.debug(`[${this.device.name}] Register Listener for Dimmer`);
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.position, this.callBack.bind(this));
  };

  callBack = ( message: {uuid: string; value: number} ) => {
    if (message.uuid) {
      this.platform.log.debug(`[${this.device.name}] Callback state update for Dimmer: ${message.value}`);
      this.State.On = !!message.value;
      this.State.Brightness = message.value as number;

      //also make sure this change is directly communicated to HomeKit
      this.service
        .getCharacteristic(this.platform.Characteristic.On)
        .updateValue(this.State.On);
      this.service
        .getCharacteristic(this.platform.Characteristic.Brightness)
        .updateValue(this.State.Brightness);
    }
  };

  async setOn(value: CharacteristicValue) {
    this.State.On = value as boolean;
    this.platform.log.debug('Set Characteristic On ->', value);

    const command = this.State.On ? 'On' : 'Off';
    this.platform.log.debug(`[${this.device.name}] - send message: ${command}`);
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);
  }

  async getOn(): Promise<CharacteristicValue> {
    const isOn = this.State.On;
    this.platform.log.debug('Get Characteristic On ->', isOn);
    return isOn;
  }

  async setBrightness(value: CharacteristicValue) {
    this.State.Brightness = value as number;
    this.platform.log.debug(`[${this.device.name}] - send message: ${this.State.Brightness}`);
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, this.State.Brightness);
  }
}