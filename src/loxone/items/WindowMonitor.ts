import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Window } from './Window';

/**
 * Loxone WindowMonitor Item
*/
export class WindowMonitor extends LoxoneAccessory {

  isSupported(): boolean {

    // This item is a collection of Windows and doors.
    // They will be registered as individual items in HomeKit.
    this.registerWindowItems();

    return false;
  }

  // Create individual WindowItems
  registerWindowItems(): void {
    for (const windowKey in this.device.details.windows) {
      const window = this.device.details.windows[windowKey];

      const windowItem = { ...this.device };
      windowItem.name = window.name;
      windowItem.type = 'Window';
      windowItem.details = {};

      new Window(this.platform, windowItem);
    }
  }
}