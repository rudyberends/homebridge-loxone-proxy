import { LoxoneAccessory } from '../../LoxoneAccessory';
import { HomeKitServiceKind } from '../../homekit/HomeKitServiceFactory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';

/**
 * NfcCodeTouch Item
 */
type NfcCodeTouchMapping = 'DoorBell' | 'MotionSensor';

export class NfcCodeTouch extends LoxoneAccessory {

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    const mapping: NfcCodeTouchMapping = this.platform.config.Advanced.NfcCodeTouchMapping;
    this.platform.log.debug('Configuring NfcCodeTouch with mapping:', mapping);

    const kind: HomeKitServiceKind = mapping === 'DoorBell' ? 'doorbell' : 'motion-sensor';

    return this.createSingleServicePlan(uuid, { id: 'PrimaryService', kind }, {
      [this.device.states.events]: { 'service': 'PrimaryService', 'state': 'events' },
    });
  }
}
