import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Contact } from './Contact';

/**
 * Loxone WindowMonitor Item
*/
export class WindowMonitor extends LoxoneAccessory {

  isSupported(): boolean {

    // This item is a collection of Windows and doors.
    // They will be registered as individual items in HomeKit.
    this.registerContactItems();

    return false; // the item itself will not be mapped.
  }

  // Create individual WindowItems
  registerContactItems(): void {
    for (const windowKey in this.device.details.windows) {

      const window = this.device.details.windows[windowKey];

      const windowItem = { ...this.device };
      windowItem.name = window.name;
      windowItem.type = 'Contact';
      windowItem.cat = windowKey; // Store ID in CAT field
      windowItem.details = {};
      windowItem.uuidAction = windowItem.uuidAction + '/' + windowKey;

      new Contact(this.platform, windowItem);
    }
  }
}