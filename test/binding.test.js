const assert = require('node:assert/strict');
const test = require('node:test');

const { onOffBindings, lockBindings } = require('../dist/binding/tables/switchBindings');
const {
  temperatureBindings,
  humidityBindings,
  lightBindings,
  motionBindings,
  smokeBindings,
  leakBindings,
  occupancyBindings,
} = require('../dist/binding/tables/sensorBindings');
const { jalousieBindings, windowBindings, gateBindings } = require('../dist/binding/tables/coveringBindings');
const { dimmerBindings } = require('../dist/binding/tables/lightingBindings');
const colorMath = require('../dist/binding/colorMath');
const { bindColorPicker } = require('../dist/binding/binders/colorBinder');
const { thermostatBindings } = require('../dist/binding/tables/thermostatBindings');
const { alarmBindings } = require('../dist/binding/tables/alarmBindings');
const { fanBindings } = require('../dist/binding/tables/fanBindings');
const { pushbuttonBindings } = require('../dist/binding/tables/pushbuttonBindings');
const { bindNfcCodeTouch } = require('../dist/binding/binders/nfcCodeTouchBinder');
const { radioOutputBindings } = require('../dist/binding/tables/radioBindings');
const { smokeAlarmBindings } = require('../dist/binding/tables/smokeAlarmBindings');
const { contactBindings } = require('../dist/binding/tables/contactBindings');
const { moodBindings } = require('../dist/binding/tables/moodBindings');
const { COMPOSITE_BINDERS } = require('../dist/binding/ControlBinders');
const { bindCharacteristics } = require('../dist/binding/BindingEngine');
const { LoxoneCommandError } = require('loxone-ts-client');
const {
  resolveSwitchService,
  resolveAnalogSensor,
  resolveDigitalSensor,
} = require('../dist/binding/ServiceResolver');

// A fake typed Switch handle: only the surface ServiceResolver / the tables read.
function makeSwitch(overrides = {}) {
  const setCalls = [];
  const handle = {
    name: overrides.name ?? 'Device',
    isOn: overrides.isOn,
    category: overrides.category, // { type } or undefined
    control: {
      details: overrides.details ?? {},
      categoryIcon: overrides.categoryIcon ?? '',
      defaultIcon: overrides.defaultIcon ?? '',
    },
    set(value) {
      setCalls.push(value);
      return Promise.resolve();
    },
  };
  return { handle, setCalls };
}

test('onOffBindings reads `active` and writes a boolean on/off', async () => {
  assert.equal(onOffBindings.length, 1);
  const [on] = onOffBindings;
  assert.equal(on.char, 'On');
  assert.equal(on.subscribeTo, 'active');

  assert.equal(on.get({ isOn: true }), true);
  assert.equal(on.get({ isOn: false }), false);
  assert.equal(on.get({ isOn: undefined }), false, 'unknown state reads as off');

  const { handle, setCalls } = makeSwitch();
  await on.set(handle, 1);
  await on.set(handle, 0);
  assert.deepEqual(setCalls, [true, false]);
});

test('lockBindings maps HomeKit lock states to Loxone on/off (0=UNSECURED, 1=SECURED)', async () => {
  const rows = lockBindings(false);
  const current = rows.find((r) => r.char === 'LockCurrentState');
  const target = rows.find((r) => r.char === 'LockTargetState');

  // State: the live `active` state drives both current and target.
  assert.equal(current.subscribeTo, 'active');
  assert.equal(target.subscribeTo, 'active');
  assert.equal(current.get({ isOn: true }), 1, 'switch on = SECURED');
  assert.equal(current.get({ isOn: false }), 0, 'switch off = UNSECURED');
  assert.equal(current.set, undefined, 'current state is read-only');

  // Command: UNSECURED(0) -> on, SECURED(1) -> off (matches the legacy Switch item).
  const { handle, setCalls } = makeSwitch();
  await target.set(handle, 0);
  await target.set(handle, 1);
  assert.deepEqual(setCalls, [true, false]);
});

