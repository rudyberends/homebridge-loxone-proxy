import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Doorbell } from '../../homekit/services/Doorbell';
import { MotionSensor } from '../../homekit/services/MotionSensor';

/**
 * NfcCodeTouch Item
*/
export class NfcCodeTouch extends LoxoneAccessory {

  configureServices(): void {
    console.log('!!!!!')
    console.log('!!!!!')
    const mapping = this.platform.config.Advanced.NfcCodeTouchMapping;
    this.platform.log.debug('Configuring NfcCodeTouch with mapping:', mapping);

    if (mapping === 'DoorBell') {
      this.initializeDoorbellService();
    } else {
      this.initializeMotionSensorService();
    }
  }

  private initializeDoorbellService(): void {
    this.ItemStates = {
      [this.device.states.events]: { 'service': 'PrimaryService', 'state': 'bell' },
    };
    this.Service.PrimaryService = new Doorbell(this.platform, this.Accessory!);
    this.platform.log.debug('Doorbell service initialized.');
  }

  private initializeMotionSensorService(): void {
    this.ItemStates = {
      [this.device.states.events]: { 'service': 'PrimaryService', 'state': 'MotionDetected' },
    };
    this.Service.PrimaryService = new MotionSensor(this.platform, this.Accessory!);
    this.platform.log.debug('MotionSensor service initialized.');
  }
}
