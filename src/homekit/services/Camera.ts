import { PlatformAccessory } from 'homebridge';
import { LoxonePlatform } from '../../LoxonePlatform';
import { streamingDelegate } from '../hksv/StreamingDelegate';
import { RecordingDelegate } from '../hksv/RecordingDelegate';

/**
 * CameraService wrapt de streamingDelegate en biedt HomeKit-camera-integratie
 * inclusief snapshot-opvraging en (optioneel) HKSV-ondersteuning.
 */
export class CameraService {
  private readonly platform: LoxonePlatform;
  private readonly accessory: PlatformAccessory;
  private readonly ip: string;
  private readonly base64auth: string;

  private streamingDelegate!: streamingDelegate;

  constructor(
    platform: LoxonePlatform,
    accessory: PlatformAccessory,
    ip: string,
    base64auth: string,
    enableHKSV: boolean,
  ) {
    this.platform = platform;
    this.accessory = accessory;
    this.ip = ip;
    this.base64auth = base64auth;

    this.setupService(enableHKSV);
  }

  /**
   * Initialiseer streamingDelegate en koppel aan Homebridge CameraController
   */
  private setupService(enableHKSV: boolean): void {

    const recordingDelegate = enableHKSV
      ? new RecordingDelegate(this.platform, this.ip, this.base64auth)
      : undefined;

    this.streamingDelegate = new streamingDelegate(this.platform, this.ip, this.base64auth, recordingDelegate, enableHKSV);
    this.accessory.configureController(this.streamingDelegate.controller);
  }

  /**
   * Levert een JPEG-snapshot van de stream, via de streamingDelegate.
   * Wordt o.a. gebruikt voor snapshot-gebaseerde motion detection.
   */
  public async getSnapshot(): Promise<Buffer | null> {
    return this.streamingDelegate.getSnapshot();
  }
}