test('lockBindings reversal flips both the reported state and the command', async () => {
  const rows = lockBindings(true);
  const target = rows.find((r) => r.char === 'LockTargetState');

  assert.equal(target.get({ isOn: true }), 0, 'reversed: switch on = UNSECURED');
  assert.equal(target.get({ isOn: false }), 1, 'reversed: switch off = SECURED');

  const { handle, setCalls } = makeSwitch();
  await target.set(handle, 0); // UNSECURED -> off
  await target.set(handle, 1); // SECURED -> on
  assert.deepEqual(setCalls, [false, true]);
});

test('resolveSwitchService picks the HomeKit kind from declared metadata', () => {
  const Service = {
    Switch: { UUID: 'switch' },
    Outlet: { UUID: 'outlet' },
    Lightbulb: { UUID: 'lightbulb' },
    LockMechanism: { UUID: 'lock' },
  };
  const platform = (switchAlias = {}) => ({ Service, config: { switchAlias } });
  const kindOf = (overrides, switchAlias) =>
    resolveSwitchService(platform(switchAlias), makeSwitch(overrides).handle).kind;

  assert.equal(kindOf({}), Service.Switch, 'plain switch');
  assert.equal(kindOf({ category: { type: 'lights' } }), Service.Lightbulb, 'category lights → Lightbulb');
  assert.equal(kindOf({ defaultIcon: 'icons/Outlet.svg' }), Service.Outlet, 'outlet icon');
  assert.equal(kindOf({ categoryIcon: 'Lock' }), Service.LockMechanism, 'lock icon');
  assert.equal(kindOf({ details: { serviceType: 'outlet' } }), Service.Outlet, 'explicit serviceType override');
  assert.equal(kindOf({ name: 'Front Deur', category: { type: 'lights' } }, { Lock: 'deur' }), Service.LockMechanism,
    'alias match wins over category lights');
});

test('resolveSwitchService returns the lock table for a lock and the on/off table otherwise', () => {
  const Service = {
    Switch: { UUID: 'switch' },
    Outlet: { UUID: 'outlet' },
    Lightbulb: { UUID: 'lightbulb' },
    LockMechanism: { UUID: 'lock' },
  };
  const platform = { Service, config: { switchAlias: {} } };

  const plain = resolveSwitchService(platform, makeSwitch().handle);
  assert.equal(plain.table, onOffBindings);

  const lock = resolveSwitchService(platform, makeSwitch({ defaultIcon: 'Lock' }).handle);
  assert.equal(lock.table.length, 2);
  assert.deepEqual(lock.table.map((r) => r.char).sort(), ['LockCurrentState', 'LockTargetState']);
});

// --- sensors -----------------------------------------------------------------

function fakeSensorPlatform(config = {}) {
  const Service = {
    TemperatureSensor: { UUID: 'TemperatureSensor' },
    HumiditySensor: { UUID: 'HumiditySensor' },
    LightSensor: { UUID: 'LightSensor' },
    MotionSensor: { UUID: 'MotionSensor' },
    SmokeSensor: { UUID: 'SmokeSensor' },
    LeakSensor: { UUID: 'LeakSensor' },
  };
  return { Service, config };
}

test('analog sensor tables read `value` (light clamps to the HAP 0.0001 minimum)', () => {
  assert.equal(temperatureBindings[0].char, 'CurrentTemperature');
  assert.equal(temperatureBindings[0].subscribeTo, 'value');
  assert.equal(temperatureBindings[0].get({ value: 21.4 }), 21.4);
  assert.equal(temperatureBindings[0].get({ value: undefined }), 0);

  assert.equal(humidityBindings[0].char, 'CurrentRelativeHumidity');
  assert.equal(humidityBindings[0].get({ value: 55 }), 55);

  assert.equal(lightBindings[0].char, 'CurrentAmbientLightLevel');
  assert.equal(lightBindings[0].get({ value: 300 }), 300);
  assert.equal(lightBindings[0].get({ value: 0 }), 0.0001, 'clamped to HAP minimum');
});

test('digital + occupancy sensor tables read their boolean state', () => {
  assert.equal(motionBindings[0].char, 'MotionDetected');
  assert.equal(motionBindings[0].subscribeTo, 'active');
  assert.equal(motionBindings[0].get({ isActive: true }), true);
  assert.equal(motionBindings[0].get({ isActive: undefined }), false);

  assert.equal(smokeBindings[0].get({ isActive: true }), true);
  assert.equal(leakBindings[0].get({ isActive: false }), false);

  assert.equal(occupancyBindings[0].char, 'OccupancyDetected');
  assert.equal(occupancyBindings[0].get({ active: true }), true);
  assert.equal(occupancyBindings[0].get({ active: undefined }), false);
});

