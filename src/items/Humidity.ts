import { Service, PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../LoxonePlatform';
import { Control } from '../structure/LoxAPP3';

export class Humidiy {
  private service: Service;
  private device: Control;

  private State = {
    CurrentRelativeHumidity: 0,
  };

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.service =
      this.accessory.getService(this.platform.Service.HumiditySensor) ||
      this.accessory.addService(this.platform.Service.HumiditySensor);

    this.device = this.accessory.context.device;

    this.LoxoneListener();

    this.service.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(this.handleCurrentRelativeHumidityGet.bind(this)); // GET - bind to the `getOn` method below
  }

  // Register a listener to be notified of changes in this items value
  LoxoneListener = () => {
    this.platform.log.debug(`[${this.device.name}] Register Listener for Humidity Sensor`);
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.value, this.callBack.bind(this));
  };

  callBack = ( message: {uuid: string; value: number} ) => {
    if (message.uuid) {
      this.platform.log.debug(`[${this.device.name}] Callback state update for Humidity Sensor: ${message.value}`);
      this.State.CurrentRelativeHumidity = message.value;

      //also make sure this change is directly communicated to HomeKit
      this.service
        .getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
        .updateValue(this.State.CurrentRelativeHumidity);
    }
  };

  handleCurrentRelativeHumidityGet() {
    this.platform.log.debug('Triggered GET CurrentRelativeHumidity');
    return this.State.CurrentRelativeHumidity;
  }
}