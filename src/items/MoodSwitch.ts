import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { LoxonePlatform } from '../LoxonePlatform';
import { Control } from '../structure/LoxAPP3';

export class MoodSwitch {
  private service: Service;
  private device: Control;

  private State = {
    On: false,
  };

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly MoodSwitch: Control,
  ) {

    this.device = MoodSwitch;

    this.service =
      this.accessory.getService(this.device.name) ||
      this.accessory.addService(this.platform.Service.Switch, this.device.name, `${this.device.uuidAction}/${this.device.cat}`);

    this.LoxoneListener();

    this.service.setCharacteristic(this.platform.Characteristic.Name, this.device.name);
    this.service.setCharacteristic(this.platform.Characteristic.ConfiguredName, this.device.name);

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));
  }

  // Register a listener to be notified of changes in this items value
  LoxoneListener = () => {
    this.platform.log.debug(`[${this.device.name}] Register Listener for MoodSwitch`);
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.activeMoods, this.callBack.bind(this));
  };

  callBack = (id: string) => {

    id = (JSON.parse(id));
    this.State.On = (id[0] === this.device.cat) ? true : false;
    this.platform.log.debug(`[${this.device.name}] Callback state update for MoodSwitch: ${this.State.On}`);

    //also make sure this change is directly communicated to HomeKit
    this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .updateValue(this.State.On);
  };

  async setOn(value: CharacteristicValue) {
    this.State.On = value as boolean;
    this.platform.log.debug(`[${this.device.name}] MoodSwitch update from Homekit ->`, value);

    const id = this.State.On ? this.device.cat : '0';
    const command = `changeTo/${id}`;
    const uuid = this.device.uuidAction.split('/');
    this.platform.log.debug(`[${this.device.name}] - send message: ${command}`);
    this.platform.LoxoneHandler.sendCommand(uuid[0], command);

  }

  async getOn(): Promise<CharacteristicValue> {
    return this.State.On;
  }
}