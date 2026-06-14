import { LoxoneAccessory } from '../../LoxoneAccessory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';

/**
 * Loxone Pushbutton Item (Push Button / Scene / Virtual Input pushbutton).
 *
 * A pushbutton is momentary, not a latching switch. Per the Structure File the
 * primary command is `pulse` (a short tap); `on`/`off` are only for press-and-
 * hold. Expose it as a HomeKit switch whose ON tap pulses the button and whose
 * OFF sends nothing — the Loxone `active` state pulses back so the switch
 * self-resets. (Previously a bare alias of Switch, which latched with On/Off and
 * never fired `pulse`, so scenes/pushbuttons did not trigger momentarily.)
 */
export class Pushbutton extends LoxoneAccessory {

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    return this.createSingleServicePlan(uuid, {
      id: 'PrimaryService',
      kind: 'switch',
      commands: {
        setOn: { action: (value: unknown) => (value ? 'pulse' : undefined) },
      },
    }, {
      [this.device.states.active]: { service: 'PrimaryService', state: 'active' },
    });
  }
}
