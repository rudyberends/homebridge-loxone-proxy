import { Service, PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../LoxonePlatform';
import { Control } from '../structure/LoxAPP3';

export class Brightness {
  private service: Service;
  private device: Control;

  private State = {
    CurrentAmbientLightLevel: 0,
  };

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.service =
      this.accessory.getService(this.platform.Service.LightSensor) ||
      this.accessory.addService(this.platform.Service.LightSensor);

    this.device = this.accessory.context.device;

    this.LoxoneListener();

    this.service.getCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel)
      .onGet(this.handleCurrentAmbientLightLevelGet.bind(this)); // GET - bind to the `getOn` method below
  }

  // Register a listener to be notified of changes in this items value
  LoxoneListener = () => {

    this.platform.log.debug(`[${this.device.name}] Register Listener for Light Sensor`);
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.value, this.callBack.bind(this));
  };

  callBack = ( message: {uuid: string; value: number} ) => {
    if (message.uuid) {
      this.platform.log.debug(`[${this.device.name}] Callback state update for Light Sensor: ${message.value}`);
      this.State.CurrentAmbientLightLevel = (message.value > 0.0001) ? message.value : 0.0001;

      //also make sure this change is directly communicated to HomeKit
      this.service
        .getCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel)
        .updateValue(this.State.CurrentAmbientLightLevel);
    }
  };

  handleCurrentAmbientLightLevelGet() {
    this.platform.log.debug('Triggered GET CurrentAmbientLightLevel;');
    return this.State.CurrentAmbientLightLevel;
  }
}