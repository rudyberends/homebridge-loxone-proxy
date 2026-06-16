import type { PlatformAccessory, Service, WithUUID } from 'homebridge';
import type {
  AlarmControl,
  AudioZoneV2Control,
  ColorPickerV2Control,
  ControlHandle,
  DimmerControl,
  GateControl,
  InfoOnlyAnalogControl,
  InfoOnlyDigitalControl,
  IntercomControl,
  IntercomV2Control,
  IrrigationControl,
  IRoomControllerV2Control,
  JalousieControl,
  LightControllerV2Control,
  LoxoneClient,
  NfcCodeTouchControl,
  PresenceDetectorControl,
  PushbuttonControl,
  RadioControl,
  SmokeAlarmControl,
  SwitchControl,
  VentilationControl,
  WindowControl,
  WindowMonitorControl,
} from 'loxone-ts-client';
import type { LoxonePlatform } from '../LoxonePlatform';
import { bindCharacteristics } from './BindingEngine';
import { bindColorPicker } from './binders/colorBinder';
import { bindIntercom } from './binders/intercomBinder';
import { bindIrrigation } from './binders/irrigationBinder';
import { bindNfcCodeTouch } from './binders/nfcCodeTouchBinder';
import { resolveAnalogSensor, resolveDigitalSensor, resolveSwitchService } from './ServiceResolver';
import { alarmBindings } from './tables/alarmBindings';
import { audioBindings } from './tables/audioBindings';
import { contactBindings } from './tables/contactBindings';
import { gateBindings, jalousieBindings, windowBindings } from './tables/coveringBindings';
import { fanBindings } from './tables/fanBindings';
import { dimmerBindings } from './tables/lightingBindings';
import { moodBindings } from './tables/moodBindings';
import { pushbuttonBindings } from './tables/pushbuttonBindings';
import { radioOutputBindings } from './tables/radioBindings';
import { occupancyBindings } from './tables/sensorBindings';
import { smokeAlarmBindings } from './tables/smokeAlarmBindings';
import { thermostatBindings } from './tables/thermostatBindings';

/** One HomeKit service to (build and) bind on a control's accessory. */
export interface ServiceBinding {
  kind: WithUUID<typeof Service>;
  /** Distinguishes multiple services of the same kind on one accessory (fan-outs). */
  subtype?: string;
  /** Per-service name (ConfiguredName) for multi-service accessories. */
  name?: string;
  /** Wires the binding table onto the (already created) service; returns a disposer. */
  bindTo: (service: Service) => () => void;
}

/**
 * Turns a typed control handle into the HomeKit service(s) it should expose.
 * Returns `[]` when the control resolves to nothing (e.g. an unclassified
 * InfoOnlyAnalog), so the coordinator exposes no accessory for it.
 */
export type ControlBinder = (platform: LoxonePlatform, handle: ControlHandle) => ServiceBinding[];

/** One HomeKit accessory a control expands into (a composite control yields several). */
export interface PlannedAccessory {
  /** The Loxone UUID hashed into the HAP accessory id. */
  uuidSource: string;
  /** Control type (for logging / accessory info). */
  type: string;
  /** Base display name (room-prefixed + deduplicated by the name registry). */
  name: string;
  /** Room name. */
  room: string;
  services: ServiceBinding[];
  /**
   * Imperative setup beyond the declarative services — e.g. the intercom
   * camera/HKSV controller. Runs after the services are built; returns a disposer.
   */
  bindAccessory?: (accessory: PlatformAccessory) => () => void;
  /**
   * Whether to remove services not in this plan (default true). Set false for
   * accessories that add services outside the plan (cameras), or the camera
   * controller's own services would be pruned away.
   */
  prune?: boolean;
}

/**
 * A composite control that expands into MULTIPLE accessories (e.g. a
 * LightControllerV2 → a moods accessory plus one accessory per lamp sub-control).
 * Gets the client so it can resolve sub-controls to typed handles.
 */
export type CompositeBinder = (
  platform: LoxonePlatform,
  handle: ControlHandle,
  client: LoxoneClient,
) => PlannedAccessory[];

const switchBinder: ControlBinder = (platform, handle) => {
  const sw = handle as SwitchControl;
  const { kind, table } = resolveSwitchService(platform, sw);
  return [{ kind, bindTo: (service) => bindCharacteristics(platform, service, sw, table) }];
};