test('resolveAnalogSensor trusts the library sensorKind, then alias, else nothing', () => {
  const platform = fakeSensorPlatform({
    InfoOnlyAnalogAlias: { Temperature: 'temp%', Brightness: 'lux%', Humidity: 'rh%' },
  });
  const sensor = (control, name = 'Sensor') => ({ name, control });

  assert.equal(resolveAnalogSensor(platform, sensor({ sensorKind: 'temperature' })).kind, platform.Service.TemperatureSensor);
  assert.equal(resolveAnalogSensor(platform, sensor({ sensorKind: 'illuminance' })).kind, platform.Service.LightSensor);
  assert.equal(resolveAnalogSensor(platform, sensor({ sensorKind: 'humidity' })).kind, platform.Service.HumiditySensor);

  // The library guard returns undefined for a power "%" / set-point → not exposed
  // (the plugin no longer second-guesses with its own unit === '%' rule).
  assert.equal(resolveAnalogSensor(platform, sensor({ sensorKind: 'power' })), undefined);
  assert.equal(resolveAnalogSensor(platform, sensor({ unit: '%' })), undefined, 'raw % is not auto-humidity');
  // unclassified value but a name alias matches → exposed via the fallback
  assert.equal(resolveAnalogSensor(platform, sensor({}, 'Living temp gauge')).kind, platform.Service.TemperatureSensor);
  // unclassified and no alias → not exposed (matches the legacy "unsupported" skip)
  assert.equal(resolveAnalogSensor(platform, sensor({}, 'Mystery value')), undefined);
});

test('resolveDigitalSensor maps Motion/Smoke/Leak aliases, else nothing', () => {
  const platform = fakeSensorPlatform({
    InfoOnlyDigitalAlias: { Motion: 'beweging%', Smoke: 'rook%', Leak: 'lek%' },
  });
  const sensor = (name) => ({ name });

  assert.equal(resolveDigitalSensor(platform, sensor('Hal beweging')).kind, platform.Service.MotionSensor);
  assert.equal(resolveDigitalSensor(platform, sensor('Keuken rook melder')).kind, platform.Service.SmokeSensor);
  assert.equal(resolveDigitalSensor(platform, sensor('Kelder lek')).kind, platform.Service.LeakSensor);
  assert.equal(resolveDigitalSensor(platform, sensor('Iets anders')), undefined);
});

// --- covering (Jalousie / Window / Gate) -------------------------------------

const row = (table, char) => table.find((r) => r.char === char);

test('jalousieBindings reverses position and exposes tilt only for blinds', async () => {
  const curtain = jalousieBindings(false);
  const blinds = jalousieBindings(true);
  assert.deepEqual(curtain.map((r) => r.char), ['CurrentPosition', 'TargetPosition', 'PositionState', 'ObstructionDetected']);
  assert.equal(blinds.length, 6, 'blinds add two tilt rows');
  assert.ok(row(blinds, 'TargetHorizontalTiltAngle'));

  const pos = row(blinds, 'CurrentPosition');
  assert.equal(pos.get({ position: 0 }), 100, 'Loxone open (0) → HomeKit open (100)');
  assert.equal(pos.get({ position: 1 }), 0, 'Loxone closed (1) → HomeKit closed (0)');
  assert.equal(pos.get({ position: 0.25 }), 75);

  const state = row(blinds, 'PositionState');
  assert.equal(state.get({ isMovingUp: true }), 1, 'INCREASING');
  assert.equal(state.get({ isMovingDown: true }), 0, 'DECREASING');
  assert.equal(state.get({}), 2, 'STOPPED');

  const posCalls = [];
  await row(blinds, 'TargetPosition').set({ setPosition: (n) => { posCalls.push(n); return Promise.resolve(); } }, 75);
  assert.deepEqual(posCalls, [25], 'HomeKit 75 → Loxone manualPosition 25 (reversed)');

  const tilt = row(blinds, 'TargetHorizontalTiltAngle');
  assert.equal(tilt.get({ slatsPosition: 0 }), -90);
  assert.equal(tilt.get({ slatsPosition: 1 }), 90);
  const tiltCalls = [];
  await tilt.set({ setSlats: (n) => { tiltCalls.push(n); return Promise.resolve(); } }, 0);
  assert.deepEqual(tiltCalls, [50], 'HomeKit 0° → Loxone slats 50%');
});

