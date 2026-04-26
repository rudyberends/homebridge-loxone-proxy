const assert = require('node:assert/strict');
const test = require('node:test');

const { AccessoryNameRegistry } = require('../dist/AccessoryNameRegistry');
const {
  normalizeLoxoneConfig,
  validateLoxoneConnectionConfig,
} = require('../dist/LoxoneConfig');
const { LoxoneControlMapper } = require('../dist/loxone/LoxoneControlMapper');
const LoxoneHandler = require('../dist/loxone/LoxoneHandler').default;
const { LoxoneTsApiTransport } = require('../dist/loxone/LoxoneTsApiTransport');
const { Switch } = require('../dist/loxone/items/Switch');
const { Dimmer } = require('../dist/loxone/items/Dimmer');
const { ColorPickerV2 } = require('../dist/loxone/items/ColorPickerV2');
const { Jalousie } = require('../dist/loxone/items/Jalousie');
const { Window } = require('../dist/loxone/items/Window');
const { Alarm } = require('../dist/loxone/items/Alarm');
const { IRoomControllerV2 } = require('../dist/loxone/items/IRoomControllerV2');
const { Irrigation } = require('../dist/loxone/items/Irrigation');
const { Radio } = require('../dist/loxone/items/Radio');
const { LightControllerV2 } = require('../dist/loxone/items/LightControllerV2');
const structureFixture = require('./fixtures/structure-file.basic.json');
const lightingFixture = require('./fixtures/structure-file.lighting.json');
const climateWindowFixture = require('./fixtures/structure-file.climate-window.json');
const largeFilterFixture = require('./fixtures/structure-file.large-filter.json');

function makePlatform(overrides = {}) {
  const platform = {
    config: {
      switchAlias: {},
      roomfilter: {},
      Advanced: {},
      options: { MoodSwitches: 'enabled' },
      host: '127.0.0.1',
      port: 80,
      TLS: false,
      username: 'homebridge',
      password: 'secret',
      ...overrides.config,
    },
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    generateUniqueName: (room, base, uuid) => `${room} ${base}${uuid ? ` ${uuid}` : ''}`,
    stateRouter: {
      getCachedValue: () => undefined,
    },
    ...overrides,
  };

  return platform;
}

function makeControl(overrides = {}) {
  return {
    name: 'Device',
    type: 'Switch',
    uuidAction: 'uuid-action',
    room: 'Kitchen',
    cat: 'lights',
    catIcon: '',
    defaultIcon: '',
    defaultRating: 0,
    isFavorite: false,
    isSecured: false,
    details: {},
    states: {
      active: 'state-active',
      position: 'state-position',
      color: 'state-color',
      up: 'state-up',
      down: 'state-down',
      shadePosition: 'state-shade',
      windowStates: 'state-window',
      armed: 'state-armed',
      level: 'state-level',
      disabledMove: 'state-disabledMove',
      tempActual: 'state-tempActual',
      tempTarget: 'state-tempTarget',
      operatingMode: 'state-operatingMode',
      zones: 'state-zones',
      currentZone: 'state-currentZone',
      activeOutput: 'state-activeOutput',
      activeMoods: 'state-activeMoods',
      moodList: 'state-moodList',
    },
    ...overrides,
  };
}

function planFor(ItemClass, deviceOverrides = {}, platformOverrides = {}) {
  const instance = Object.create(ItemClass.prototype);
  instance.platform = makePlatform(platformOverrides);
  instance.device = makeControl(deviceOverrides);
  instance.ItemStates = {};
  return instance.createAccessoryPlan('plan-uuid');
}

function planForControl(ItemClass, control, platformOverrides = {}) {
  const instance = Object.create(ItemClass.prototype);
  instance.platform = makePlatform(platformOverrides);
  instance.device = control;
  instance.ItemStates = {};
  return instance.createAccessoryPlan('plan-uuid');
}