const infoOnlyAnalogBinder: ControlBinder = (platform, handle) => {
  const sensor = handle as InfoOnlyAnalogControl;
  const resolved = resolveAnalogSensor(platform, sensor);
  if (!resolved) {
    return [];
  }
  return [{ kind: resolved.kind, bindTo: (service) => bindCharacteristics(platform, service, sensor, resolved.table) }];
};

const infoOnlyDigitalBinder: ControlBinder = (platform, handle) => {
  const sensor = handle as InfoOnlyDigitalControl;
  const resolved = resolveDigitalSensor(platform, sensor);
  if (!resolved) {
    return [];
  }
  return [{ kind: resolved.kind, bindTo: (service) => bindCharacteristics(platform, service, sensor, resolved.table) }];
};

const presenceDetectorBinder: ControlBinder = (platform, handle) => {
  const sensor = handle as PresenceDetectorControl;
  return [{
    kind: platform.Service.OccupancySensor,
    bindTo: (service) => bindCharacteristics(platform, service, sensor, occupancyBindings),
  }];
};

const jalousieBinder: ControlBinder = (platform, handle) => {
  const jalousie = handle as JalousieControl;
  const isBlinds = jalousie.control.details['animation'] === 0;
  return [{
    kind: platform.Service.WindowCovering,
    bindTo: (service) => bindCharacteristics(platform, service, jalousie, jalousieBindings(isBlinds)),
  }];
};

const windowBinder: ControlBinder = (platform, handle) => {
  const window = handle as WindowControl;
  return [{
    kind: platform.Service.Window,
    bindTo: (service) => bindCharacteristics(platform, service, window, windowBindings),
  }];
};

const gateBinder: ControlBinder = (platform, handle) => {
  const gate = handle as GateControl;
  return [{
    kind: platform.Service.GarageDoorOpener,
    bindTo: (service) => bindCharacteristics(platform, service, gate, gateBindings),
  }];
};

// Dimmer and EIBDimmer share one table (EIBDimmerControl extends DimmerControl).
const dimmerBinder: ControlBinder = (platform, handle) => {
  const dimmer = handle as DimmerControl;
  return [{
    kind: platform.Service.Lightbulb,
    bindTo: (service) => bindCharacteristics(platform, service, dimmer, dimmerBindings),
  }];
};

const colorPickerBinder: ControlBinder = (platform, handle) => {
  const color = handle as ColorPickerV2Control;
  return [{
    kind: platform.Service.Lightbulb,
    bindTo: (service) => bindColorPicker(platform, service, color),
  }];
};

const thermostatBinder: ControlBinder = (platform, handle) => {
  const thermostat = handle as IRoomControllerV2Control;
  const displayUnits = platform.getTemperatureDisplayUnit();
  return [{
    kind: platform.Service.Thermostat,
    bindTo: (service) => bindCharacteristics(platform, service, thermostat, thermostatBindings(displayUnits)),
  }];
};

const alarmBinder: ControlBinder = (platform, handle) => {
  const alarm = handle as AlarmControl;
  return [{
    kind: platform.Service.SecuritySystem,
    bindTo: (service) => bindCharacteristics(platform, service, alarm, alarmBindings),
  }];
};

const ventilationBinder: ControlBinder = (platform, handle) => {
  const fan = handle as VentilationControl;
  const manualSeconds = Number(platform.config.Advanced?.VentilationManualSeconds) || 3600;
  const memory = { lastOnSpeed: 100 };
  return [{
    kind: platform.Service.Fanv2,
    bindTo: (service) => bindCharacteristics(platform, service, fan, fanBindings(manualSeconds, memory)),
  }];
};

// AudioZoneV2 (Audioserver zone) → SmartSpeaker: transport (play/pause/stop) + volume.
const audioZoneBinder: ControlBinder = (platform, handle) => {
  const audio = handle as AudioZoneV2Control;
  return [{
    kind: platform.Service.SmartSpeaker,
    bindTo: (service) => bindCharacteristics(platform, service, audio, audioBindings),
  }];
};

const pushbuttonBinder: ControlBinder = (platform, handle) => {
  const button = handle as PushbuttonControl;
  return [{
    kind: platform.Service.Switch,
    bindTo: (service) => bindCharacteristics(platform, service, button, pushbuttonBindings),
  }];
};