test('windowBindings maps position straight (not reversed) and sets via moveToPosition', async () => {
  assert.equal(row(windowBindings, 'CurrentPosition').get({ position: 0 }), 0);
  assert.equal(row(windowBindings, 'CurrentPosition').get({ position: 1 }), 100);

  const state = row(windowBindings, 'PositionState');
  assert.equal(state.get({ movement: -1 }), 0, 'DECREASING');
  assert.equal(state.get({ movement: 1 }), 1, 'INCREASING');
  assert.equal(state.get({ movement: 0 }), 2, 'STOPPED');

  const target = row(windowBindings, 'TargetPosition');
  assert.equal(target.get({ state: () => ({ numericValue: 0.4 }) }), 40, 'reads raw targetPosition state');
  const calls = [];
  await target.set({ setPosition: (n) => { calls.push(n); return Promise.resolve(); } }, 60);
  assert.deepEqual(calls, [60]);
});

test('gateBindings maps movement/position to door states and opens/closes', async () => {
  const cur = row(gateBindings, 'CurrentDoorState');
  assert.equal(cur.get({ movement: -1, position: 0.5 }), 3, 'CLOSING');
  assert.equal(cur.get({ movement: 1, position: 0.5 }), 2, 'OPENING');
  assert.equal(cur.get({ movement: 0, position: 0 }), 1, 'idle closed');
  assert.equal(cur.get({ movement: 0, position: 1 }), 0, 'idle open');
  assert.equal(cur.get({ movement: 0, position: 0.5 }), 4, 'idle partway = STOPPED');

  const target = row(gateBindings, 'TargetDoorState');
  assert.equal(target.get({ movement: 0, position: 0 }), 1, 'CLOSED');
  assert.equal(target.get({ movement: 0, position: 0.5 }), 0, 'OPEN');

  const calls = [];
  const gate = {
    open: () => { calls.push('open'); return Promise.resolve(); },
    close: () => { calls.push('close'); return Promise.resolve(); },
  };
  await target.set(gate, 0);
  await target.set(gate, 1);
  assert.deepEqual(calls, ['open', 'close']);
});

// --- lighting (Dimmer / EIBDimmer / ColorPickerV2) ---------------------------

test('dimmerBindings derives On + Brightness from position', async () => {
  const on = row(dimmerBindings, 'On');
  assert.equal(on.get({ position: 0 }), false);
  assert.equal(on.get({ position: 42 }), true);

  const bri = row(dimmerBindings, 'Brightness');
  assert.equal(bri.get({ position: 42 }), 42);
  assert.equal(bri.get({ position: undefined }), 0);

  const calls = [];
  const dimmer = {
    on: () => { calls.push('on'); return Promise.resolve(); },
    off: () => { calls.push('off'); return Promise.resolve(); },
    setPosition: (n) => { calls.push(['pos', n]); return Promise.resolve(); },
  };
  await on.set(dimmer, true);
  await on.set(dimmer, false);
  await bri.set(dimmer, 70);
  assert.deepEqual(calls, ['on', 'off', ['pos', 70]]);
});

test('colorMath maps mired↔kelvin endpoints and round-trips', () => {
  assert.equal(colorMath.miredToKelvin(153), 6500);
  assert.equal(colorMath.miredToKelvin(500), 2700);
  assert.equal(colorMath.kelvinToMired(6500), 153);
  assert.equal(colorMath.kelvinToMired(2700), 500);
  const k = colorMath.miredToKelvin(300);
  assert.ok(Math.abs(colorMath.kelvinToMired(k) - 300) <= 1, 'round-trips within rounding');

  const rgb = colorMath.kelvinToRgb(2700);
  assert.equal(rgb.r, 255);
  assert.ok(rgb.b < rgb.r, 'warm light has less blue than red');
  const hsv = colorMath.rgbToHsv(rgb.r, rgb.g, rgb.b);
  assert.ok(hsv.s >= 0 && hsv.s <= 1 && hsv.h >= 0 && hsv.h <= 1);
});