function command(plan, commandId, value, serviceIndex = 0) {
  const service = plan.services[serviceIndex];
  const binding = service.commands[commandId];
  return typeof binding.action === 'function'
    ? binding.action(value, { device: service.device, service: undefined })
    : binding.action;
}

class FakeTransport {
  constructor(structureFile = structureFixture) {
    this.structureFile = structureFile;
    this.valueListeners = [];
    this.textListeners = [];
    this.disconnectListeners = [];
    this.errorListeners = [];
    this.watched = [];
    this.commands = [];
    this.enabledUpdates = false;
    this.connected = false;
  }

  async connect(existingToken) {
    this.existingToken = existingToken;
    this.connected = true;
  }

  async getStructureFile() {
    return this.structureFile;
  }

  async enableUpdates() {
    this.enabledUpdates = true;
  }

  async sendCommand(uuid, action, timeoutOverride) {
    this.commands.push({ uuid, action, timeoutOverride });
    return { value: `${uuid}/${action}`, toString: () => `${uuid}/${action}` };
  }

  watch(uuid) {
    if (Array.isArray(uuid)) {
      this.watched.push(...uuid);
    } else {
      this.watched.push(uuid);
    }
  }

  getActiveCommunicationToken() {
    return 'transport-token';
  }

  onValueEvent(listener) {
    this.valueListeners.push(listener);
  }

  onTextEvent(listener) {
    this.textListeners.push(listener);
  }

  onDisconnect(listener) {
    this.disconnectListeners.push(listener);
  }

  onError(listener) {
    this.errorListeners.push(listener);
  }

  emitValue(uuid, value) {
    this.valueListeners.forEach((listener) => listener(uuid, value));
  }
}

test('AccessoryNameRegistry sanitizes names and keeps duplicates unique', () => {
  const registry = new AccessoryNameRegistry();

  assert.equal(registry.generate('Living (A)', 'Lamp #1', 'uuid-1'), 'Living A Lamp 1');
  assert.equal(registry.generate('Living (A)', 'Lamp #1', 'uuid-2'), 'Living A Lamp 1 1');
  assert.equal(registry.generate('Living (A)', 'Lamp #1', 'uuid-1'), 'Living A Lamp 1');
});

test('normalizeLoxoneConfig trims exclusions and normalizes room filters', () => {
  const normalized = normalizeLoxoneConfig({
    Exclusions: ' Switch,Dimmer ,, ',
    roomfilter: {
      type: 'inclusion',
      list: ' Kitchen, Living ',
    },
  });

  assert.deepEqual(normalized.excludedTypes, ['Switch', 'Dimmer']);
  assert.deepEqual(normalized.roomFilter, {
    type: 'inclusion',
    rooms: ['kitchen', 'living'],
  });
});

test('validateLoxoneConnectionConfig reports missing credentials and invalid ports', () => {
  assert.deepEqual(validateLoxoneConnectionConfig({
    host: '192.168.1.10',
    username: 'homebridge',
    password: 'secret',
    port: 80,
  }), []);

  assert.deepEqual(validateLoxoneConnectionConfig({
    host: ' ',
    username: '',
    password: undefined,
    port: 70000,
  }), [
    'host is required',
    'username is required',
    'password is required',
    'port must be a number between 1 and 65535',
  ]);
});

test('LoxoneControlMapper prepares room and category metadata without mutating source controls', () => {
  const mapper = new LoxoneControlMapper(makePlatform());
  const sourceControl = makeControl({ room: 'room-1', cat: 'cat-1' });
  const prepared = mapper.prepare({
    msInfo: {},
    rooms: { 'room-1': { name: 'Office' } },
    cats: { 'cat-1': { image: 'light-icon', type: 'lights' } },
    controls: { control: sourceControl },
  });

  assert.equal(prepared.controls.control.room, 'Office');
  assert.equal(prepared.controls.control.cat, 'lights');
  assert.equal(prepared.controls.control.catIcon, 'light-icon');
  assert.equal(sourceControl.room, 'room-1');
});

