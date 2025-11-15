import { PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../../LoxonePlatform';
import { BaseService } from './BaseService';
import { CameraService } from './Camera';
import { APIEvent } from 'homebridge';

/**
 * CameraMotionSensor uses periodic snapshot analysis to detect motion
 * by monitoring changes in image size over time.
 */
export class CameraMotionSensor extends BaseService {
  private readonly intervalMs = 1000;
  private readonly minThreshold = 0.04;
  private readonly maxThreshold = 0.30;
  private readonly minDeltaBytes = 1500;
  private readonly cooldown = 8000;
  private readonly resetTimeout = 15000;
  private readonly historyLimit = 20;
  private readonly jpegHeaderSize: number;

  private snapshotSizeHistory: number[] = [];
  private lastTrigger = 0;
  private motionResetTimer?: NodeJS.Timeout;
  private active = false;
  private snapshotFailureCount = 0;
  private readonly maxSnapshotWarnings = 3;
  private isPolling = false;
  private isShuttingDown = false;

  private state = {
    MotionDetected: false,
  };

  private camera: CameraService;

  constructor(
    platform: LoxonePlatform,
    accessory: PlatformAccessory,
    camera: CameraService,
    private readonly doorbellService?: { triggerDoorbell: () => void },
  ) {
    super(platform, accessory);
    this.camera = camera;
    this.jpegHeaderSize = this.platform.config?.Advanced?.JpegHeaderSize ?? 623;
    this.setupService();
    this.startDetection();

    // Handle shutdown
    platform.api.on(APIEvent.SHUTDOWN, () => {
      this.isShuttingDown = true;
      this.active = false;
      this.platform.log.debug(`[${this.accessory.displayName}] Motion sensor stopping due to shutdown`);
    });
  }

  setupService(): void {
    this.service = this.accessory.getService(this.platform.Service.MotionSensor)
      || this.accessory.addService(this.platform.Service.MotionSensor);

    this.service.getCharacteristic(this.platform.Characteristic.MotionDetected)
      .onGet(() => this.state.MotionDetected);
  }

  private startDetection() {
    this.platform.log.debug(`[${this.accessory.displayName}] Starting camera motion detection`);
    this.active = true;

    const poll = async () => {
      if (!this.active || this.isPolling || this.isShuttingDown) {
        return;
      }
      this.isPolling = true;

      // Try to get snapshot size efficiently via HTTP headers first
      let currentSize: number | null = null;
      const snapshotSize = await this.camera.getSnapshotSize();

      if (snapshotSize !== null) {
        // Successfully got size from HTTP headers - most efficient method
        this.platform.log.debug(`[${this.accessory.displayName}] Got snapshot size: ${snapshotSize} bytes via HTTP headers`);
        currentSize = Math.max(0, snapshotSize - this.jpegHeaderSize);
        this.snapshotFailureCount = 0;
      } else {
        // Fallback to full snapshot download if size request fails
        const snapshot = await this.camera.getSnapshot();

        if (!snapshot) {
          if (this.snapshotFailureCount < this.maxSnapshotWarnings) {
            this.platform.log.warn(`[${this.accessory.displayName}] Snapshot unavailable`);
            this.snapshotFailureCount++;
          }
          const retryDelay = Math.min(this.intervalMs * 2 ** this.snapshotFailureCount, 60000);
          this.isPolling = false;
          setTimeout(poll, retryDelay);
          return;
        }

        this.snapshotFailureCount = 0;
        currentSize = Math.max(0, snapshot.length - this.jpegHeaderSize);
      }

      const now = Date.now();

      if (currentSize !== null && this.evaluateMotion(currentSize, now)) {
        this.triggerMotion(now);
      }

      this.isPolling = false;
      setTimeout(poll, this.intervalMs);
    };

    poll();
  }

  private evaluateMotion(currentSize: number, now: number): boolean {
    this.snapshotSizeHistory.push(currentSize);
    if (this.snapshotSizeHistory.length > this.historyLimit) {
      this.snapshotSizeHistory.shift();
    }

    const medianSize = this.median(this.snapshotSizeHistory);

    // Skip evaluation until the history stabilizes
    if (medianSize <= 0) {
      this.platform.log.debug(`[${this.accessory.displayName}] Motion delta skipped (median=0)`);
      return false;
    }

    const delta = Math.abs(currentSize - medianSize) / medianSize;
    this.platform.log.debug(`[${this.accessory.displayName}] Motion delta: ${(delta * 100).toFixed(2)}%`);

    return (
      delta > this.minThreshold &&
      delta < this.maxThreshold &&
      Math.abs(currentSize - medianSize) > this.minDeltaBytes &&
      now - this.lastTrigger > this.cooldown
    );
  }

  private triggerMotion(now: number) {
    if (!this.state.MotionDetected) {
      this.platform.log.info(`[${this.accessory.displayName}] Motion detected via snapshot`);
      this.state.MotionDetected = true;
      this.service?.updateCharacteristic(this.platform.Characteristic.MotionDetected, true);

      if (this.motionResetTimer) {
        clearTimeout(this.motionResetTimer);
      }

      this.motionResetTimer = setTimeout(() => this.resetMotion(), this.resetTimeout);
    }

    this.lastTrigger = now;
  }

  private resetMotion() {
    if (!this.state.MotionDetected) {
      // Motion already reset, prevent double reset
      return;
    }
    this.platform.log.info(`[${this.accessory.displayName}] Motion ended`);
    this.state.MotionDetected = false;
    this.service?.updateCharacteristic(this.platform.Characteristic.MotionDetected, false);
    this.motionResetTimer = undefined;
  }

  private median(values: number[]): number {
    if (!values.length) {
      return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private average(values: number[]): number {
    if (!values.length) {
      return 0;
    }
    const sum = values.reduce((acc, val) => acc + val, 0);
    return sum / values.length;
  }
}