function fakeColorEnv() {
  const chars = {};
  const makeChar = () => ({
    value: undefined, getH: null, setH: null,
    onGet(f) { this.getH = f; return this; },
    onSet(f) { this.setH = f; return this; },
    updateValue(v) { this.value = v; return this; },
  });
  const service = { getCharacteristic: (key) => (chars[key] ??= makeChar()) };
  const Characteristic = { On: 'On', Brightness: 'Brightness', Hue: 'Hue', Saturation: 'Saturation', ColorTemperature: 'ColorTemperature' };
  const platform = { Characteristic, api: { hap: { HapStatusError: class extends Error {}, HAPStatus: {} } } };
  const sent = [];
  const control = {
    color: undefined,
    setRgb: (h, s, v) => { sent.push(['hsv', h, s, v]); return Promise.resolve(); },
    setTemperature: (b, k) => { sent.push(['temp', b, k]); return Promise.resolve(); },
    onState: (_name, fn, opts) => { if (opts && opts.emitCurrent) { fn(); } return () => {}; },
  };
  return { service, chars, platform, control, sent };
}

test('colorBinder accumulates HSV writes and switches to temp mode on ColorTemperature', async () => {
  const env = fakeColorEnv();
  bindColorPicker(env.platform, env.service, env.control);

  await env.chars.Hue.setH(120);
  await env.chars.Saturation.setH(50);
  await env.chars.Brightness.setH(80);
  assert.deepEqual(env.sent.at(-1), ['hsv', 120, 50, 80], 'separate HK writes combine into one hsv()');

  await env.chars.ColorTemperature.setH(153); // coolest mired → 6500K
  assert.deepEqual(env.sent.at(-1), ['temp', 80, 6500], 'ColorTemperature switches to temp mode');
});

test('colorBinder parses an incoming hsv color state into characteristics', () => {
  const env = fakeColorEnv();
  env.control.color = { kind: 'hsv', hue: 200, saturation: 60, brightness: 40 };
  bindColorPicker(env.platform, env.service, env.control); // emitCurrent → applyColor
  assert.equal(env.chars.Hue.value, 200);
  assert.equal(env.chars.Saturation.value, 60);
  assert.equal(env.chars.Brightness.value, 40);
  assert.equal(env.chars.On.value, true);
});

// --- climate / alarm / fan ---------------------------------------------------

test('thermostatBindings clamps temps, maps modes, and overrides on set', async () => {
  const t = thermostatBindings(1);
  assert.equal(row(t, 'TemperatureDisplayUnits').get({}), 1, 'display units passed through');
  assert.equal(row(t, 'CurrentTemperature').get({ temperature: 50 }), 38, 'clamped to 38');
  assert.equal(row(t, 'CurrentTemperature').get({ temperature: 5 }), 10, 'clamped to 10');

  const chc = row(t, 'CurrentHeatingCoolingState');
  assert.equal(chc.get({ temperature: 18, targetTemperature: 21 }), 1, 'below target → HEAT');
  assert.equal(chc.get({ temperature: 22, targetTemperature: 21 }), 0, 'at/above → OFF');

  const thc = row(t, 'TargetHeatingCoolingState');
  assert.equal(thc.get({ operatingMode: -1 }), 0);
  assert.equal(thc.get({ operatingMode: 4 }), 1);
  assert.equal(thc.get({ operatingMode: 5 }), 2);
  assert.equal(thc.get({ operatingMode: 0 }), 3);

  const calls = [];
  await row(t, 'TargetTemperature').set(
    { override: (mode, until, temp) => { calls.push([mode, typeof until, temp]); return Promise.resolve(); } },
    19.5,
  );
  assert.deepEqual(calls, [[3, 'number', 19.5]], 'override modeId 3, numeric until, requested temp');
});