test('Structure File fixture plans keep command and state boundaries explicit', () => {
  const mapper = new LoxoneControlMapper(makePlatform());
  const prepared = mapper.prepare(structureFixture);

  assert.equal(prepared.controls['ctrl-switch'].room, 'Kitchen');
  assert.equal(prepared.controls['ctrl-switch'].cat, 'lighting');
  assert.equal(prepared.controls['ctrl-jalousie'].catIcon, 'Jalousie');
  assert.equal(structureFixture.controls['ctrl-switch'].room, 'room-kitchen');

  const switchPlan = planForControl(Switch, prepared.controls['ctrl-switch']);
  assert.equal(switchPlan.services[0].device.uuidAction, 'ctrl-switch');
  assert.deepEqual(switchPlan.stateBindings, {
    'state-switch-active': { service: 'PrimaryService', state: 'active' },
  });
  assert.equal(command(switchPlan, 'setOn', true), 'On');

  const dimmerPlan = planForControl(Dimmer, prepared.controls['ctrl-dimmer']);
  assert.equal(dimmerPlan.services[0].device.uuidAction, 'ctrl-dimmer');
  assert.deepEqual(dimmerPlan.stateBindings, {
    'state-dimmer-position': { service: 'PrimaryService', state: 'position' },
  });
  assert.equal(command(dimmerPlan, 'setBrightness', 37), '37');

  const jalousiePlan = planForControl(Jalousie, prepared.controls['ctrl-jalousie']);
  assert.equal(command(jalousiePlan, 'setTargetPosition', 64), 'manualPosition/64');
  assert.equal(command(jalousiePlan, 'setTargetHorizontalTiltAngle', 20), 'manualLamelle/20');
});

test('Lighting fixture keeps LightController moods and child light commands declarative', () => {
  const mapper = new LoxoneControlMapper(makePlatform());
  const prepared = mapper.prepare(lightingFixture);
  const controller = prepared.controls['ctrl-light-controller'];

  assert.equal(controller.room, 'Living');
  assert.equal(controller.cat, 'lighting');
  assert.equal(controller.subControls['ctrl-light-dimmer'].type, 'Dimmer');
  assert.equal(lightingFixture.controls['ctrl-light-controller'].room, 'room-living');

  const lightController = Object.create(LightControllerV2.prototype);
  lightController.platform = makePlatform({
    stateRouter: {
      getCachedValue: () => JSON.stringify([
        { id: 778, name: 'Off' },
        { id: 7, name: 'Dinner' },
        { id: 8, name: 'Reading' },
      ]),
    },
  });
  lightController.device = controller;
  lightController.ItemStates = {};
  const moodPlan = lightController.createAccessoryPlan('light-plan');

  assert.deepEqual(moodPlan.serviceLabels, { namespace: 'arabic-numerals' });
  assert.equal(moodPlan.services.length, 2);
  assert.equal(moodPlan.services[0].commands.setOn.uuid, 'ctrl-light-controller');
  assert.equal(command(moodPlan, 'setOn', true, 0), 'changeTo/7');
  assert.equal(command(moodPlan, 'setOn', true, 1), 'changeTo/8');
  assert.deepEqual(moodPlan.stateBindings, {
    'state-light-active-moods': { service: 'PrimaryService', state: 'activeMoods' },
  });

  const dimmerPlan = planForControl(Dimmer, controller.subControls['ctrl-light-dimmer']);
  assert.equal(command(dimmerPlan, 'setBrightness', 55), '55');

  const colorPlan = planForControl(ColorPickerV2, controller.subControls['ctrl-light-color']);
  assert.equal(command(colorPlan, 'setColorState', {
    mode: 'color',
    Hue: 180,
    Saturation: 60,
    Brightness: 70,
  }), 'hsv(180,60,70)');
});