const nfcCodeTouchBinder: ControlBinder = (platform, handle) => {
  const nfc = handle as NfcCodeTouchControl;
  const mapping = platform.config.Advanced?.NfcCodeTouchMapping === 'MotionSensor' ? 'MotionSensor' : 'DoorBell';
  const kind = mapping === 'MotionSensor' ? platform.Service.MotionSensor : platform.Service.Doorbell;
  return [{ kind, bindTo: (service) => bindNfcCodeTouch(platform, service, nfc, mapping) }];
};

// Radio → one accessory with a Switch per output, plus an "All Off" (output 0).
const radioBinder: ControlBinder = (platform, handle) => {
  const radio = handle as RadioControl;
  const details = radio.control.details;
  const outputs = (details['outputs'] ?? {}) as Record<string, unknown>;
  const allOff = typeof details['allOff'] === 'string' ? details['allOff'] : 'All Off';
  const room = radio.roomName ?? 'Unassigned';

  const entries: Array<{ id: number; name: string }> = [{ id: 0, name: allOff }];
  for (const [key, value] of Object.entries(outputs)) {
    const id = Number(key);
    if (id > 0) {
      entries.push({ id, name: typeof value === 'string' ? value : `Output ${id}` });
    }
  }

  return entries.map((entry) => ({
    kind: platform.Service.Switch,
    subtype: `radio:${entry.id}`,
    name: platform.generateUniqueName(room, entry.name, undefined, true),
    bindTo: (service) => bindCharacteristics(platform, service, radio, radioOutputBindings(entry.id)),
  }));
};

// SmokeAlarm → SmokeSensor and/or LeakSensor depending on details.availableAlarms.
const smokeAlarmBinder: ControlBinder = (platform, handle) => {
  const alarm = handle as SmokeAlarmControl;
  const available = Number(alarm.control.details['availableAlarms']) || 0;
  const monitorsWater = (available & 0x02) !== 0;
  const monitorsSmoke = (available & 0x01) !== 0 || !monitorsWater; // default to smoke

  const services: ServiceBinding[] = [];
  if (monitorsSmoke) {
    services.push({
      kind: platform.Service.SmokeSensor,
      subtype: 'smoke',
      bindTo: (service) => bindCharacteristics(platform, service, alarm, smokeAlarmBindings('smoke', monitorsWater)),
    });
  }
  if (monitorsWater) {
    services.push({
      kind: platform.Service.LeakSensor,
      subtype: 'water',
      bindTo: (service) => bindCharacteristics(platform, service, alarm, smokeAlarmBindings('water', monitorsWater)),
    });
  }
  return services;
};

// WindowMonitor → one accessory with a ContactSensor per monitored window/door.
const windowMonitorBinder: ControlBinder = (platform, handle) => {
  const monitor = handle as WindowMonitorControl;
  const names = monitor.windows ?? [];
  const room = monitor.roomName ?? 'Unassigned';

  return names.map((windowName, index) => ({
    kind: platform.Service.ContactSensor,
    subtype: `window:${index}`,
    name: platform.generateUniqueName(room, windowName || `Window ${index + 1}`, undefined, true),
    bindTo: (service) => bindCharacteristics(platform, service, monitor, contactBindings(index)),
  }));
};

/**
 * The strangler boundary: control types now owned by the binding engine
 * (loxone-ts-client), keyed by their Loxone `type`. Adding an entry both routes
 * the type through the engine and (via {@link MIGRATED_CONTROL_TYPES}) tells the
 * legacy mapper to skip it. Grows one type at a time.
 */
export const CONTROL_BINDERS: Readonly<Record<string, ControlBinder>> = {
  Switch: switchBinder,
  InfoOnlyAnalog: infoOnlyAnalogBinder,
  InfoOnlyDigital: infoOnlyDigitalBinder,
  PresenceDetector: presenceDetectorBinder,
  Jalousie: jalousieBinder,
  Window: windowBinder,
  Gate: gateBinder,
  Dimmer: dimmerBinder,
  EIBDimmer: dimmerBinder,
  ColorPickerV2: colorPickerBinder,
  IRoomControllerV2: thermostatBinder,
  Alarm: alarmBinder,
  AudioZoneV2: audioZoneBinder,
  Ventilation: ventilationBinder,
  Pushbutton: pushbuttonBinder,
  NfcCodeTouch: nfcCodeTouchBinder,
  Radio: radioBinder,
  SmokeAlarm: smokeAlarmBinder,
  WindowMonitor: windowMonitorBinder,
};

