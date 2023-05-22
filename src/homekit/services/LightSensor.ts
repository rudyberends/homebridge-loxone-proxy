import { BaseService } from './BaseService';

export class LightSensor extends BaseService {

  State = {
    CurrentAmbientLightLevel: 0.0001,
  };

  setupService() {
    this.service =
      this.accessory.getService(this.platform.Service.LightSensor) ||
      this.accessory.addService(this.platform.Service.LightSensor);

    this.service.getCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel)
      .onGet(this.handleCurrentAmbientLightLevelGet.bind(this)); // GET - bind to the `getOn` method below
  }

  updateService = (message: {value: number}) => {
    this.platform.log.debug(`[${this.device.name}] Callback state update for Light Sensor: ${message.value}`);
    this.State.CurrentAmbientLightLevel = (message.value > 0.0001) ? message.value : 0.0001;

    //also make sure this change is directly communicated to HomeKit
    this.service!
      .getCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel)
      .updateValue(this.State.CurrentAmbientLightLevel);

  };

  handleCurrentAmbientLightLevelGet() {
    this.platform.log.debug('Triggered GET CurrentAmbientLightLevel');
    return this.State.CurrentAmbientLightLevel;
  }
}