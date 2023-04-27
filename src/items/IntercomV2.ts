import { Service, PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../LoxonePlatform';
import { Control } from '../structure/LoxAPP3';
import { Camera } from './Camera';
import { Motion } from './Motion';

export class IntercomV2 {
  private DoorbellService: Service;
  private device: Control;

  private State = {
    ProgrammableSwitchEvent: 0,
  };

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.DoorbellService =
      this.accessory.getService(this.platform.Service.Doorbell) ||
      this.accessory.addService(this.platform.Service.Doorbell);

    this.device = this.accessory.context.device;

    // Loxone Intercom Present??
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.address, (ip: string) => {
      this.platform.log.info(`[${this.device.name}] Found Loxone Intercom on IP: ${ip}`);
      new Camera(this.platform, this.accessory, ip); // Register InterCom Camera
      new Motion(this.platform, this.accessory); // Register InterCom Motion Sensor
    });

    this.LoxoneListener();

    // create handlers for required characteristics
    this.DoorbellService.getCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent)
      .onGet(this.handleProgrammableSwitchEventGet.bind(this));
  }

  // Register a listener to be notified of changes in this items value
  LoxoneListener = () => {
    this.platform.log.debug(`[${this.device.name}] Register Listener for Doorbell`);
    this.platform.LoxoneHandler.registerListenerForUUID(this.device.states.bell, this.callBack.bind(this));
  };

  callBack = ( message: {uuid: string; value: number} ) => {
    if (message.uuid) {
      this.platform.log.debug(`[${this.device.name}] Callback state update for Doorbell: ${message.value}`);
      if (message.value === 1) {
        //also make sure this change is directly communicated to HomeKit
        this.DoorbellService
          .getCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent)
          .updateValue(this.State.ProgrammableSwitchEvent);
      }
    }
  };

  handleProgrammableSwitchEventGet() {
    this.platform.log.debug('Triggered GET ProgrammableSwitchEvent');
    return this.State.ProgrammableSwitchEvent;
  }
}