import { Service, PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../LoxonePlatform';
import { Control } from '../structure/LoxAPP3';

export class IRoomControllerV2 {
  private service: Service;
  private device: Control;

  private State = {
    CurrentHeatingCoolingState: 0, // 0 = Off / 1 = Heat / 2 = Cool
    TargetHeatingCoolingState: 3, // 0 = Off / 1 = Heat / 2 = Cool / 3 = auto
    CurrentTemperature: 15,
    TargetTemperature: 15,
    TemperatureDisplayUnits: 0,
  };

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.service =
      this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat);
    this.device = this.accessory.context.device;

    this.initListener();

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

  // Register a listener to be notified of changes in this items value
  initListener = () => {
    this.platform.log.debug(`[${this.device.name}] Register Listener for Thermostat`);
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.tempActual, this.callBacktempActual.bind(this));
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.tempTarget, this.callBacktempTarget.bind(this));
    //this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.activeMode, this.callBackactiveMode.bind(this));
  };

  callBacktempActual = ( message: {uuid: string; value: number} ) => {
    if (message.uuid) {
      this.platform.log.debug(`[${this.device.name}] Callback tempActual update for Thermostat : ${message.value}`);
      this.State.CurrentTemperature = (message.value < 10) ? 10 : message.value;

      //also make sure this change is directly communicated to HomeKit
      this.service
        .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .updateValue(this.State.CurrentTemperature);
    }
  };

  callBacktempTarget = ( message: {uuid: string; value: number} ) => {
    if (message.uuid) {
      this.platform.log.debug(`[${this.device.name}] Callback tempTarget update for Thermostat: ${message.value}`);
      this.State.TargetTemperature = (message.value < 10) ? 10 : message.value;

      //also make sure this change is directly communicated to HomeKit
      this.service
        .getCharacteristic(this.platform.Characteristic.TargetTemperature)
        .updateValue(this.State.TargetTemperature);
    }
  };
  /*
  callBackactiveMode = ( message: {uuid: string; value: number} ) => {
    if (message.uuid) {
      this.platform.log.debug(`[${this.device.name}] Callback ActiveMode update for Thermostat: ${message.value}`);
      this.State.TargetHeatingCoolingState = message.value;

      //also make sure this change is directly communicated to HomeKit
      this.service
        .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
        .updateValue(message.value);
    }
  };
  */

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
    this.platform.log.debug(`[${this.device.name}] Triggered SET TargetTemperature:${value}`);
  }

  /**
   * Handle requests to get the current value of the "Temperature Display Units" characteristic
   */
  handleTemperatureDisplayUnitsGet() {
    this.platform.log.debug(`[${this.device.name}] Triggered GET TemperatureDisplayUnits`);
    return this.State.TemperatureDisplayUnits;
  }
}