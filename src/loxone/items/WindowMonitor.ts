import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Contact } from './Contact';

/**
 * Loxone WindowMonitor Item
*/
export class WindowMonitor extends LoxoneAccessory {

  protected beforeSetup(): void {
    // This item is a collection of Windows and doors.
    // They will be registered as individual items in HomeKit.
    this.registerContactItems();
  }

  isSupported(): boolean {
    return false; // the item itself will not be mapped.
  }

  // Create individual WindowItems
  registerContactItems(): void {
    const windows = this.device.details.windows ?? [];

    windows.forEach((window, index) => {
      const windowItem = { ...this.device };
      windowItem.name = window.name;
      windowItem.type = 'Contact';
      windowItem.cat = String(index); // Store ID in CAT field
      windowItem.details = {};
      windowItem.uuidAction = windowItem.uuidAction + '/' + index;

      new Contact(this.platform, windowItem);
    });
  }
}
