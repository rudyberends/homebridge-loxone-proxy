/* eslint-disable */
'use strict';

const { readFileSync } = require('fs');
const { join } = require('path');
const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');
const { LoxoneClient, discoverMiniservers } = require('loxone-ts-client');

// Must match ROOM_BRIDGE_MANIFEST in src/binding/RoomBridgePublisher.ts.
const ROOM_BRIDGE_MANIFEST = 'loxone-room-bridges.json';

// Control types the binding engine maps to HomeKit (mirror of CONTROL_BINDERS +
// COMPOSITE_BINDERS keys in src/binding/ControlBinders.ts — kept in sync by
// test/binding.test.js). Used only to label discovery results.
const SUPPORTED_TYPES = new Set([
  'Switch', 'InfoOnlyAnalog', 'InfoOnlyDigital', 'PresenceDetector', 'Jalousie', 'Window', 'Gate',
  'Dimmer', 'EIBDimmer', 'ColorPickerV2', 'IRoomControllerV2', 'Alarm', 'AudioZoneV2', 'Ventilation', 'Pushbutton',
  'NfcCodeTouch', 'Radio', 'SmokeAlarm', 'WindowMonitor', 'LightControllerV2', 'Intercom', 'IntercomV2', 'Irrigation',
]);

/**
 * Custom config-UI backend. Runs inside the Homebridge UI process (not the
 * plugin), so it can reach the Miniserver directly. The `/discover` endpoint
 * connects with loxone-ts-client, reads the structure, and returns the rooms and
 * control types so the frontend can offer live pick-lists instead of free text.
 */
class LoxoneUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/discover', (payload) => this.discover(payload || {}));
    this.onRequest('/scan', () => this.scan());
    this.onRequest('/room-bridges', () => this.roomBridges());
    this.ready();
  }

  /**
   * Returns the per-room bridge pairing codes the plugin wrote to its manifest
   * (only present when "one bridge per room" is enabled and Homebridge has
   * published the bridges). Empty list otherwise.
   */
  roomBridges() {
    try {
      const path = join(this.homebridgeStoragePath, ROOM_BRIDGE_MANIFEST);
      const data = JSON.parse(readFileSync(path, 'utf8'));
      return { bridges: Array.isArray(data.bridges) ? data.bridges : [] };
    } catch {
      return { bridges: [] };
    }
  }

  /**
   * Best-effort LAN discovery (UDP broadcast). Returns the Miniservers found on
   * the local segment so the UI can offer them as a pick-list. Never throws —
   * an empty list just means "none found / enter the address manually".
   */
  async scan() {
    try {
      const found = await discoverMiniservers({ timeoutMs: 3000 });
      return {
        servers: found.map((ms) => ({
          name: ms.name,
          host: ms.host,
          port: ms.port,
          serial: ms.serial,
          firmware: ms.firmwareVersion,
        })),
      };
    } catch (error) {
      return { servers: [] };
    }
  }

  async discover(payload) {
    const host = String(payload.host || '').trim();
    if (!host) {
      throw new RequestError('Vul eerst hostname/IP in (en sla het formulier op).', { status: 400 });
    }

    const target = payload.port && !host.includes(':') ? `${host}:${payload.port}` : host;
    const client = new LoxoneClient(target, String(payload.username || ''), String(payload.password || ''), {
      useTls: Boolean(payload.tls),
      keepAlive: false,
      autoReconnect: false,
      enableUpdatesOnConnect: false, // we only need the structure, not the live stream
    });

    try {
      await client.connect();

      const byRoom = client.itemsByRoom();
      const rooms = client.rooms
        .map((room) => ({
          name: room.name,
          count: (byRoom.get(room.name) || []).length,
          central: room.typeName === 'central',
        }))
        .filter((room) => room.name)
        .sort((a, b) => a.name.localeCompare(b.name));

      const counts = {};
      let totalControls = 0;
      let mappedControls = 0;
      for (const item of client.items()) {
        counts[item.type] = (counts[item.type] || 0) + 1;
        totalControls += 1;
        if (SUPPORTED_TYPES.has(item.type)) {
          mappedControls += 1;
        }
      }
      const types = Object.entries(counts)
        .map(([type, count]) => ({ type, count, supported: SUPPORTED_TYPES.has(type) }))
        .sort((a, b) => a.type.localeCompare(b.type));

      return {
        rooms,
        types,
        summary: { rooms: rooms.length, totalControls, mappedControls },
        info: {
          version: client.apiInfo && client.apiInfo.version,
          serial: client.apiInfo && client.apiInfo.serialNumber,
        },
      };
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      throw new RequestError(`Verbinden met de Miniserver mislukt: ${message}`, { status: 502 });
    } finally {
      await client.disconnect().catch(() => undefined);
    }
  }
}

(() => new LoxoneUiServer())();
