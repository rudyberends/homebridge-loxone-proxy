import { CharacteristicValue } from 'homebridge';
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
  updateService(message: { uuid: string; value: string}): void {
    // The value contains the entries for all items in the WindowMonitor. We only need our own entry.
    const valuesArray = message.value.split(',');
    const itemEntry = valuesArray[this.device.cat]; // We saved our ItemEntry in CAT.

    this.platform.log.debug(`[${this.device.name}] Callback state update for ContactSensor: ${itemEntry}`);

    /*
      Each state is a integer value that represents a bitmask where the individual bits correspond to the following states:
      none → state unknown / sensor offline
      1→ closed
      2→ tilted
      4→ open
      8→ locked
      16→ unlocked
    */

    switch (itemEntry) {
      case 1:
      case 8:
        this.State.ContactSensorState = 0; // Closed
        break;
      default:
        this.State.ContactSensorState = 1; // Open
    }

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