// LightControllerV2 → a "Moods" accessory (mood switches) plus one accessory per
// lamp sub-control (master excluded), reusing the scalar binders for the lamps.
const lightControllerComposite: CompositeBinder = (platform, handle, client) => {
  const lc = handle as LightControllerV2Control;
  const room = lc.roomName ?? 'Unassigned';
  const planned: PlannedAccessory[] = [];

  // Mood switches on the controller's own accessory (gated by config, like the legacy item).
  if (platform.config.options?.MoodSwitches === 'enabled') {
    // moodId 0 and 778 are the "all off" moods, not real scenes.
    const moods = (lc.moods ?? []).filter((mood) => mood.id !== 0 && mood.id !== 778);
    if (moods.length > 0) {
      planned.push({
        uuidSource: lc.uuid,
        type: 'LightControllerV2',
        name: 'Moods',
        room,
        services: moods.map((mood) => ({
          kind: platform.Service.Switch,
          subtype: `mood:${mood.id}`,
          name: String(mood.name),
          bindTo: (service) => bindCharacteristics(platform, service, lc, moodBindings(mood.id)),
        })),
      });
    }
  }

  // Each lamp sub-control becomes its own accessory via the scalar binders (master excluded).
  const masterUuid = lc.masterDimmerUuid;
  for (const sub of lc.control.subControls.values()) {
    if (sub.uuidAction === masterUuid) {
      continue;
    }
    const subHandle = client.item(sub);
    const subBinder = subHandle ? CONTROL_BINDERS[subHandle.type] : undefined;
    if (!subHandle || !subBinder) {
      continue;
    }
    planned.push({
      uuidSource: sub.uuid,
      type: subHandle.type,
      name: subHandle.name,
      room,
      services: subBinder(platform, subHandle),
    });
  }

  return planned;
};

// Intercom → one accessory: a Doorbell + door-release switches + the camera/HKSV
// controller (the camera glue stays; see ./binders/intercomBinder). prune is off
// because the camera controller adds its own services outside the plan.
const intercomComposite: CompositeBinder = (platform, handle, client) => {
  const control = handle as IntercomControl;
  return [{
    uuidSource: control.uuid,
    type: 'Intercom',
    name: control.name,
    room: control.roomName ?? 'Unassigned',
    services: [],
    bindAccessory: (accessory: PlatformAccessory) => bindIntercom(platform, accessory, control, client, false),
    prune: false,
  }];
};

const intercomV2Composite: CompositeBinder = (platform, handle, client) => {
  const control = handle as IntercomV2Control;
  return [{
    uuidSource: control.uuid,
    type: 'IntercomV2',
    name: control.name,
    room: control.roomName ?? 'Unassigned',
    services: [],
    bindAccessory: (accessory: PlatformAccessory) => bindIntercom(platform, accessory, control, client, true),
    prune: false,
  }];
};

// Irrigation → one accessory: an IrrigationSystem container + a Valve per zone,
// with live-driven Active/RemainingDuration (stateful timers in the binder).
const irrigationComposite: CompositeBinder = (platform, handle) => {
  const control = handle as IrrigationControl;
  return [{
    uuidSource: control.uuid,
    type: 'Irrigation',
    name: control.name,
    room: control.roomName ?? 'Unassigned',
    services: [],
    bindAccessory: (accessory: PlatformAccessory) => bindIrrigation(platform, accessory, control),
    prune: false,
  }];
};

/** Composite controls that expand into several accessories. */
export const COMPOSITE_BINDERS: Readonly<Record<string, CompositeBinder>> = {
  LightControllerV2: lightControllerComposite,
  Intercom: intercomComposite,
  IntercomV2: intercomV2Composite,
  Irrigation: irrigationComposite,
};

/** Control types handled by the binding engine; the legacy mapper skips these. */
export const MIGRATED_CONTROL_TYPES: ReadonlySet<string> = new Set<string>([
  ...Object.keys(CONTROL_BINDERS),
  ...Object.keys(COMPOSITE_BINDERS),
]);
