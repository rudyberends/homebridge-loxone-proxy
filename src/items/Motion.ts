import { Service, PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../LoxonePlatform';
import { Control } from '../structure/LoxAPP3';

export class Motion {
  private service: Service;
  private device: Control;

  private State = {
    MotionDetected: false,
  };

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.service =
      this.accessory.getService(this.platform.Service.MotionSensor) ||
      this.accessory.addService(this.platform.Service.MotionSensor);
    this.device = this.accessory.context.device;

    this.LoxoneListener();

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.MotionDetected)
      .onGet(this.handleMotionDetectedGet.bind(this));
  }

  // Register a listener to be notified of changes in this items value
  LoxoneListener = () => {
    this.platform.log.debug(`[${this.device.name}] Register Listener for MotionSensor`);
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.active, this.callBack.bind(this));
  };

  callBack = ( message: {uuid: string; value: number} ) => {
    if (message.uuid) {

      this.platform.log.debug(`[${this.device.name}] Callback state update for MotionSensor: ${!!message.value}`);
      this.State.MotionDetected = !!message.value;

      //also make sure this change is directly communicated to HomeKit
      this.service
        .getCharacteristic(this.platform.Characteristic.MotionDetected)
        .updateValue(this.State.MotionDetected);
    }
  };

  /**
   * Handle requests to get the current value of the "Motion Detected" characteristic
   */
  handleMotionDetectedGet() {
    this.platform.log.debug('Triggered GET MotionDetected');
    return this.State.MotionDetected;
  }
}