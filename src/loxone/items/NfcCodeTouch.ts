import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Doorbell } from '../../homekit/services/Doorbell';
import { MotionSensor } from '../../homekit/services/MotionSensor';

/**
 * NfcCodeTouch Item
 */
type NfcCodeTouchMapping = 'DoorBell' | 'MotionSensor';

export class NfcCodeTouch extends LoxoneAccessory {

  configureServices(): void {
    const mapping: NfcCodeTouchMapping = this.platform.config.Advanced.NfcCodeTouchMapping;
    this.platform.log.debug('Configuring NfcCodeTouch with mapping:', mapping);

    // Dynamically initialize the service based on the mapping
    this.initializeService(mapping);
  }

  private initializeService(mapping: NfcCodeTouchMapping): void {
    const serviceClass = mapping === 'DoorBell' ? Doorbell : MotionSensor;
    this.ItemStates = {
      [this.device.states.events]: { 'service': 'PrimaryService', 'state': 'events' },
    };
    this.Service.PrimaryService = new serviceClass(this.platform, this.Accessory!);
    this.platform.log.debug(`${serviceClass.name} service initialized.`);
  }
}
