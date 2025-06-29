import { PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../../LoxonePlatform';
import { BaseService } from './BaseService';
import { CameraService } from './Camera';

/**
 * CameraMotionSensor uses periodic snapshot analysis to detect motion
 * by monitoring changes in image size over time.
 */
export class CameraMotionSensor extends BaseService {
  // Snapshot polling interval in milliseconds
  private readonly intervalMs = 5000;

  // Relative size change thresholds to detect motion
  private readonly minThreshold = 0.04;
  private readonly maxThreshold = 0.30;

  // Minimum time between motion triggers (to avoid false positives)
  private readonly cooldown = 8000;

  // How long to wait after last detected motion before clearing the state
  private readonly resetTimeout = 15000;

  private lastSnapshotSize?: number;
  private lastTrigger = 0;
  private active = false;

  private state = {
    MotionDetected: false,
  };

  private camera: CameraService;

  constructor(
    platform: LoxonePlatform,
    accessory: PlatformAccessory,
    camera: CameraService,
  ) {
    super(platform, accessory);
    this.camera = camera;
    this.setupService();
    this.startDetection();
  }

  /**
   * Initializes the HomeKit MotionSensor service
   * and binds the characteristic to internal state.
   */
  setupService(): void {
    this.service = this.accessory.getService(this.platform.Service.MotionSensor)
      || this.accessory.addService(this.platform.Service.MotionSensor);

    this.service.getCharacteristic(this.platform.Characteristic.MotionDetected)
      .onGet(() => this.state.MotionDetected);
  }

  /**
   * Begins periodic snapshot analysis to detect motion.
   * Compares image size deltas between snapshots to infer activity.
   */
  private startDetection() {
    this.platform.log.debug(`[${this.accessory.displayName}] Starting camera motion detection`);
    this.active = true;

    setInterval(async () => {
      if (!this.active) return;

      const snapshot = await this.camera.getSnapshot();
      if (!snapshot) {
        this.platform.log.warn(`[${this.accessory.displayName}] Snapshot unavailable`);
        return;
      }

      const currentSize = snapshot.length;
      const now = Date.now();

      if (this.lastSnapshotSize) {
        const delta = Math.abs(currentSize - this.lastSnapshotSize) / this.lastSnapshotSize;

        if (
          delta > this.minThreshold &&
          delta < this.maxThreshold &&
          now - this.lastTrigger > this.cooldown
        ) {
          this.triggerMotion(now);
        } else if (
          this.state.MotionDetected &&
          now - this.lastTrigger > this.resetTimeout
        ) {
          this.resetMotion();
        }
      }

      this.lastSnapshotSize = currentSize;
    }, this.intervalMs);
  }

  /**
   * Handles setting the motion state to true when motion is detected.
   */
  private triggerMotion(now: number) {
    if (!this.state.MotionDetected) {
      this.platform.log.info(`[${this.accessory.displayName}] 📸 Motion detected via snapshot`);
      this.state.MotionDetected = true;
      this.service?.updateCharacteristic(this.platform.Characteristic.MotionDetected, true);
    }

    this.lastTrigger = now;
  }

  /**
   * Resets the motion state to false after a quiet period.
   */
  private resetMotion() {
    this.platform.log.info(`[${this.accessory.displayName}] ⏸️ Motion ended`);
    this.state.MotionDetected = false;
    this.service?.updateCharacteristic(this.platform.Characteristic.MotionDetected, false);
  }
}
