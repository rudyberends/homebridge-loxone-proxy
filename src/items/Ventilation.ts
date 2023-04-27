import { Service, PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../LoxonePlatform';
import { Control } from '../structure/LoxAPP3';

export class Ventilation {
  private service: Service;
  private device: Control;

  private State = {
    Active: true,
    RotationSpeed: 0,
  };

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.device = this.accessory.context.device;

    this.service =
      this.accessory.getService(this.platform.Service.Fanv2) ||
      this.accessory.addService(this.platform.Service.Fanv2);

    this.LoxoneListener();

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.handleActiveGet.bind(this))
      .onSet(this.handleActiveSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(this.handleRotationSpeedGet.bind(this));
    //.onSet(this.handleActiveSet.bind(this));
  }

  // Register a listener to be notified of changes in this items value
  LoxoneListener = () => {

    this.platform.log.debug(`[${this.device.name}] Register Listener for Fan`);
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.mode, this.callBack.bind(this));
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.speed, this.callBackSpeed.bind(this));
  };

  callBack = (message: { uuid: string; value: number }) => {
    if (message.uuid) {
      this.platform.log.debug(`[${this.device.name}] Callback State update for Fan: ${message.value}`);
      //this.State.On = !!message.value;

      //also make sure this change is directly communicated to HomeKit
      this.service
        .getCharacteristic(this.platform.Characteristic.Active)
        .updateValue(this.State.Active);
    }
  };

  callBackSpeed = (message: { uuid: string; value: number }) => {
    if (message.uuid) {
      this.platform.log.debug(`[${this.device.name}] Callback Speed update for Fan: ${message.value}`);
      this.State.RotationSpeed = message.value;

      //also make sure this change is directly communicated to HomeKit
      this.service
        .getCharacteristic(this.platform.Characteristic.RotationSpeed)
        .updateValue(this.State.RotationSpeed);
    }
  };

  /**
   * Handle requests to get the current value of the "Active" characteristic
   */
  handleActiveGet() {
    this.platform.log.debug('Triggered GET Active');
    return this.State.Active;
  }

  /**
   * Handle requests to set the "Active" characteristic
   */
  handleActiveSet(value) {
    this.platform.log.debug('Triggered SET Active:' + value);
  }

  /**
  * Handle requests to get the current value of the "Active" characteristic
  */
  handleRotationSpeedGet() {
    this.platform.log.debug('Triggered GET RotationSpeed');
    return this.State.RotationSpeed;
  }


}