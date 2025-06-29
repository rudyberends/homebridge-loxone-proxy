import { PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../../LoxonePlatform';
import { BaseService } from './BaseService';
import { CameraService } from './Camera';

export class CameraMotionSensor extends BaseService {
  private readonly intervalMs = 5000;
  private readonly minThreshold = 0.04;
  private readonly maxThreshold = 0.30;
  private readonly cooldown = 8000;

  private lastSnapshotSize?: number;
  private lastTrigger = 0;
  private active = false;

  private state = {
    MotionDetected: false,
  };

  camera: CameraService;

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

  setupService(): void {
    this.service = this.accessory.getService(this.platform.Service.MotionSensor)
      || this.accessory.addService(this.platform.Service.MotionSensor);

    this.service.getCharacteristic(this.platform.Characteristic.MotionDetected)
      .onGet(() => this.state.MotionDetected);
  }

  private startDetection() {
    this.platform.log.debug(`[${this.accessory.displayName}] Starting camera motion detection`);
    this.active = true;

    setInterval(async () => {
      if (!this.active) {
        return;
      }

      const snapshot = await this.camera.getSnapshot();
      if (!snapshot) {
        return;
      }

      const currentSize = snapshot.length;

      if (this.lastSnapshotSize) {
        const delta = Math.abs(currentSize - this.lastSnapshotSize) / this.lastSnapshotSize;
        const now = Date.now();

        if (
          delta > this.minThreshold &&
          delta < this.maxThreshold &&
          now - this.lastTrigger > this.cooldown
        ) {
          this.lastTrigger = now;
          this.triggerMotion();
        }
      }

      this.lastSnapshotSize = currentSize;
    }, this.intervalMs);
  }

  private triggerMotion() {
    this.platform.log.info(`[${this.accessory.displayName}] 📸 Motion detected via snapshot`);
    this.state.MotionDetected = true;
    this.service?.updateCharacteristic(this.platform.Characteristic.MotionDetected, true);

    setTimeout(() => {
      this.state.MotionDetected = false;
      this.service?.updateCharacteristic(this.platform.Characteristic.MotionDetected, false);
    }, 5000);
  }
}
