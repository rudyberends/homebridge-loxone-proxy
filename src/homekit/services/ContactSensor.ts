import { CharacteristicValue } from 'homebridge';
import { LoxoneUpdateMessage } from '../../loxone/LoxoneTypes';
import { BaseService } from './BaseService';

export class ContactSensor extends BaseService {
  State = {
    ContactSensorState: 0,
  };

  /**
   * Sets up the ContactSensor service.
   */
  setupService(): void {

    this.service =
      this.accessory.getService(this.platform.Service.ContactSensor) ||
      this.accessory.addService(this.platform.Service.ContactSensor);

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(this.getOn.bind(this));
  }

  /**
   * Updates the service with the new contactsensor state.
   * @param message - The message containing the new contactsensor state.
   */
  updateService(message: LoxoneUpdateMessage): void {
    // windowStates carries one comma-separated entry per window in the parent
    // WindowMonitor; pick the entry for this accessory's window index.
    const valuesArray = String(message.value).split(',');
    const itemEntry = valuesArray[this.device.details.windowIndex ?? 0];

    this.platform.log.debug(`[${this.device.name}] Callback state update for ContactSensor: ${itemEntry}`);

    // windowStates is a bitmask, not an exact value:
    //   0 = offline/unknown, 1 = closed, 2 = tilted, 4 = open, 8 = locked, 16 = unlocked.
    // A door can therefore report e.g. 9 (closed+locked) or 17 (closed+unlocked);
    // matching exact '1'/'8' wrongly reported those as Open.
    const bits = Number(itemEntry) || 0;
    if (bits === 0) {
      this.platform.log.debug(`[${this.device.name}] windowStates offline/unknown; keeping previous contact state`);
      return;
    }

    // Closed only when the closed bit is set and neither tilted nor open; the
    // lock bits (8/16) are ignored for the contact state.
    const isClosed = (bits & 1) !== 0 && (bits & (2 | 4)) === 0;
    this.State.ContactSensorState = isClosed ? 0 : 1; // 0 = CONTACT_DETECTED (closed), 1 = open

    // Also make sure this change is directly communicated to HomeKit
    this.service!.getCharacteristic(this.platform.Characteristic.ContactSensorState).updateValue(this.State.ContactSensorState);
  }

  /**
   * Retrieves the current ContactSensor state.
   * @returns The current ContactSensor state.
   */
  async getOn(): Promise<CharacteristicValue> {
    return this.State.ContactSensorState;
  }
}