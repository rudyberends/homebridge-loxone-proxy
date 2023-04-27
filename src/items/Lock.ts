import { Service, PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../LoxonePlatform';
import { Control } from '../structure/LoxAPP3';

export class Lock {
  private service: Service;
  private device: Control;

  private State = {
    LockCurrentState: 0,
    LockTargetState: 0,
  };

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.service =
      this.accessory.getService(this.platform.Service.LockMechanism) ||
      this.accessory.addService(this.platform.Service.LockMechanism);
    this.device = this.accessory.context.device;

    this.LoxoneListener();

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.LockCurrentState)
      .onGet(this.handleLockCurrentStateGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.LockTargetState)
      .onGet(this.handleLockTargetStateGet.bind(this))
      .onSet(this.handleLockTargetStateSet.bind(this));
  }

  // Register a listener to be notified of changes in this items value
  LoxoneListener = () => {
    this.platform.log.debug(`[${this.device.name}] Register Listener for Lock`);
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.active, this.callBack.bind(this));
  };

  callBack = (message: { uuid: string; value: number }) => {
    if (message.uuid) {
      this.platform.log.debug(`[${this.device.name}] Callback state update for Lock: ${message.value}`);
      this.State.LockTargetState = message.value;

      //also make sure this change is directly communicated to HomeKit
      this.service
        .getCharacteristic(this.platform.Characteristic.LockTargetState)
        .updateValue(this.State.LockTargetState);

      setTimeout(() => {
        this.State.LockCurrentState = message.value;

        //also make sure this change is directly communicated to HomeKit
        this.service
          .getCharacteristic(this.platform.Characteristic.LockCurrentState)
          .updateValue(this.State.LockCurrentState);
      }, 5000);
    }
  };

  /**
   * Handle requests to get the current value of the "Lock Current State" characteristic
   */
  handleLockCurrentStateGet() {
    this.platform.log.debug('Triggered GET LockCurrentState');
    return this.State.LockCurrentState;
  }

  /**
 * Handle requests to get the current value of the "Lock Target State" characteristic
 */
  handleLockTargetStateGet() {
    this.platform.log.debug('Triggered GET LockTargetState');
    return this.State.LockTargetState;
  }

  /**
 * Handle requests to set the "Lock Target State" characteristic
 */
  handleLockTargetStateSet(value) {
    this.platform.log.debug('Triggered SET LockTargetState:' + value);
    const command = this.State.LockTargetState ? 'Off' : 'On';
    this.platform.log.debug(`[${this.device.name}] - send message: ${command}`);
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);
  }
}