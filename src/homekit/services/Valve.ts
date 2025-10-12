/**
 * Represents a HomeKit-compatible irrigation valve zone.
 * This class manages HomeKit valve service characteristics and can be used standalone or as part of a system.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Service } from 'homebridge';

interface ZoneDefinition {
  id: number;
  name: string;
  duration: number;
}

type CommandHandler = (command: string) => void;

export class Valve {
  private readonly valveService: Service;
  private readonly meta: {
    id: number;
    duration: number;
    startTime: number | null;
  };

  private interval: NodeJS.Timeout | null = null;

  /**
   * Creates an instance of Valve.
   * @param platform - Homebridge platform context
   * @param accessory - Homebridge accessory this valve is part of
   * @param zone - Configuration object for the zone
   * @param sendCommand - Optional function to send commands to external systems like Loxone
   */
  constructor(
    private readonly platform: any,
    private readonly accessory: any,
    private readonly zone: ZoneDefinition,
    private readonly sendCommand: CommandHandler = () => void 0,
  ) {
    const { Characteristic, Service } = this.platform;

    const rawName = zone.name || `Zone #${zone.id + 1}`;
    const safeName = this.platform.sanitizeName(rawName);
    const subtype = `zone-${zone.id}`;

    this.valveService =
      this.accessory.getServiceById(Service.Valve, subtype) ||
      this.accessory.addService(Service.Valve, rawName, subtype);

    this.valveService.setCharacteristic(Characteristic.Name, rawName);
    this.valveService.setCharacteristic(Characteristic.ConfiguredName, safeName);
    this.valveService.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.IRRIGATION);
    this.valveService.setCharacteristic(Characteristic.Active, 0);
    this.valveService.setCharacteristic(Characteristic.InUse, 0);
    this.valveService.setCharacteristic(Characteristic.SetDuration, zone.duration);
    this.valveService.setCharacteristic(Characteristic.RemainingDuration, 0);

    this.meta = {
      id: zone.id,
      duration: zone.duration,
      startTime: null,
    };

    this.setupListeners();
  }

  /**
   * Sets up HomeKit characteristic listeners for Active and SetDuration.
   */
  private setupListeners(): void {
    const { Characteristic } = this.platform;

    this.valveService
      .getCharacteristic(Characteristic.Active)
      .removeAllListeners('set')
      .on('set', (value, callback) => {
        const zoneId = this.meta.id + 1;
        if (value === 1) {
          this.sendCommand(`select/${zoneId}`);
        } else {
          this.sendCommand('select/0');
        }
        callback(null);
      });

    this.valveService
      .getCharacteristic(Characteristic.SetDuration)
      .removeAllListeners('set')
      .on('set', (value, callback) => {
        const duration = typeof value === 'number' ? Math.max(0, Math.floor(value)) : 0;
        this.valveService.updateCharacteristic(this.platform.Characteristic.SetDuration, duration);
        this.meta.duration = duration;
        this.sendCommand(`setDuration/${this.meta.id}=${duration}`);
        callback(null);
      });
  }

  /**
   * Resets the valve state and clears remaining duration.
   */
  public reset(): void {
    const { Characteristic } = this.platform;
    this.meta.startTime = null;
    this.valveService.updateCharacteristic(Characteristic.InUse, 0);
    this.valveService.updateCharacteristic(Characteristic.Active, 0);
    this.valveService.updateCharacteristic(Characteristic.RemainingDuration, 0);
  }

  /**
   * Activates the valve with the current time as the start.
   * @param now - Timestamp in milliseconds
   */
  public activate(now: number): void {
    const { Characteristic } = this.platform;
    this.meta.startTime = now;
    this.valveService.updateCharacteristic(Characteristic.InUse, 1);
    this.valveService.updateCharacteristic(Characteristic.Active, 1);
    this.valveService.updateCharacteristic(Characteristic.RemainingDuration, this.meta.duration);
    this.startTimerLoop();
  }

  /**
   * Updates the RemainingDuration based on elapsed time.
   * @param now - Current timestamp in milliseconds
   */
  public tick(now: number): void {
    const { Characteristic } = this.platform;
    if (this.meta.startTime) {
      const elapsed = Math.floor((now - this.meta.startTime) / 1000);
      const remaining = Math.max(0, this.meta.duration - elapsed);
      this.valveService.updateCharacteristic(Characteristic.RemainingDuration, remaining);

      if (remaining === 0) {
        this.reset();
      }
    }
  }

  /**
   * Updates the zone based on a Loxone state value.
   * @param currentZoneId - Active zone ID reported by Loxone
   * @param now - Current timestamp
   */
  public updateFromLoxone(currentZoneId: number, now: number): void {
    if (currentZoneId === -1 || currentZoneId !== this.meta.id) {
      this.reset();
    } else {
      this.activate(now);
    }
  }

  /**
   * Returns the zone ID.
   */
  public getId(): number {
    return this.meta.id;
  }

  /**
   * Returns whether the valve is currently active.
   */
  public isActive(): boolean {
    return this.meta.startTime !== null;
  }

  /**
   * Starts the internal timer to periodically update RemainingDuration.
   */
  public startTimerLoop(): void {
    if (this.interval) {
      return;
    }

    this.interval = setInterval(() => {
      this.tick(Date.now());
    }, 1000);
  }

  /**
   * Stops the internal timer.
   */
  public stopTimerLoop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
