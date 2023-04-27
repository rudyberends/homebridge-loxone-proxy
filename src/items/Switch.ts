import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { LoxonePlatform } from '../LoxonePlatform';
import { Control } from '../structure/LoxAPP3';

export class Switch {
  private service: Service;
  private device: Control;

  private State = {
    On: false,
  };

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.device = this.accessory.context.device;

    const switchType = (this.device.cat === 'lights') ? this.platform.Service.Lightbulb : this.platform.Service.Switch;
    this.service = this.accessory.getService(switchType) || this.accessory.addService(switchType);

    this.LoxoneListener();

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))  // SET - bind to the `setOn` method below
      .onGet(this.getOn.bind(this)); // GET - bind to the `getOn` method below
  }

  // Register a listener to be notified of changes in this items value
  LoxoneListener = () => {
    this.platform.log.debug(`[${this.device.name}] Register Listener for Switch`);
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.active, this.callBack.bind(this));
  };

  callBack = ( message: {uuid: string; value: number} ) => {
    if (message.uuid) {
      this.platform.log.debug(`[${this.device.name}] Callback state update for Switch: ${!!message.value}`);
      this.State.On = !!message.value;

      //also make sure this change is directly communicated to HomeKit
      this.service
        .getCharacteristic(this.platform.Characteristic.On)
        .updateValue(this.State.On);
    }
  };

  async setOn(value: CharacteristicValue) {
    this.State.On = value as boolean;
    this.platform.log.debug(`[${this.device.name}] Switch update from Homekit ->`, value);

    const command = this.State.On ? 'On' : 'Off';
    this.platform.log.debug(`[${this.device.name}] - send message: ${command}`);
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);

  }

  async getOn(): Promise<CharacteristicValue> {
    return this.State.On;
  }
}