import { BaseService } from './BaseService';

export class WindowCovering extends BaseService {
  private JalousieType: unknown;

  State = {
    CurrentPosition: 0,
    TargetPosition: 0,
    CurrentHorizontalTiltAngle: 0,
    TargetHorizontalTiltAngle: 0,
    PositionState: 2,
    ObstructionDetected: 0,
  };

  setupService() {
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

  updateService = (message: { state: string; value: number }) => {
    this.platform.log.debug(`[${this.device.name}] ${message.state} Callback update for Jalousie: ${message.value}`);

    switch (message.state) {

      case 'up':
        this.State.PositionState = (message.value === 0)? 2 : 1;
        this.service!.getCharacteristic(this.platform.Characteristic.PositionState).updateValue(this.State.PositionState);
        break;

      case 'down':
        this.State.PositionState = (message.value === 0)? 2 : 0;
        this.service!.getCharacteristic(this.platform.Characteristic.PositionState).updateValue(this.State.PositionState);
        break;

      case 'position':
        this.State.TargetPosition = 100 - (message.value *=100); // reversed value
        this.State.TargetPosition = this.State.TargetPosition < 0 ? 0 : this.State.TargetPosition;
        this.State.TargetPosition = this.State.TargetPosition > 100 ? 100 : this.State.TargetPosition;
        this.State.CurrentPosition = this.State.TargetPosition;
        this.service!.getCharacteristic(this.platform.Characteristic.TargetPosition).updateValue(this.State.TargetPosition);
        this.service!.getCharacteristic(this.platform.Characteristic.CurrentPosition).updateValue(this.State.CurrentPosition);
        break;

      case 'shadePosition':
        this.State.TargetHorizontalTiltAngle = message.value * 180 - 90;
        this.State.TargetHorizontalTiltAngle = this.State.TargetHorizontalTiltAngle < -90 ? -90 : this.State.TargetHorizontalTiltAngle;
        this.State.TargetHorizontalTiltAngle = this.State.TargetHorizontalTiltAngle > 90 ? 90 : this.State.TargetHorizontalTiltAngle;
        this.State.CurrentHorizontalTiltAngle = this.State.TargetHorizontalTiltAngle;
        this.service!.getCharacteristic(this.platform.Characteristic.TargetHorizontalTiltAngle)
          .updateValue(this.State.TargetHorizontalTiltAngle);
        this.service!.getCharacteristic(this.platform.Characteristic.CurrentHorizontalTiltAngle)
          .updateValue(this.State.CurrentHorizontalTiltAngle);
        break;
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