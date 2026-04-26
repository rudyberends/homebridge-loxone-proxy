import { LoxoneAccessory } from '../../LoxoneAccessory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';

/**
 * Loxone UpDownDigital Item
*/
export class UpDownDigital extends LoxoneAccessory {

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    return this.createSingleServicePlan(uuid, {
      id: 'PrimaryService',
      kind: 'window-covering',
      commands: {
        setTargetPosition: { action: (value: unknown) => `manualPosition/${value}` },
        setTargetHorizontalTiltAngle: { action: (value: unknown) => `manualLamelle/${value}` },
      },
    }, {
      [this.device.states.active]: {'service': 'PrimaryService', 'state': 'active'},
    });
  }

  callBackHandler(message: { uuid: string; state: string; service: string; value: string | number }): void {
    this.platform.log.debug(`[${this.device.name}] UpDownDigital callback: ${message.value}`);
  }
}