test('alarmBindings maps armed/level/disabledMove to HAP states and arms/disarms', async () => {
  const cur = row(alarmBindings, 'SecuritySystemCurrentState');
  assert.equal(cur.get({ level: 5, armed: true }), 4, 'active level → TRIGGERED');
  assert.equal(cur.get({ level: 0, armed: false }), 3, 'disarmed');
  assert.equal(cur.get({ level: 0, armed: true, disabledMove: false }), 1, 'away');
  assert.equal(cur.get({ level: 0, armed: true, disabledMove: true }), 2, 'night');

  const target = row(alarmBindings, 'SecuritySystemTargetState');
  assert.equal(target.get({ armed: false }), 3);
  assert.equal(target.get({ armed: true, disabledMove: true }), 2);

  const calls = [];
  const alarm = {
    off: () => { calls.push('off'); return Promise.resolve(); },
    delayedOnWithMovement: (m) => { calls.push(['arm', m]); return Promise.resolve(); },
  };
  await target.set(alarm, 3); // disarm
  await target.set(alarm, 0); // home → with movement
  await target.set(alarm, 2); // night → without movement
  assert.deepEqual(calls, ['off', ['arm', true], ['arm', false]]);
});

test('fanBindings derives Active/Speed and restores last speed on a bare on', async () => {
  const memory = { lastOnSpeed: 100 };
  const t = fanBindings(3600, memory);
  assert.equal(row(t, 'Active').get({ speed: 0 }), 0);
  assert.equal(row(t, 'Active').get({ speed: 40 }), 1);

  const speed = row(t, 'RotationSpeed');
  assert.equal(speed.get({ speed: 40 }), 40);
  assert.equal(memory.lastOnSpeed, 40, 'get remembers a running speed');

  const calls = [];
  const fan = {
    speed: 0, mode: 2,
    setTimer: (i, s, m, p) => { calls.push(['timer', i, s, m, p]); return Promise.resolve(); },
    stopTimer: () => { calls.push('stop'); return Promise.resolve(); },
  };
  await speed.set(fan, 0); // → automatic
  await speed.set(fan, 55); // manual at 55 in mode 2
  await row(t, 'Active').set(fan, 1); // bare on → restores lastOnSpeed (now 55)
  assert.deepEqual(calls, ['stop', ['timer', 3600, 55, 2, -1], ['timer', 3600, 55, 2, -1]]);
});

// --- misc scalar (Pushbutton / NfcCodeTouch) ---------------------------------

test('pushbuttonBindings pulses on On=true and sends nothing on Off', async () => {
  const on = row(pushbuttonBindings, 'On');
  assert.equal(on.get({ isActive: true }), true);
  assert.equal(on.get({ isActive: false }), false);

  const calls = [];
  const button = { pulse: () => { calls.push('pulse'); return Promise.resolve(); } };
  await on.set(button, true);
  await on.set(button, false); // momentary: OFF sends nothing
  assert.deepEqual(calls, ['pulse']);
});

function fakeNfcEnv() {
  const updates = [];
  const char = { onGet() { return this; } };
  const service = {
    getCharacteristic: () => char,
    updateCharacteristic: (c, value) => { updates.push([c, value]); return service; },
  };
  const Characteristic = { ProgrammableSwitchEvent: { SINGLE_PRESS: 0 }, MotionDetected: 'MotionDetected' };
  const platform = { Characteristic, log: { debug() {} } };
  let listener = null;
  const control = {
    name: 'NFC', historyDate: 1000,
    onState: (_n, fn, opts) => { listener = fn; if (opts && opts.emitCurrent) { fn(); } return () => {}; },
  };
  return { service, platform, control, updates, fire: (ts) => { control.historyDate = ts; listener(); } };
}

test('nfcCodeTouch doorbell ignores the initial replay then rings on a new entry', () => {
  const env = fakeNfcEnv();
  const dispose = bindNfcCodeTouch(env.platform, env.service, env.control, 'DoorBell');
  assert.equal(env.updates.length, 0, 'replayed initial historyDate does not ring');
  env.fire(2000);
  assert.deepEqual(env.updates, [[env.platform.Characteristic.ProgrammableSwitchEvent, 0]]);
  env.fire(2000); // same timestamp → no duplicate ring
  assert.equal(env.updates.length, 1);
  dispose();
});

