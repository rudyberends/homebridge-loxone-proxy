import { CharacteristicValue } from 'homebridge';
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

  /**
     * Sets the switch state.
     * @param value - The switch state value to set.
     */
  async setOn(value: CharacteristicValue): Promise<void> {

    const newID = value === true ? (this.secondaryService?.cat as string) : '0';

    this.platform.log.debug(`[${this.device.name}] MoodSwitch update from Homekit ->`, value);

    const command = `changeTo/${newID}`;
    this.platform.log.debug(`[${this.device.name}] Send command to Loxone: ${command}`);
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);
  }
}