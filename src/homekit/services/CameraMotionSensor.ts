import { PlatformAccessory, APIEvent } from 'homebridge';
import { LoxonePlatform } from '../../LoxonePlatform';
import { BaseService } from './BaseService';
import { CameraService } from './Camera';

/**
 * CameraMotionSensor performs motion detection by analyzing
 * changes in JPEG snapshot size over time.
 */
export class CameraMotionSensor extends BaseService {
  private readonly intervalMs = 1000;
  private readonly minThreshold = 0.04;
  private readonly maxThreshold = 0.30;
  private readonly minDeltaBytes = 1500;
  private readonly cooldown = 8000;
  private readonly resetTimeout = 15000;
  private readonly historyLimit = 20;
  private readonly minimumHistory = 5;
  private readonly jpegHeaderSize: number;

  private snapshotHistory: number[] = [];
  private snapshotFailures = 0;
  private lastTrigger = 0;

  private loopTimer?: NodeJS.Timeout;
  private resetTimer?: NodeJS.Timeout;
  private polling = false;
  private shuttingDown = false;

  private state = { MotionDetected: false };

  constructor(
    platform: LoxonePlatform,
    accessory: PlatformAccessory,
    private readonly camera: CameraService,
    private readonly doorbellService?: { triggerDoorbell: () => void },
  ) {
    super(platform, accessory);
    this.jpegHeaderSize = platform.config?.Advanced?.JpegHeaderSize ?? 623;

    this.setupService();
    this.startPolling();

    platform.api.on(APIEvent.SHUTDOWN, () => {
      this.shuttingDown = true;
      if (this.loopTimer) {
        clearTimeout(this.loopTimer);
        this.loopTimer = undefined;
      }
      if (this.resetTimer) {
        clearTimeout(this.resetTimer);
        this.resetTimer = undefined;
      }
      this.platform.log.debug(`[${this.accessory.displayName}] Motion detection stopped (shutdown)`);
    });
  }

  public setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.MotionSensor) ||
      this.accessory.addService(this.platform.Service.MotionSensor);

    this.service
      .getCharacteristic(this.platform.Characteristic.MotionDetected)
      .onGet(() => this.state.MotionDetected);
  }

  // --------------------------------------------------------------------------
  // POLLING LOOP
  // --------------------------------------------------------------------------

  private startPolling(): void {
    this.scheduleNextPoll(0);
  }

  private scheduleNextPoll(delayMs: number): void {
    if (this.shuttingDown) {
      return;
    }

    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
    }

    this.loopTimer = setTimeout(() => {
      void this.pollOnce();
    }, delayMs);
  }

  private async pollOnce(): Promise<void> {
    if (this.shuttingDown || this.polling) {
      return;
    }

    this.polling = true;
    let nextDelay = this.intervalMs;

    try {
      const size = await this.readSnapshotSize();

      if (size !== null) {
        this.snapshotFailures = 0;
        const now = Date.now();

        if (this.evaluateMotion(size, now)) {
          this.triggerMotion(now);
        }
      } else {
        nextDelay = this.handleSnapshotFailure();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.debug(`[${this.accessory.displayName}] Motion polling error: ${message}`);
      nextDelay = this.handleSnapshotFailure();
    } finally {
      this.polling = false;
      this.scheduleNextPoll(nextDelay);
    }
  }

  // --------------------------------------------------------------------------
  // SNAPSHOT SIZE HANDLING
  // --------------------------------------------------------------------------

  private async readSnapshotSize(): Promise<number | null> {
    const headerSize = this.jpegHeaderSize;

    // 1. Fast path: content-length header
    const headerSizeResult = await this.camera.getSnapshotSize();
    if (headerSizeResult !== null) {
      return Math.max(0, headerSizeResult - headerSize);
    }

    // 2. Fallback: full image
    const snapshot = await this.camera.getSnapshot(false);
    if (!snapshot) {
      return null;
    }

    return Math.max(0, snapshot.length - headerSize);
  }

  private handleSnapshotFailure(): number {
    if (this.snapshotFailures < 3) {
      this.platform.log.warn(
        `[${this.accessory.displayName}] Snapshot unavailable`,
      );
    }

    this.snapshotFailures++;
    return Math.min(this.intervalMs * 2 ** this.snapshotFailures, 60000);
  }

  // --------------------------------------------------------------------------
  // MOTION ANALYSIS
  // --------------------------------------------------------------------------

  private evaluateMotion(current: number, now: number): boolean {
    this.snapshotHistory.push(current);
    if (this.snapshotHistory.length > this.historyLimit) {
      this.snapshotHistory.shift();
    }

    if (this.snapshotHistory.length < this.minimumHistory) {
      return false;
    }

    const baseline = this.median(this.snapshotHistory.slice(0, -1));
    if (baseline <= 0) {
      return false;
    }

    const deltaAbs = Math.abs(current - baseline);
    const deltaRel = deltaAbs / baseline;

    return (
      now - this.lastTrigger > this.cooldown &&
      deltaRel > this.minThreshold &&
      deltaRel < this.maxThreshold &&
      deltaAbs > this.minDeltaBytes
    );
  }

  private triggerMotion(now: number): void {
    if (!this.state.MotionDetected) {
      this.platform.log.info(`[${this.accessory.displayName}] Motion detected`);
      this.state.MotionDetected = true;

      this.service?.updateCharacteristic(
        this.platform.Characteristic.MotionDetected,
        true,
      );
      this.triggerDoorbellFromMotion();
    }

    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
    this.resetTimer = setTimeout(() => this.resetMotion(), this.resetTimeout);

    this.lastTrigger = now;
  }

  private triggerDoorbellFromMotion(): void {
    if (!this.platform.config?.Advanced?.MotionTriggersDoorbell) {
      return;
    }

    try {
      this.doorbellService?.triggerDoorbell();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.warn(`[${this.accessory.displayName}] Failed to trigger doorbell from motion: ${message}`);
    }
  }

  private resetMotion(): void {
    if (!this.state.MotionDetected) {
      return;
    }

    this.platform.log.info(`[${this.accessory.displayName}] Motion ended`);
    this.state.MotionDetected = false;

    this.service?.updateCharacteristic(
      this.platform.Characteristic.MotionDetected,
      false,
    );

    this.resetTimer = undefined;
  }

  // --------------------------------------------------------------------------
  // UTILITIES
  // --------------------------------------------------------------------------

  private median(values: number[]): number {
    if (!values.length) {
      return 0;
    }
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length & 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

}
