import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlatformAccessory } from 'homebridge';
import type { Accessory, Bridge } from 'hap-nodejs';
import type { LoxonePlatform } from '../LoxonePlatform';

/** Manifest of published room bridges, read by the custom config UI to show pairing codes. */
export const ROOM_BRIDGE_MANIFEST = 'loxone-room-bridges.json';

interface RoomBridge {
  bridge: Bridge;
  members: Set<string>; // accessory UUIDs currently bridged here
  published: boolean;
  pincode?: string;
  setupURI?: string;
}

// HAP rejects these "too easy" setup codes; nudge a derived code off them.
const FORBIDDEN_PINS = new Set([
  '00000000', '11111111', '22222222', '33333333', '44444444', '55555555',
  '66666666', '77777777', '88888888', '99999999', '12345678', '87654321',
]);

/**
 * Optional "one bridge per room" publish strategy. Instead of registering every
 * accessory on Homebridge's single bridge (so HomeKit drops them all into one
 * room), this publishes a separate HAP {@link Bridge} per Loxone room — from the
 * same plugin process and the same Miniserver connection. Each room bridge is
 * paired once in the Home app, and all its accessories land in the room you pick.
 *
 * Identity is derived deterministically from the room name (stable MAC-like
 * username + pincode), so pairings survive restarts; HAP persists them by
 * username in Homebridge's storage. Ports are left to HAP (a free port, re-
 * advertised via mDNS), so they need not be stable.
 */
export class RoomBridgePublisher {
  private readonly bridges = new Map<string, RoomBridge>();
  private readonly accessoryRoom = new Map<string, string>(); // accessory UUID -> room key
  private readonly tracked = new Map<string, PlatformAccessory>(); // accessory UUID -> accessory (room-bridge only)

  constructor(private readonly platform: LoxonePlatform) {}

  /** The room-bridge accessory for `uuid`, if this publisher owns it (so reconcile can reuse it). */
  get(uuid: string): PlatformAccessory | undefined {
    return this.tracked.get(uuid);
  }

  /** Attaches an accessory to its room bridge (moving it if its room changed). Idempotent. */
  register(accessory: PlatformAccessory, room: string): void {
    const key = (room || 'Unassigned').trim() || 'Unassigned';
    this.tracked.set(accessory.UUID, accessory);
    const previous = this.accessoryRoom.get(accessory.UUID);
    if (previous && previous !== key) {
      this.detach(accessory.UUID, previous);
    }
    const entry = this.ensureBridge(key);
    if (entry.members.has(accessory.UUID)) {
      return;
    }
    entry.bridge.addBridgedAccessory(this.hapAccessory(accessory));
    entry.members.add(accessory.UUID);
    this.accessoryRoom.set(accessory.UUID, key);
  }

  /** Detaches every tracked accessory not in `seen` (prune); returns the removed accessories. */
  prune(seen: Set<string>): PlatformAccessory[] {
    const removed: PlatformAccessory[] = [];
    for (const [uuid, accessory] of [...this.tracked]) {
      if (seen.has(uuid)) {
        continue;
      }
      this.unregister(accessory);
      removed.push(accessory);
    }
    return removed;
  }

  /** Detaches an accessory (prune); unpublishes its bridge if it becomes empty. */
  unregister(accessory: PlatformAccessory): void {
    const key = this.accessoryRoom.get(accessory.UUID);
    if (key) {
      this.detach(accessory.UUID, key);
    }
  }

  /** Publishes every bridge that has members but isn't live yet. Call after each rebuild. */
  finalize(): void {
    let publishedAny = false;
    for (const [room, entry] of this.bridges) {
      if (entry.published || entry.members.size === 0) {
        continue;
      }
      const pincode = pincodeForRoom(room);
      entry.bridge.publish({
        username: macForRoom(room),
        pincode,
        category: this.platform.api.hap.Categories.BRIDGE,
      });
      entry.published = true;
      entry.pincode = pincode;
      try {
        entry.setupURI = entry.bridge.setupURI();
      } catch {
        // setupURI is best-effort (used for the QR payload)
      }
      publishedAny = true;
      this.platform.log.info(
        `[Room Bridge] "${room}" is ready — add it in the Home app (Add Accessory → More options) with code ${pincode}`,
      );
    }
    if (publishedAny) {
      this.writeManifest();
    }
  }

  /** Writes the per-room pairing codes to a manifest the custom config UI can read. */
  private writeManifest(): void {
    try {
      const bridges = [...this.bridges.entries()]
        .filter(([, entry]) => entry.published && entry.pincode)
        .map(([room, entry]) => ({ room, pincode: entry.pincode, setupURI: entry.setupURI }));
      const path = join(this.platform.api.user.storagePath(), ROOM_BRIDGE_MANIFEST);
      writeFileSync(path, JSON.stringify({ bridges }, null, 2));
    } catch (error) {
      this.platform.log.debug(`[Room Bridge] Could not write pairing manifest: ${(error as Error).message}`);
    }
  }

  /** Unpublishes all room bridges (Homebridge shutdown). */
  async dispose(): Promise<void> {
    for (const entry of this.bridges.values()) {
      if (entry.published) {
        await entry.bridge.unpublish().catch(() => undefined);
      }
    }
    this.bridges.clear();
    this.accessoryRoom.clear();
  }

  private ensureBridge(key: string): RoomBridge {
    let entry = this.bridges.get(key);
    if (!entry) {
      const uuid = this.platform.api.hap.uuid.generate(`loxone:room-bridge:${key}`);
      const bridge = new this.platform.api.hap.Bridge(`Loxone ${key}`, uuid);
      entry = { bridge, members: new Set(), published: false };
      this.bridges.set(key, entry);
    }
    return entry;
  }

  private detach(uuid: string, key: string): void {
    this.accessoryRoom.delete(uuid);
    this.tracked.delete(uuid);
    const entry = this.bridges.get(key);
    if (!entry) {
      return;
    }
    const hap = entry.bridge.bridgedAccessories.find((acc) => acc.UUID === uuid);
    if (hap) {
      entry.bridge.removeBridgedAccessory(hap);
    }
    entry.members.delete(uuid);
    // Tear down a bridge whose last accessory just left.
    if (entry.members.size === 0 && entry.published) {
      entry.published = false;
      entry.bridge.unpublish().catch(() => undefined);
    }
  }

  private hapAccessory(accessory: PlatformAccessory): Accessory {
    // Homebridge wraps a hap-nodejs Accessory; that's what a Bridge bridges.
    return (accessory as unknown as { _associatedHAPAccessory: Accessory })._associatedHAPAccessory;
  }
}

/** Stable, locally-administered MAC-like username derived from the room name. */
function macForRoom(room: string): string {
  const digest = createHash('md5').update(`loxone-room-bridge:${room}`).digest();
  const bytes = [...digest.subarray(0, 6)];
  bytes[0] = (bytes[0] & 0xfe) | 0x02; // locally administered (bit 1), unicast (bit 0 clear)
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

/** Stable, valid `XXX-XX-XXX` setup code derived from the room name. */
function pincodeForRoom(room: string): string {
  const digest = createHash('md5').update(`loxone-room-pin:${room}`).digest();
  let digits = '';
  for (let i = 0; digits.length < 8; i++) {
    digits += (digest[i % digest.length] % 10).toString();
  }
  if (FORBIDDEN_PINS.has(digits)) {
    digits = ((Number(digits[0]) + 1) % 10).toString() + digits.slice(1);
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 8)}`;
}
