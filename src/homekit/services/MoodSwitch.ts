import { SwitchService } from './Switch';

export class MoodSwitch extends SwitchService {

  /**
   * Updates the service with the new switch state.
   * @param message - The message containing the new switch state.
   */
  updateService(message: { value: number }): void {
    const moodID: number = parseInt(this.secondaryService?.cat as string);
    this.State.On = message.value === moodID;

    this.platform.log.debug(`[${this.device.name}] Callback state update for MoodSwitch: ${this.State.On}`);

    // Also make sure this change is directly communicated to HomeKit
    this.service!.getCharacteristic(this.platform.Characteristic.On).updateValue(this.State.On);
  }
}