test('nfcCodeTouch motion mapping fires MotionDetected on a new entry', () => {
  const env = fakeNfcEnv();
  const dispose = bindNfcCodeTouch(env.platform, env.service, env.control, 'MotionSensor');
  env.fire(2000);
  assert.deepEqual(env.updates[0], ['MotionDetected', true]);
  dispose(); // clears the pending 5s reset timer
});

// --- multi-service fan-outs (Radio / SmokeAlarm / WindowMonitor) -------------

test('radioOutputBindings reflects activeOutput and selects/resets on set', async () => {
  const out3 = radioOutputBindings(3)[0];
  assert.equal(out3.get({ activeOutput: 3 }), true);
  assert.equal(out3.get({ activeOutput: 2 }), false);

  const calls = [];
  const radio = {
    reset: () => { calls.push('reset'); return Promise.resolve(); },
    select: (n) => { calls.push(['select', n]); return Promise.resolve(); },
  };
  await out3.set(radio, true); // select output 3
  await out3.set(radio, false); // exclusive → nothing
  await radioOutputBindings(0)[0].set(radio, true); // All Off → reset
  assert.deepEqual(calls, [['select', 3], 'reset']);
});

test('smokeAlarmBindings decodes smoke-only vs combined cause bits', () => {
  const smokeOnly = smokeAlarmBindings('smoke', false)[0];
  assert.equal(smokeOnly.get({ level: 2, alarmCause: 0 }), true, 'smoke-only: any alarm is smoke');
  assert.equal(smokeOnly.get({ level: 0 }), false);

  const smokeCombined = smokeAlarmBindings('smoke', true)[0];
  assert.equal(smokeCombined.get({ level: 2, alarmCause: 0x01 }), true, 'smoke cause bit set');
  assert.equal(smokeCombined.get({ level: 2, alarmCause: 0x02 }), false, 'water cause only → smoke off');

  const water = smokeAlarmBindings('water', true)[0];
  assert.equal(water.get({ level: 2, alarmCause: 0x02 }), true);
  assert.equal(water.get({ level: 2, alarmCause: 0x01 }), false);
  assert.equal(water.get({ level: 0, alarmCause: 0x02 }), false, 'no alarm level → off');
});

test('contactBindings maps the indexed window status to ContactSensorState', () => {
  const statuses = [
    { open: true, tilted: false },
    { open: false, tilted: false },
    { open: false, tilted: true },
  ];
  assert.equal(contactBindings(0)[0].get({ windowStatuses: statuses }), 1, 'open → 1');
  assert.equal(contactBindings(1)[0].get({ windowStatuses: statuses }), 0, 'closed → 0');
  assert.equal(contactBindings(2)[0].get({ windowStatuses: statuses }), 1, 'tilted → 1');
  assert.equal(contactBindings(0)[0].get({ windowStatuses: undefined }), 0, 'unknown → closed (safe)');
});

// --- the engine (bindCharacteristics) ----------------------------------------

function fakeEngineEnv() {
  const chars = {};
  const makeChar = () => ({
    getHandler: null, setHandler: null, updated: [],
    onGet(fn) { this.getHandler = fn; return this; },
    onSet(fn) { this.setHandler = fn; return this; },
    updateValue(v) { this.updated.push(v); return this; },
  });
  const service = { getCharacteristic: (key) => (chars[key] ??= makeChar()) };
  const hap = {
    HapStatusError: class extends Error { constructor(status) { super('hap'); this.hapStatus = status; } },
    HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402, INSUFFICIENT_PRIVILEGES: -70401 },
  };
  const platform = { Characteristic: { On: 'On' }, api: { hap }, log: { warn() {}, debug() {} } };
  let stateListener = null;
  let unsubscribed = 0;
  const handle = {
    name: 'X',
    onState: (_n, fn, opts) => { stateListener = fn; if (opts && opts.emitCurrent) { fn(); } return () => { unsubscribed += 1; }; },
  };
  return { service, chars, platform, hap, handle, fireState: () => stateListener?.(), unsubCount: () => unsubscribed };
}

