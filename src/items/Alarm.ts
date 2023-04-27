import { Service, PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../LoxonePlatform';
import { Control } from '../structure/LoxAPP3';

export class Alarm {
  private service: Service;
  private device: Control;

  private State = {
    SecuritySystemCurrentState: 3,
    SecuritySystemTargetState: 3,
  };

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.service =
      this.accessory.getService(this.platform.Service.SecuritySystem) ||
      this.accessory.addService(this.platform.Service.SecuritySystem);
    this.device = this.accessory.context.device;

    this.LoxoneListener();

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
      .onGet(this.handleSecuritySystemCurrentStateGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
      .onGet(this.handleSecuritySystemTargetStateGet.bind(this))
      .onSet(this.handleSecuritySystemTargetStateSet.bind(this));
  }

  // Register a listener to be notified of changes in this items value
  LoxoneListener = () => {
    this.platform.log.debug(`[${this.device.name}] Register Listener for Switch`);
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.armed, this.callBack.bind(this));
  };

  callBack = ( message: {uuid: string; value: number} ) => {
    if (message.uuid) {
      this.platform.log.debug(`[${this.device.name}] Callback state update for Alarm: ${message.value}`);

      this.State.SecuritySystemTargetState = message.value;
      this.State.SecuritySystemCurrentState = message.value;

      //also make sure this change is directly communicated to HomeKit
      this.service
        .getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
        .updateValue(this.State.SecuritySystemTargetState);

      this.service
        .getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
        .updateValue(this.State.SecuritySystemCurrentState);
    }
  };

  /**
   * Handle requests to get the current value of the "Security System Current State" characteristic
   */
  handleSecuritySystemCurrentStateGet() {
    this.platform.log.debug('Triggered GET SecuritySystemCurrentState');
    return this.State.SecuritySystemCurrentState;
  }


  /**
   * Handle requests to get the current value of the "Security System Target State" characteristic
   */
  handleSecuritySystemTargetStateGet() {
    this.platform.log.debug('Triggered GET SecuritySystemTargetState');
    return this.State.SecuritySystemTargetState;
  }

  /**
   * Handle requests to set the "Security System Target State" characteristic
   */
  handleSecuritySystemTargetStateSet(value) {
    this.platform.log.debug('Triggered SET SecuritySystemTargetState:'+ value);
  }

}