import { BaseService } from './BaseService';

export class Doorbell extends BaseService {

  State = {
    ProgrammableSwitchEvent: 0,
  };

  setupService() {
    this.service =
      this.accessory.getService(this.platform.Service.Doorbell) ||
      this.accessory.addService(this.platform.Service.Doorbell);

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent)
      .onGet(this.handleProgrammableSwitchEventGet.bind(this));
  }

  updateService( message: { value: number} ) {
    this.platform.log.debug(`[${this.device.name}] Callback state update for Doorbell: ${message.value}`);
    if (message.value === 1) {
      //also make sure this change is directly communicated to HomeKit
      this.service!.getCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent).updateValue(this.State.ProgrammableSwitchEvent);
    }
  }

  handleProgrammableSwitchEventGet() {
    this.platform.log.debug('Triggered GET ProgrammableSwitchEvent');
    return this.State.ProgrammableSwitchEvent;
  }
}