import type { PlatformAccessory, Service } from 'homebridge';
import type { IrrigationControl } from 'loxone-ts-client';
import type { LoxonePlatform } from '../../LoxonePlatform';
import { sanitizeName } from '../../AccessoryNameRegistry';

// HAP's Set/RemainingDuration default to a 1-hour max; Loxone zones can run longer
// (e.g. 5400s). Raise the ceiling to 24h so real durations aren't rejected/clamped.
const MAX_VALVE_DURATION = 86400;

interface ZoneValve {
  service: Service;
  duration: number;
  startTime: number | null;
}

/**
 * Binds an Irrigation control: an IrrigationSystem container plus one Valve per
 * zone (from `zoneList`). HomeKit drives a zone via its Valve `Active`
 * (→ `select/{id+1}`, or `select/0` to stop) and `SetDuration` (→ `setDuration`);
 * the live `currentZone` state drives Active/InUse and a 1s RemainingDuration
 * countdown. Loxone `currentZone`: -1 off, 0..n that zone, 8 = all active.
 *
 * Stateful (per-zone start times + a countdown interval); returns a disposer that
 * clears the interval and the `currentZone` subscription.
 */
export function bindIrrigation(platform: LoxonePlatform, accessory: PlatformAccessory, control: IrrigationControl): () => void {
  const C = platform.Characteristic;
  const disposers: Array<() => void> = [];

  const system =
    accessory.getService(platform.Service.IrrigationSystem) ?? accessory.addService(platform.Service.IrrigationSystem);
  system.setCharacteristic(C.Name, sanitizeName(control.name) || 'Irrigation');
  system.setCharacteristic(C.Active, C.Active.ACTIVE);
  system.setCharacteristic(C.ProgramMode, C.ProgramMode.NO_PROGRAM_SCHEDULED);

  const valves = new Map<number, ZoneValve>();
  for (const zone of control.zoneList ?? []) {
    const subtype = `zone-${zone.id}`;
    const fallback = `Zone ${zone.id + 1}`;
    const name = sanitizeName(zone.name || fallback) || fallback;
    const service =
      accessory.getServiceById(platform.Service.Valve, subtype) ?? accessory.addService(platform.Service.Valve, name, subtype);
    service.setCharacteristic(C.Name, name);
    service.addOptionalCharacteristic(C.ConfiguredName);
    service.setCharacteristic(C.ConfiguredName, name);
    service.setCharacteristic(C.ValveType, C.ValveType.IRRIGATION);
    service.getCharacteristic(C.SetDuration).setProps({ maxValue: MAX_VALVE_DURATION });
    service.getCharacteristic(C.RemainingDuration).setProps({ maxValue: MAX_VALVE_DURATION });
    service.setCharacteristic(C.SetDuration, zone.duration ?? 0);

    const valve: ZoneValve = { service, duration: zone.duration ?? 0, startTime: null };
    valves.set(zone.id, valve);

    // Activating a valve selects its zone (1-based); deactivating stops all zones.
    service.getCharacteristic(C.Active).onSet((value) => control.select(value ? zone.id + 1 : 0));
    service.getCharacteristic(C.SetDuration).onSet((value) => {
      const duration = Math.max(0, Math.floor(Number(value)));
      valve.duration = duration;
      service.updateCharacteristic(C.SetDuration, duration);
      return control.setDuration(zone.id, duration);
    });
  }

  if (valves.size === 0) {
    return () => disposers.forEach((dispose) => dispose());
  }

  const setActive = (valve: ZoneValve, active: boolean): void => {
    valve.service.updateCharacteristic(C.Active, active ? 1 : 0);
    valve.service.updateCharacteristic(C.InUse, active ? 1 : 0);
  };

  const applyCurrentZone = (): void => {
    const current = control.currentZone ?? -1;
    const now = Date.now();
    for (const [id, valve] of valves) {
      const active = current === 8 || current === id; // 8 = all zones active
      if (active && valve.startTime === null) {
        valve.startTime = now;
        setActive(valve, true);
        valve.service.updateCharacteristic(C.RemainingDuration, valve.duration);
      } else if (!active && valve.startTime !== null) {
        valve.startTime = null;
        setActive(valve, false);
        valve.service.updateCharacteristic(C.RemainingDuration, 0);
      }
    }
  };

  const tick = (): void => {
    const now = Date.now();
    for (const valve of valves.values()) {
      if (valve.startTime === null) {
        continue;
      }
      const remaining = Math.max(0, valve.duration - Math.floor((now - valve.startTime) / 1000));
      valve.service.updateCharacteristic(C.RemainingDuration, remaining);
      if (remaining === 0) {
        valve.startTime = null;
        setActive(valve, false);
      }
    }
  };

  try {
    disposers.push(control.onState('currentZone', () => applyCurrentZone(), { emitCurrent: true }));
  } catch (error) {
    platform.log.warn(`[${control.name}] No currentZone state to subscribe (${(error as Error).message})`);
  }

  const interval = setInterval(tick, 1000);
  if (typeof interval.unref === 'function') {
    interval.unref();
  }

  return () => {
    clearInterval(interval);
    disposers.forEach((dispose) => dispose());
  };
}
