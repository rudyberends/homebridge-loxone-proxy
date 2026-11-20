const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const { MIGRATED_CONTROL_TYPES } = require('../dist/binding/ControlBinders');

// The custom config UI server (homebridge-ui/server.js) hardcodes the list of
// HomeKit-mapped control types so it stays lightweight (no binding-graph import
// in the Homebridge UI process). This guards that copy against drift from the
// real binder registry.
test('homebridge-ui SUPPORTED_TYPES mirrors MIGRATED_CONTROL_TYPES', () => {
  const source = readFileSync(resolve(__dirname, '../homebridge-ui/server.js'), 'utf8');
  const block = source.match(/const SUPPORTED_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, 'could not find SUPPORTED_TYPES in homebridge-ui/server.js');

  const uiTypes = new Set([...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const realTypes = new Set(MIGRATED_CONTROL_TYPES);

  const missingInUi = [...realTypes].filter((t) => !uiTypes.has(t));
  const staleInUi = [...uiTypes].filter((t) => !realTypes.has(t));

  assert.deepEqual(missingInUi, [], 'types mapped by the plugin but missing from the UI list');
  assert.deepEqual(staleInUi, [], 'types listed in the UI but no longer mapped by the plugin');
});