test('Climate and window fixture covers thermostat, window, and blind edge states', () => {
  const mapper = new LoxoneControlMapper(makePlatform());
  const prepared = mapper.prepare(climateWindowFixture);

  const thermostatPlan = planForControl(IRoomControllerV2, prepared.controls['ctrl-thermostat']);
  assert.deepEqual(thermostatPlan.stateBindings, {
    'state-thermostat-actual': { service: 'PrimaryService', state: 'tempActual' },
    'state-thermostat-target': { service: 'PrimaryService', state: 'tempTarget' },
    'state-thermostat-mode': { service: 'PrimaryService', state: 'operatingMode' },
  });
  assert.match(command(thermostatPlan, 'setTargetTemperature', 19.5), /^override\/3\/\[\d+\]\/19.5$/);

  const windowPlan = planForControl(Window, prepared.controls['ctrl-window']);
  assert.deepEqual(windowPlan.stateBindings, {
    'state-window-position': { service: 'PrimaryService', state: 'position' },
    'state-window-target': { service: 'PrimaryService', state: 'targetPosition' },
    'state-window-direction': { service: 'PrimaryService', state: 'direction' },
  });
  assert.equal(command(windowPlan, 'setTargetPosition', 10), 'moveToPosition/10');

  const blindPlan = planForControl(Jalousie, prepared.controls['ctrl-blind']);
  assert.deepEqual(blindPlan.stateBindings, {
    'state-blind-up': { service: 'PrimaryService', state: 'up' },
    'state-blind-down': { service: 'PrimaryService', state: 'down' },
    'state-blind-position': { service: 'PrimaryService', state: 'position' },
    'state-blind-shade': { service: 'PrimaryService', state: 'shadePosition' },
  });
});

test('Large fixture filters rooms and exclusions before mapping unsupported controls', () => {
  const infoMessages = [];
  const mapper = new LoxoneControlMapper(makePlatform({
    config: {
      Exclusions: 'Switch',
      roomfilter: {
        type: 'inclusion',
        list: 'Kitchen, Garage',
      },
    },
    log: {
      debug: () => undefined,
      info: (message) => infoMessages.push(message),
      warn: () => undefined,
      error: () => undefined,
    },
  }));
  const prepared = mapper.prepare(largeFilterFixture);

  mapper.map(prepared.items);

  assert.equal(infoMessages.length, 2);
  assert.match(infoMessages[0], /Kitchen Unsupported 1/);
  assert.match(infoMessages[1], /Garage Unsupported 1/);
});

test('LoxoneHandler depends on the transport contract instead of the concrete API client', async () => {
  const transport = new FakeTransport();
  const capturedOptions = [];
  const handler = new LoxoneHandler(makePlatform(), (options) => {
    capturedOptions.push(options);
    return transport;
  });

  await handler.waitForConfig();

  assert.equal(capturedOptions[0].host, '127.0.0.1:80');
  assert.equal(capturedOptions[0].useTls, false);
  assert.equal(transport.connected, true);
  assert.equal(transport.enabledUpdates, true);
  assert.equal(handler.loxdata.msInfo.msName, 'Test Miniserver');

  const received = [];
  handler.registerListenerForUUID('state-switch-active', (message) => received.push(message));
  assert.deepEqual(transport.watched, ['state-switch-active']);

  transport.emitValue('state-switch-active', 'switch -> On');
  assert.deepEqual(received, [{ uuid: 'state-switch-active', value: 'On' }]);
  assert.equal(handler.getLastCachedValue('state-switch-active'), 'On');

  const commandResult = await handler.sendCommand('ctrl-switch', 'On');
  assert.equal(commandResult, 'ctrl-switch/On');
  assert.deepEqual(transport.commands[0], {
    uuid: 'ctrl-switch',
    action: 'On',
    timeoutOverride: 2000,
  });
  assert.equal(handler.getActiveCommunicationToken(), 'transport-token');
});

