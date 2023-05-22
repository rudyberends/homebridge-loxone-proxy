import { BaseService } from './BaseService';

export class Fanv2 extends BaseService {

  State = {
    Active: true,
    RotationSpeed: 0,
  };

  setupService() {
    this.service =
      this.accessory.getService(this.platform.Service.Fanv2) ||
      this.accessory.addService(this.platform.Service.Fanv2);

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.handleActiveGet.bind(this))
      .onSet(this.handleActiveSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(this.handleRotationSpeedGet.bind(this));
    //.onSet(this.handleActiveSet.bind(this));
  }

  updateService = (message: {state: string; value: number}) => {
    this.platform.log.debug(`[${this.device.name}] Callback ${message.state} update for Fan: ${message.value}`);

    switch (message.state) {
      case 'mode':
        break;
      case 'speed':
        this.State.RotationSpeed = message.value;
        break;
    }

    //also make sure this change is directly communicated to HomeKit
    this.service!.getCharacteristic(this.platform.Characteristic.Active).updateValue(this.State.Active);
    this.service!.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(this.State.RotationSpeed);
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