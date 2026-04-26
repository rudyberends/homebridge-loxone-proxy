import type { LoxoneItemConstructor } from './LoxoneTypes';
import { Alarm } from './items/Alarm';
import { ColorPickerV2 } from './items/ColorPickerV2';
import { Contact } from './items/Contact';
import { Dimmer } from './items/Dimmer';
import { EIBDimmer } from './items/EIBDimmer';
import { Gate } from './items/Gate';
import { InfoOnlyAnalog } from './items/InfoOnlyAnalog';
import { InfoOnlyDigital } from './items/InfoOnlyDigital';
import { Intercom } from './items/Intercom';
import { IntercomV2 } from './items/IntercomV2';
import { IRoomControllerV2 } from './items/IRoomControllerV2';
import { Irrigation } from './items/Irrigation';
import { Jalousie } from './items/Jalousie';
import { LightControllerV2 } from './items/LightControllerV2';
import { NfcCodeTouch } from './items/NfcCodeTouch';
import { PresenceDetector } from './items/PresenceDetector';
import { Pushbutton } from './items/Pushbutton';
import { Radio } from './items/Radio';
import { Switch } from './items/Switch';
import { UpDownDigital } from './items/UpDownDigital';
import { Ventilation } from './items/Ventilation';
import { Window } from './items/Window';
import { WindowMonitor } from './items/WindowMonitor';

const loxoneItemRegistry: Record<string, LoxoneItemConstructor> = {
  Alarm,
  ColorPickerV2,
  Contact,
  Dimmer,
  EIBDimmer,
  Gate,
  InfoOnlyAnalog,
  InfoOnlyDigital,
  Intercom,
  IntercomV2,
  IRoomControllerV2,
  Irrigation,
  Jalousie,
  LightControllerV2,
  NfcCodeTouch,
  PresenceDetector,
  Pushbutton,
  Radio,
  Switch,
  UpDownDigital,
  Ventilation,
  Window,
  WindowMonitor,
};

export function getLoxoneItemConstructor(type: string): LoxoneItemConstructor | undefined {
  return loxoneItemRegistry[type];
}
