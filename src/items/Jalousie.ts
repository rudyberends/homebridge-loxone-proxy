import { Service, PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../LoxonePlatform';
import { Control } from '../structure/LoxAPP3';

export class Jalousie {
  private service: Service;
  private device: Control;
  private JalousieType: unknown;

  private State = {
    CurrentPosition: 0,
    TargetPosition: 0,
    CurrentHorizontalTiltAngle: 0,
    TargetHorizontalTiltAngle: 0,
    PositionState: 2,
    ObstructionDetected: 0,
  };

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.device = this.accessory.context.device;

    this.service =
      this.accessory.getService(this.platform.Service.WindowCovering) ||
      this.accessory.addService(this.platform.Service.WindowCovering);

    this.JalousieType = this.device.details.animation;
    /*
      0 = Blinds
      1 = Shutters
      2 = Curtain both sides
      3 = Not supported
      4 = Curtain Left
      5 = Curtain Right
    */

    this.LoxoneListener();

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.CurrentPosition)
      .onGet(this.handleCurrentPositionGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetPosition)
      .onGet(this.handleTargetPositionGet.bind(this))
      .onSet(this.handleTargetPositionSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.ObstructionDetected)
      .onGet(this.handleObstructionDetectedGet.bind(this));

    if (this.JalousieType === 0) { // Blinds
      this.service.getCharacteristic(this.platform.Characteristic.CurrentHorizontalTiltAngle)
        .onGet(this.handleCurrentShadePositionGet.bind(this));
      this.service.getCharacteristic(this.platform.Characteristic.TargetHorizontalTiltAngle)
        .onGet(this.handleTargetShadePositionGet.bind(this))
        .onSet(this.handleTargetShadePositionSet.bind(this));
    }
  }

  // Register a listener to be notified of changes in this items value
  LoxoneListener = () => {
    this.platform.log.debug(`[${this.device.name}] Register Listener for Jalousie`);
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.up, this.UpCallBack.bind(this));
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.down, this.DownCallBack.bind(this));
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.position, this.positionCallBack.bind(this));
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.shadePosition, this.shadePositionCallBack.bind(this));
  };

  UpCallBack = (message: { uuid: string; value: number }) => {
    if (message.uuid) {
      this.platform.log.debug(`[${this.device.name}] Up Callback state update for Jalousie: ${message.value}`);

      this.State.PositionState = (message.value === 0)? 2 : 1;

      //also make sure this change is directly communicated to HomeKit
      this.service
        .getCharacteristic(this.platform.Characteristic.PositionState)
        .updateValue(this.State.PositionState);
    }
  };

  DownCallBack = (message: { uuid: string; value: number }) => {
    if (message.uuid) {
      this.platform.log.debug(`[${this.device.name}] Down Callback state update for Jalousie: ${message.value}`);

      this.State.PositionState = (message.value === 0)? 2 : 0;

      //also make sure this change is directly communicated to HomeKit
      this.service
        .getCharacteristic(this.platform.Characteristic.PositionState)
        .updateValue(this.State.PositionState);
    }
  };

  positionCallBack = (message: { uuid: string; value: number }) => {
    if (message.uuid) {
      this.platform.log.debug(`[${this.device.name}] Position Callback state update for Jalousie: ${message.value}`);

      this.State.TargetPosition = 100 - (message.value *=100); // reversed value
      this.State.TargetPosition = this.State.TargetPosition < 0 ? 0 : this.State.TargetPosition;
      this.State.TargetPosition = this.State.TargetPosition > 100 ? 100 : this.State.TargetPosition;
      this.State.CurrentPosition = this.State.TargetPosition;

      //also make sure this change is directly communicated to HomeKit
      this.service
        .getCharacteristic(this.platform.Characteristic.TargetPosition)
        .updateValue(this.State.TargetPosition);
      this.service
        .getCharacteristic(this.platform.Characteristic.CurrentPosition)
        .updateValue(this.State.CurrentPosition);
    }
  };

  shadePositionCallBack = (message: { uuid: string; value: number }) => {
    if (message.uuid) {

      this.platform.log.debug(`[${this.device.name}] Shade Position Callback state update for Jalousie: ${message.value}`);
      this.State.TargetHorizontalTiltAngle = message.value * 180 - 90;
      this.State.TargetHorizontalTiltAngle = this.State.TargetHorizontalTiltAngle < -90 ? -90 : this.State.TargetHorizontalTiltAngle;
      this.State.TargetHorizontalTiltAngle = this.State.TargetHorizontalTiltAngle > 90 ? 90 : this.State.TargetHorizontalTiltAngle;
      this.State.CurrentHorizontalTiltAngle = this.State.TargetHorizontalTiltAngle;

      //also make sure this change is directly communicated to HomeKit
      this.service
        .getCharacteristic(this.platform.Characteristic.TargetHorizontalTiltAngle)
        .updateValue(this.State.TargetHorizontalTiltAngle);
      this.service
        .getCharacteristic(this.platform.Characteristic.CurrentHorizontalTiltAngle)
        .updateValue(this.State.CurrentHorizontalTiltAngle);
    }
  };

  handleCurrentPositionGet() {
    this.platform.log.debug(`[${this.device.name}] Triggered GET CurrentPosition`);
    return this.State.CurrentPosition;
  }

  handleTargetPositionGet() {
    this.platform.log.debug(`[${this.device.name}] Triggered GET TargetPosition`);
    return this.State.TargetPosition;
  }

  handleTargetPositionSet(value) {
    this.platform.log.debug(`[${this.device.name}] Triggered SET TargetPosition:` + value);

    const loxoneValue = 100 - parseInt(value);

    const command = `manualPosition/${loxoneValue}`;
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);
  }

  handleCurrentShadePositionGet() {
    this.platform.log.debug(`[${this.device.name}] Triggered GET CurrentHorizontalTiltAngle`);
    return this.State.CurrentHorizontalTiltAngle;
  }

  handleTargetShadePositionGet() {
    this.platform.log.debug(`[${this.device.name}] Triggered GET TargetHorizontalTiltAngle`);
    return this.State.TargetHorizontalTiltAngle;
  }

  handleTargetShadePositionSet(value) {
    this.platform.log.debug(`[${this.device.name}] Triggered SET TargetHorizontalTiltAngle:` + value);

    const loxoneValue = (value + 90) * 100 / 180;

    const command = `manualLamelle/${loxoneValue}`;
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);
  }

  handleObstructionDetectedGet() {
    this.platform.log.debug(`[${this.device.name}] Triggered GET ObstructionDetected`);
    return this.State.ObstructionDetected;
  }
}