import type { Service } from 'hap-nodejs';
import type { LoxoneHomeKit } from '../../LoxoneHomeKit';
import type { HomeKitAccessory } from '../../HomeKitHost';

/**
 * A standalone HomeKit Doorbell service. `triggerDoorbell()` fires a single-press
 * ProgrammableSwitchEvent (called by the intercom binder on the `bell` state and
 * by snapshot motion). Kept as camera-side glue — driven by the binding engine.
 */
export class Doorbell {
  service?: Service;
  private programmableSwitchEvent = 0;

  constructor(
    private readonly platform: LoxoneHomeKit,
    private readonly accessory: HomeKitAccessory,
  ) {
    this.service =
      this.accessory.getService(this.platform.Service.Doorbell) ??
      this.accessory.addService(this.platform.Service.Doorbell);
    this.service
      .getCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent)
      .onGet(() => this.programmableSwitchEvent);
  }

  triggerDoorbell(): void {
    this.platform.log.info(`[${this.accessory.displayName}] 🔔 Doorbell event triggered`);
    this.programmableSwitchEvent = this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS;
    this.service?.updateCharacteristic(
      this.platform.Characteristic.ProgrammableSwitchEvent,
      this.programmableSwitchEvent,
    );
  }
}