test('bindCharacteristics wires onGet/onState and replays the current value on subscribe', () => {
  const env = fakeEngineEnv();
  let value = 5;
  const dispose = bindCharacteristics(env.platform, env.service, env.handle, [
    { char: 'On', get: () => value, subscribeTo: 'active' },
  ]);

  assert.equal(env.chars.On.getHandler(), 5, 'onGet reads get()');
  assert.deepEqual(env.chars.On.updated, [5], 'emitCurrent replayed the current value');

  value = 9;
  env.fireState();
  assert.deepEqual(env.chars.On.updated, [5, 9], 'a state change re-pushes get()');

  dispose();
  assert.equal(env.unsubCount(), 1, 'disposer unsubscribes the state listener');
});

test('bindCharacteristics maps a LoxoneCommandError on write to the right HAP status', async () => {
  const env = fakeEngineEnv();
  bindCharacteristics(env.platform, env.service, env.handle, [
    { char: 'On', get: () => false, set: () => Promise.reject(new LoxoneCommandError('locked', { kind: 'locked' })) },
  ]);
  await assert.rejects(
    () => env.chars.On.setHandler(true),
    (error) => error.hapStatus === env.hap.HAPStatus.INSUFFICIENT_PRIVILEGES,
    'locked → INSUFFICIENT_PRIVILEGES',
  );

  const env2 = fakeEngineEnv();
  bindCharacteristics(env2.platform, env2.service, env2.handle, [
    { char: 'On', get: () => false, set: () => Promise.reject(new LoxoneCommandError('down', { kind: 'comms' })) },
  ]);
  await assert.rejects(
    () => env2.chars.On.setHandler(true),
    (error) => error.hapStatus === env2.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    'comms → SERVICE_COMMUNICATION_FAILURE',
  );
});

// --- composites (LightControllerV2) ------------------------------------------

test('moodBindings reflects the active mood and selects it on On=true', async () => {
  const dinner = moodBindings(7)[0];
  assert.equal(dinner.get({ activeMoods: [7, 9] }), true);
  assert.equal(dinner.get({ activeMoods: [9] }), false);
  assert.equal(dinner.get({ activeMoods: undefined }), false);

  const calls = [];
  const lc = { selectMood: (id) => { calls.push(id); return Promise.resolve(); } };
  await dinner.set(lc, true);
  await dinner.set(lc, false); // moods are exclusive → OFF sends nothing
  assert.deepEqual(calls, [7]);
});

test('LightControllerV2 composite plans a Moods accessory + per-lamp accessories (master excluded)', () => {
  const Service = new Proxy({}, { get: (_t, name) => ({ UUID: String(name) }) });
  const platform = {
    Service,
    config: { options: { MoodSwitches: 'enabled' }, switchAlias: {} },
    generateUniqueName: (room, base) => `${room} ${base}`.trim(),
  };
  const subDimmer = { uuid: 'sub-dim', uuidAction: 'sub-dim', type: 'Dimmer', name: 'Eettafel', roomName: 'Woonkamer' };
  const lc = {
    uuid: 'lc1', roomName: 'Woonkamer', name: 'Verlichting',
    moods: [{ id: 0, name: 'Off' }, { id: 7, name: 'Dinner' }, { id: 778, name: 'AllOff' }],
    masterDimmerUuid: 'master',
    control: {
      subControls: new Map([
        ['sub-dim', { uuid: 'sub-dim', uuidAction: 'sub-dim' }],
        ['master', { uuid: 'master', uuidAction: 'master' }],
      ]),
    },
  };
  const client = { item: (c) => (c.uuid === 'sub-dim' ? subDimmer : null) };

  const planned = COMPOSITE_BINDERS.LightControllerV2(platform, lc, client);

  const moods = planned.find((p) => p.name === 'Moods');
  assert.ok(moods, 'a Moods accessory is planned');
  assert.equal(moods.services.length, 1, 'only the real mood (Off/AllOff filtered)');
  assert.equal(moods.services[0].subtype, 'mood:7');

  const lamp = planned.find((p) => p.uuidSource === 'sub-dim');
  assert.ok(lamp, 'the lamp sub-control becomes its own accessory');
  assert.equal(lamp.type, 'Dimmer');
  assert.ok(!planned.some((p) => p.uuidSource === 'master'), 'the master dimmer is excluded');
});
