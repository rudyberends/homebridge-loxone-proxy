import { LoxoneAccessory } from '../../LoxoneAccessory';
import { AccessoryPlan } from '../../platform/AccessoryPlan';

/**
 * Loxone ColorPickerV2 Item
*/
export class ColorPickerV2 extends LoxoneAccessory {

  protected createAccessoryPlan(uuid: string): AccessoryPlan {
    return this.createSingleServicePlan(uuid, {
      id: 'PrimaryService',
      kind: 'color-lightbulb',
      commands: {
        setColorState: {
          action: (value: unknown) => buildColorCommand(value),
        },
      },
    }, {
      [this.device.states.color]: {'service': 'PrimaryService', 'state': 'color'},
    });
  }
}

function buildColorCommand(value: unknown): string | undefined {
  const state = value as {
    mode?: 'color' | 'colortemperature';
    Brightness?: number;
    Hue?: number;
    Saturation?: number;
    ColorTemperature?: number;
  };

  if (state.mode === 'colortemperature') {
    return `temp(${state.Brightness ?? 0},${homekitToLoxoneColorTemperature(state.ColorTemperature ?? 153)})`;
  }

  return `hsv(${state.Hue ?? 0},${state.Saturation ?? 0},${state.Brightness ?? 0})`;
}

function homekitToLoxoneColorTemperature(ct: number): number {
  const percent = 1 - ((ct - 153) / (500 - 153));
  return Math.round(2700 + ((6500 - 2700) * percent));
}