test('LoxoneTsApiTransport adapts the owned API client to the plugin transport contract', async () => {
  const clientInstances = [];

  class FakeLoxoneClient {
    constructor(host, username, password, useTls, options) {
      this.host = host;
      this.username = username;
      this.password = password;
      this.useTls = useTls;
      this.options = options;
      this.listeners = {};
      this.watchCalls = [];
      this.controlCalls = [];
      this.auth = { tokenHandler: { token: 'api-token' } };
      clientInstances.push(this);
    }

    async connect(existingToken) {
      this.existingToken = existingToken;
    }

    async getStructureFile() {
      return structureFixture;
    }

    async enableUpdates() {
      this.updatesEnabled = true;
    }

    async control(uuid, commandValue, timeoutOverride) {
      this.controlCalls.push({ uuid, commandValue, timeoutOverride });
      return { value: 'ok', toString: () => 'ok' };
    }

    addUuidToWatchList(uuid) {
      this.watchCalls.push(uuid);
    }

    on(event, listener) {
      this.listeners[event] = listener;
      return this;
    }
  }

  const transport = new LoxoneTsApiTransport({
    host: 'miniserver.local:443',
    username: 'homebridge',
    password: 'secret',
    useTls: true,
    clientOptions: { keepAliveEnabled: true },
  }, async () => FakeLoxoneClient);

  const values = [];
  const texts = [];
  const disconnects = [];
  const errors = [];
  transport.onValueEvent((uuid, value) => values.push({ uuid, value }));
  transport.onTextEvent((uuid, text) => texts.push({ uuid, text }));
  transport.onDisconnect((reason) => disconnects.push(reason));
  transport.onError((error) => errors.push(error.message));

  transport.watch('state-before-connect');
  await transport.connect('existing-token');
  const client = clientInstances[0];

  assert.equal(client.host, 'miniserver.local:443');
  assert.equal(client.useTls, true);
  assert.equal(client.existingToken, 'existing-token');
  assert.deepEqual(client.watchCalls, [['state-before-connect']]);

  transport.watch('state-after-connect');
  assert.deepEqual(client.watchCalls[1], 'state-after-connect');

  client.listeners.event_value({ uuid: { stringValue: 'state-value' }, value: 42 });
  client.listeners.event_text({ uuid: { stringValue: 'state-text' }, text: 'hello' });
  client.listeners.disconnected('closed');
  client.listeners.error(new Error('boom'));

  assert.deepEqual(values, [{ uuid: 'state-value', value: 42 }]);
  assert.deepEqual(texts, [{ uuid: 'state-text', text: 'hello' }]);
  assert.deepEqual(disconnects, ['closed']);
  assert.deepEqual(errors, ['boom']);

  assert.equal(await transport.getStructureFile(), structureFixture);
  await transport.enableUpdates();
  assert.equal(client.updatesEnabled, true);
  assert.equal((await transport.sendCommand('ctrl', 'On', 2000)).value, 'ok');
  assert.deepEqual(client.controlCalls, [{ uuid: 'ctrl', commandValue: 'On', timeoutOverride: 2000 }]);
  assert.equal(transport.getActiveCommunicationToken(), 'api-token');
});

test('Switch plans declare switch, outlet, and lock commands', () => {
  const switchPlan = planFor(Switch);
  assert.equal(switchPlan.services[0].kind, 'switch');
  assert.equal(command(switchPlan, 'setOn', true), 'On');
  assert.equal(command(switchPlan, 'setOn', false), 'Off');

  const outletPlan = planFor(Switch, { defaultIcon: 'Outlet' });
  assert.equal(outletPlan.services[0].kind, 'outlet');
  assert.equal(command(outletPlan, 'setOn', true), 'On');

  const lockPlan = planFor(Switch, { defaultIcon: 'Lock' });
  assert.equal(lockPlan.services[0].kind, 'lock-mechanism');
  assert.equal(command(lockPlan, 'setTargetState', 0), 'On');
  assert.equal(command(lockPlan, 'setTargetState', 1), 'Off');

  const reversedLockPlan = planFor(
    Switch,
    { defaultIcon: 'Lock' },
    { config: { switchAlias: { ReverseLockSwitch: true } } },
  );
  assert.equal(command(reversedLockPlan, 'setTargetState', 0), 'Off');
  assert.equal(command(reversedLockPlan, 'setTargetState', 1), 'On');
});

