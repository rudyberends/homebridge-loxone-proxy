import { BaseService } from './BaseService';

export class GarageDoorOpener extends BaseService {

  State = {
    CurrentDoorState: 0,
    TargetDoorState: 0,
    Position: 0,
    ObstructionDetected: 0,
  };

  setupService() {
    this.service =
      this.accessory.getService(this.platform.Service.GarageDoorOpener) ||
      this.accessory.addService(this.platform.Service.GarageDoorOpener);

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.CurrentDoorState)
      .onGet(this.handleCurrentDoorStateGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetDoorState)
      .onGet(this.handleTargetDoorStateGet.bind(this))
      .onSet(this.handleTargetDoorStateSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.ObstructionDetected)
      .onGet(this.handleObstructionDetectedGet.bind(this));
  }

  updateService(message: { state: string; value: number }) {

    this.platform.log.debug(`[${this.device.name}] ${message.state} Callback state update for Gate: ${message.value}`);

    switch (message.state) {

      case 'active':
        switch (message.value) {
          case -1: // closing
            this.State.CurrentDoorState = 3;
            break;
          case 0: // not moving
            this.State.CurrentDoorState = this.State.Position === 0 ? 1 : this.State.Position === 1 ? 0 : 4;
            break;
          case 1: // opening
            this.State.CurrentDoorState = 2;
            break;
        }
        break;

      case 'position':
        this.State.TargetDoorState = message.value === 0 ? 1 : 0;
        this.State.Position = message.value;
        break;
    }
  }

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