/* eslint-disable @typescript-eslint/no-explicit-any */
import { BaseService } from './BaseService';
import { Valve } from './Valve';

interface ZoneDefinition {
  id: number;
  name: string;
  duration: number;
  setByLogic?: boolean;
}

export class IrrigationSystem extends BaseService {
  private zoneValves: Map<number, Valve> = new Map();
  private durationUpdateInterval: NodeJS.Timeout | null = null;

  /**
   * Sets up the HomeKit IrrigationSystem service as a container (not controlling logic).
   */
  setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.IrrigationSystem) ||
      this.accessory.addService(this.platform.Service.IrrigationSystem);

    this.service.setCharacteristic(this.platform.Characteristic.Name, this.device.name);
    this.service.setCharacteristic(
      this.platform.Characteristic.ProgramMode,
      this.platform.Characteristic.ProgramMode.NO_PROGRAM_SCHEDULED,
    );
  }

  /**
   * Handles updates from Loxone, such as zone definitions or currently active zone.
   * @param message - Message object containing state and value from Loxone
   */
  updateService(message: { state: string; value: any }): void {
    switch (message.state) {
      case 'zones': {
        try {
          const zones: ZoneDefinition[] =
            typeof message.value === 'string' ? JSON.parse(message.value) : message.value;

          if (!Array.isArray(zones)) {
            this.platform.log.warn(`[${this.device.name}] zones is not an array`);
            break;
          }

          this.platform.log.info(`[${this.device.name}] Setting up ${zones.length} zones`);
          this.setupZones(zones);
          this.startRemainingDurationUpdater();
        } catch (err) {
          this.platform.log.warn(`[${this.device.name}] Invalid zone data: ${message.value}`);
        }
        break;
      }

      case 'currentZone': {
        const now = Date.now();
        const currentId = message.value;

        this.zoneValves.forEach((valve) => {
          valve.updateFromLoxone(currentId, now);
        });
        break;
      }

      default:
        this.platform.log.debug(`[${this.device.name}] Unhandled irrigation state: ${message.state}`);
    }

    this.platform.log.debug(`[${this.device.name}] State update: ${message.state} = ${message.value}`);
  }

  /**
   * Instantiates Valve objects for each defined irrigation zone.
   * @param zones - Array of zone definition objects
   */
  private setupZones(zones: ZoneDefinition[]): void {
    zones.forEach((zone) => {
      const valve = new Valve(
        this.platform,
        this.accessory,
        zone,
        (commandId, value) => this.executeCommand(commandId, value),
      );
      this.zoneValves.set(zone.id, valve);
    });
  }

  /**
   * Periodically updates RemainingDuration of all valves.
   */
  private startRemainingDurationUpdater(): void {
    if (this.durationUpdateInterval) {
      return;
    }

    this.durationUpdateInterval = setInterval(() => {
      const now = Date.now();
      this.zoneValves.forEach((valve) => valve.tick(now));
    }, 1000);
  }

}
