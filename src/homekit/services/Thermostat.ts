import { BaseService } from './BaseService';

/**
 * Thermostat service implementation.
 */
export class Thermostat extends BaseService {

  // Epoch time for January 1, 2009 (in seconds)
  LoxoneEpoch = new Date('2009-01-01T00:00:00Z').getTime() / 1000;

  State = {
    CurrentHeatingCoolingState: 0, // 0 = Off / 1 = Heat / 2 = Cool
    TargetHeatingCoolingState: 3, // 0 = Off / 1 = Heat / 2 = Cool / 3 = Auto
    CurrentTemperature: 15,
    TargetTemperature: 15,
    TemperatureDisplayUnits: this.platform.msInfo.tempUnit, // The temperature unit in use by this Miniserver
  };

  setupService() {
    this.service =
      this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat);

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onGet(this.handleTargetTemperatureGet.bind(this))
      .onSet(this.handleTargetTemperatureSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(this.handleTemperatureDisplayUnitsGet.bind(this));
    //.onSet(this.handleTemperatureDisplayUnitsSet.bind(this));
  }

  updateService( message: { state: string; value: number} ) {
    this.platform.log.debug(`[${this.device.name}] Callback ${message.state} update for Thermostat: ${message.value}`);

    switch (message.state) {
      case 'operatingMode':
        switch (message.value) {
          case 0:
          case 3:
            this.State.TargetHeatingCoolingState = 3;
            break;
          case 1:
          case 4:
            this.State.TargetHeatingCoolingState = 1;
            break;
          case 2:
          case 5:
            this.State.TargetHeatingCoolingState = 2;
            break;
        }
        break;

      case 'tempActual':
        this.State.CurrentTemperature = this.limitHomeKitTemperature(message.value);
        this.updateCharacteristicValue('CurrentTemperature', this.State.CurrentTemperature);
        this.State.CurrentHeatingCoolingState = (this.State.CurrentTemperature < this.State.TargetTemperature) ? 1 : 0;
        break;
      case 'tempTarget':
        this.State.TargetTemperature = this.limitHomeKitTemperature(message.value);
        this.updateCharacteristicValue('TargetTemperature', this.State.TargetTemperature);
        this.State.CurrentHeatingCoolingState = (this.State.CurrentTemperature < this.State.TargetTemperature) ? 1 : 0;
        break;
    }
  }

  private limitHomeKitTemperature(temp: number) {
    temp = (temp < 10) ? 10 : temp;
    temp = (temp > 38) ? 38 : temp;
    return temp;
  }

  /**
   * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
   */
  handleCurrentHeatingCoolingStateGet() {
    this.platform.log.debug(`[${this.device.name}] Triggered GET CurrentHeatingCoolingState`);
    return this.State.CurrentHeatingCoolingState;
  }

  /**
   * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
   */
  handleTargetHeatingCoolingStateGet() {
    this.platform.log.debug(`[${this.device.name}] Triggered GET TargetHeatingCoolingState`);
    return this.State.TargetHeatingCoolingState;
  }

  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  handleTargetHeatingCoolingStateSet(value) {
    this.platform.log.debug(`[${this.device.name}] Triggered SET TargetHeatingCoolingState: ${value}`);
    // Todo: Set from homekit
  }

  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  handleCurrentTemperatureGet() {
    this.platform.log.debug(`[${this.device.name}] Triggered GET CurrentTemperature`);
    return this.State.CurrentTemperature;
  }

  /**
   * Handle requests to get the current value of the "Target Temperature" characteristic
   */
  handleTargetTemperatureGet() {
    this.platform.log.debug(`[${this.device.name}] Triggered GET TargetTemperature`);
    return this.State.TargetTemperature;
  }

  /**
   * Handle requests to set the "Target Temperature" characteristic
   */
  handleTargetTemperatureSet(value) {

    // Get the current date and time
    const currentDate = new Date();
    const nextDayAtMidnight = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1, 0, 0, 0);
    const nextDayAtMidnightInSeconds = nextDayAtMidnight.getTime() / 1000;

    // Calculate the difference between the Loxone Epoch and the next day at 12 am
    const secondsDifference = nextDayAtMidnightInSeconds - this.LoxoneEpoch;

    // This will trigger an override on the Heating Schedule
    this.platform.log.debug(`[${this.device.name}] Triggered SET TargetTemperature:${value}`);
    const command = `override/3/[${secondsDifference}]/${value}`;
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);
  }

  /**
   * Handle requests to get the current value of the "Temperature Display Units" characteristic
   */
  handleTemperatureDisplayUnitsGet() {
    this.platform.log.debug(`[${this.device.name}] Triggered GET TemperatureDisplayUnits`);
    return this.State.TemperatureDisplayUnits;
  }
}