import { BaseService } from './BaseService';

export class HumiditySensor extends BaseService {

  State = {
    CurrentRelativeHumidity: 0,
  };

  setupService() {
    this.service =
      this.accessory.getService(this.platform.Service.HumiditySensor) ||
      this.accessory.addService(this.platform.Service.HumiditySensor);

    this.service.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(this.handleCurrentRelativeHumidityGet.bind(this)); // GET - bind to the `getOn` method below
  }

  updateService = (message: { value: number} ) => {
    this.platform.log.debug(`[${this.device.name}] Callback state update for Humidity Sensor: ${message.value}`);
    this.State.CurrentRelativeHumidity = message.value;

    //also make sure this change is directly communicated to HomeKit
    this.service!
      .getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .updateValue(this.State.CurrentRelativeHumidity);
  };

  handleCurrentRelativeHumidityGet() {
    this.platform.log.debug('Triggered GET CurrentRelativeHumidity');
    return this.State.CurrentRelativeHumidity;
  }


}