import { BaseService } from './BaseService';
import { CameraService } from './Camera';

/**
 * Doorbell Service
 * Represents a doorbell accessory in HomeKit.
 */
export class Doorbell extends BaseService {
  State = {
    ProgrammableSwitchEvent: 0,
  };

  private camera?: CameraService;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(platform: any, accessory: any) {
    super(platform, accessory);
    this.setupService();
  }

  setupService(): void {
    this.service = this.accessory.getService(this.platform.Service.Doorbell) ||
      this.accessory.addService(this.platform.Service.Doorbell);

    this.service.getCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent)
      .onGet(() => this.handleProgrammableSwitchEventGet());
  }

  public triggerDoorbell(): void {
    this.platform.log.info(`[${this.device.name}] 🔔 Doorbell event triggered`);
    this.State.ProgrammableSwitchEvent = this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS;
    this.service?.updateCharacteristic(
      this.platform.Characteristic.ProgrammableSwitchEvent,
      this.State.ProgrammableSwitchEvent,
    );
  }

  updateService(message: { value: number }): void {
    this.platform.log.debug(`[${this.device.name}] Callback state update for Doorbell: ${message.value}`);
    if (message.value === 1) {
      this.triggerDoorbell();
    }
  }

  handleProgrammableSwitchEventGet(): number {
    this.platform.log.debug('Triggered GET ProgrammableSwitchEvent');
    return this.State.ProgrammableSwitchEvent;
  }
}