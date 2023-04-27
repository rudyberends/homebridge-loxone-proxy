import { Service, PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../LoxonePlatform';
import { Control } from '../structure/LoxAPP3';

export class Gate {
  private service: Service;
  private device: Control;

  private State = {
    CurrentDoorState: 0,
    TargetDoorState: 0,
    Position: 0,
    ObstructionDetected: 0,
  };

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.service =
      this.accessory.getService(this.platform.Service.GarageDoorOpener) ||
      this.accessory.addService(this.platform.Service.GarageDoorOpener);
    this.device = this.accessory.context.device;

    this.LoxoneListener();

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.CurrentDoorState)
      .onGet(this.handleCurrentDoorStateGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetDoorState)
      .onGet(this.handleTargetDoorStateGet.bind(this))
      .onSet(this.handleTargetDoorStateSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.ObstructionDetected)
      .onGet(this.handleObstructionDetectedGet.bind(this));
  }

  // Register a listener to be notified of changes in this items value
  LoxoneListener = () => {
    this.platform.log.debug(`[${this.device.name}] Register Listener for Switch`);
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.position, this.PositionCallBack.bind(this));
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.active, this.ActiveCallBack.bind(this));
  };

  PositionCallBack = (message: { uuid: string; value: number }) => {
    if (message.uuid) {
      this.platform.log.debug(`[${this.device.name}] Position Callback state update for Gate: ${message.value}`);

      if (message.value === 0) {
        this.State.TargetDoorState = 1;
      }
      if (message.value === 1) {
        this.State.TargetDoorState = 0;
      }

      this.State.Position = message.value;

      //also make sure this change is directly communicated to HomeKit
      this.service
        .getCharacteristic(this.platform.Characteristic.TargetDoorState)
        .updateValue(this.State.TargetDoorState);
    }
  };

  ActiveCallBack = (message: { uuid: string; value: number }) => {
    if (message.uuid) {
      this.platform.log.debug(`[${this.device.name}] Active Callback state update for Gate: ${message.value}`);

      switch (message.value) {
        case -1: // closing
          this.State.CurrentDoorState = 3;
          break;
        case 0: // not moving
          if (this.State.Position === 0) {
            this.State.CurrentDoorState = 1; // open
          } else if (this.State.Position === 1) {
            this.State.CurrentDoorState = 0; // closed
          } else {
            this.State.CurrentDoorState = 4; // stopped
          }
          break;
        case 1: // opening
          this.State.CurrentDoorState = 2;
          break;
      }

      //also make sure this change is directly communicated to HomeKit
      this.service
        .getCharacteristic(this.platform.Characteristic.CurrentDoorState)
        .updateValue(this.State.CurrentDoorState);
    }
  };

  /**
   * Handle requests to get the current value of the "Current Door State" characteristic
   */
  handleCurrentDoorStateGet() {
    this.platform.log.debug('Triggered GET CurrentDoorState');
    return this.State.CurrentDoorState;
  }

  /**
   * Handle requests to get the current value of the "Target Door State" characteristic
   */
  handleTargetDoorStateGet() {
    this.platform.log.debug('Triggered GET TargetDoorState');
    return this.State.TargetDoorState;
  }

  /**
   * Handle requests to set the "Target Door State" characteristic
   */
  handleTargetDoorStateSet(value) {
    this.platform.log.debug('Triggered SET TargetDoorState:' + value);
  }

  /**
   * Handle requests to get the current value of the "Obstruction Detected" characteristic
   */
  handleObstructionDetectedGet() {
    this.platform.log.debug('Triggered GET ObstructionDetected');
    return this.State.ObstructionDetected;
  }
}