test('Light and color plans keep Loxone command strings in bindings', () => {
  const dimmerPlan = planFor(Dimmer);
  assert.equal(dimmerPlan.services[0].kind, 'lightbulb');
  assert.equal(command(dimmerPlan, 'setOn', true), 'On');
  assert.equal(command(dimmerPlan, 'setBrightness', 42), '42');

  const colorPlan = planFor(ColorPickerV2);
  assert.equal(command(colorPlan, 'setColorState', {
    mode: 'color',
    Hue: 12,
    Saturation: 34,
    Brightness: 56,
  }), 'hsv(12,34,56)');
  assert.equal(command(colorPlan, 'setColorState', {
    mode: 'colortemperature',
    Brightness: 44,
    ColorTemperature: 153,
  }), 'temp(44,6500)');
});

test('Covering, window, alarm, thermostat, and irrigation commands are declarative', () => {
  assert.equal(command(planFor(Jalousie), 'setTargetPosition', 25), 'manualPosition/25');
  assert.equal(command(planFor(Jalousie), 'setTargetHorizontalTiltAngle', 80), 'manualLamelle/80');
  assert.equal(command(planFor(Window), 'setTargetPosition', 50), 'moveToPosition/50');

  const alarmPlan = planFor(Alarm);
  assert.equal(command(alarmPlan, 'setTargetState', 0), 'off');
  assert.equal(command(alarmPlan, 'setTargetState', 1), 'delayedon/1');
  assert.equal(command(alarmPlan, 'setTargetState', 2), 'delayedon/0');

  const thermostatCommand = command(planFor(IRoomControllerV2), 'setTargetTemperature', 21);
  assert.match(thermostatCommand, /^override\/3\/\[\d+\]\/21$/);

  const irrigationPlan = planFor(Irrigation);
  assert.equal(command(irrigationPlan, 'selectZone', 3), 'select/3');
  assert.equal(command(irrigationPlan, 'setZoneDuration', { id: 2, duration: 600 }), 'setDuration/2=600');
});

test('Radio and LightControllerV2 group services use parent UUID command bindings', () => {
  const radioPlan = planFor(Radio, {
    uuidAction: 'radio-parent',
    details: {
      allOff: 'All Off',
      outputs: { 1: 'Kitchen Radio' },
    },
  });

  assert.equal(radioPlan.services.length, 2);
  assert.equal(radioPlan.services[0].commands.setOn.uuid, 'radio-parent');
  assert.equal(command(radioPlan, 'setOn', true, 0), 'reset');
  assert.equal(command(radioPlan, 'setOn', true, 1), '1');
  assert.equal(command(radioPlan, 'setOn', false, 1), undefined);

  const platform = makePlatform({
    stateRouter: {
      getCachedValue: () => JSON.stringify([
        { id: 778, name: 'Off' },
        { id: 7, name: 'Dinner' },
      ]),
    },
  });
  const lightController = Object.create(LightControllerV2.prototype);
  lightController.platform = platform;
  lightController.device = makeControl({
    uuidAction: 'light-parent',
    type: 'LightControllerV2',
  });
  lightController.ItemStates = {};
  const plan = lightController.createAccessoryPlan('light-plan');

  assert.deepEqual(plan.serviceLabels, { namespace: 'arabic-numerals' });
  assert.equal(plan.services.length, 1);
  assert.equal(plan.services[0].commands.setOn.uuid, 'light-parent');
  assert.equal(command(plan, 'setOn', true), 'changeTo/7');
  assert.equal(command(plan, 'setOn', false), undefined);
});
