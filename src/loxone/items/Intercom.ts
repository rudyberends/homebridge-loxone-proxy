import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Doorbell } from '../../homekit/services/Doorbell';
import { Switch } from '../../homekit/services/Switch';
import {
  CameraService,
  TwoWayAudioContext,
  TwoWayAudioTemplateVars,
} from '../../homekit/services/Camera';
import { CameraMotionSensor } from '../../homekit/services/CameraMotionSensor';

// Types
type SecuredDetails = {
  videoInfo?: {
    streamUrl?: string;
    user?: string;
    pass?: string;
    alertImage?: string;
    flags?: string;
  };
  audioInfo?: {
    host?: string;
    user?: string;
    pass?: string;
  };
};

/**
 * Intercom (V1 + third-party)
 *
 * Handles all non-V2 intercom devices. V2 units are initialized through the
 * IntercomV2 class, which overrides camera configuration logic.
 *
 * This class supports:
 *   • Loxone Intercom V1/XL (alertImage-based MJPEG access)
 *   • Third-party IP cameras (deviceType === 0)
 *
 * HKSV support:
 *   • Motion sensor is exposed only when HKSV is enabled via plugin config.
 *   • This is required to avoid unwanted HKSV auto-activation in HomeKit.
 */
export class Intercom extends LoxoneAccessory {

  protected camera?: CameraService;

  /**
   * Registers:
   *   - the primary doorbell service
   *   - the camera (if available)
   *   - all intercom sub-controls (door release etc.)
   */
  configureServices(): void {
    this.ItemStates = {
      [this.device.states.bell]: {
        service: 'PrimaryService',
        state: 'bell',
      },
    };

    void this.configureCamera();
    this.registerChildItems();

    this.Service.PrimaryService = new Doorbell(
      this.platform,
      this.Accessory!,
    );
  }

  /**
   * Loads securedDetails and configures the correct camera stream.
   *
   * Detection logic:
   *   • Third-party camera → deviceType === 0
   *   • Loxone Intercom V1/XL → alertImage available
   *   • Fallback → streamUrl from videoInfo
   */
  protected async configureCamera(): Promise<void> {
    const secured = await this.platform.LoxoneHandler.getsecuredDetails(this.device.uuidAction);
    const parsed = this.parseSecuredDetails(secured);
    if (!parsed) {
      this.platform.log.warn(
        `[${this.device.name}] Could not parse securedDetails JSON.`,
      );
      return;
    }

    const videoInfo = parsed.videoInfo;
    const audioInfo = parsed.audioInfo;
    if (!videoInfo) {
      this.platform.log.debug(
        `[${this.device.name}] No videoInfo available.`,
      );
      return;
    }

    let streamUrl: string | undefined;
    let snapshotUrl: string | undefined;
    let base64auth: string | undefined;

    // --- Third-Party Camera
    if (this.device.details.deviceType === 0) {
      streamUrl = videoInfo.streamUrl;

      const user = videoInfo.user ?? '';
      const pass = videoInfo.pass ?? '';
      base64auth = Buffer.from(`${user}:${pass}`).toString('base64');

      if (videoInfo.alertImage) {
        snapshotUrl = videoInfo.alertImage;
      } else {
        const host = this.extractHost(streamUrl);
        if (host) {
          snapshotUrl = `http://${host}/jpg/image.jpg`;
        }
      }

      if (!streamUrl) {
        this.platform.log.warn(
          `[${this.device.name}] Missing streamUrl for third-party camera.`,
        );
        return;
      }

      this.initializeCamera(streamUrl, snapshotUrl, base64auth, undefined, this.buildTwoWayTemplateVars(audioInfo));
      return;
    }

    // --- Loxone Intercom V1 / XL
    // AlertImage gives the correct host for both MJPEG and snapshots
    if (videoInfo.alertImage) {
      const host = this.extractHost(videoInfo.alertImage);
      if (host) {
        streamUrl = `http://${host}/mjpg/video.mjpg`;
        snapshotUrl = `http://${host}/jpg/image.jpg`;
      }
    }

    // If no alertImage or invalid → fallback to streamUrl from API
    if (!streamUrl && videoInfo.streamUrl) {
      streamUrl = videoInfo.streamUrl;
      snapshotUrl = videoInfo.alertImage ?? undefined;
    }

    const user = videoInfo.user ?? '';
    const pass = videoInfo.pass ?? '';
    base64auth = Buffer.from(`${user}:${pass}`).toString('base64');

    if (!streamUrl) {
      this.platform.log.warn(
        `[${this.device.name}] No usable stream URL for intercom.`,
      );
      return;
    }

    this.initializeCamera(streamUrl, snapshotUrl, base64auth, undefined, this.buildTwoWayTemplateVars(audioInfo));
  }

  /**
   * Initializes the CameraService with the provided streaming parameters.
   * Optionally exposes snapshot-based motion for HKSV/event triggering.
   *
   * @param streamUrl   - MJPEG video stream endpoint
   * @param snapshotUrl - JPEG snapshot source (if available)
   * @param auth        - Optional Base64 HTTP Basic Auth header
   */
  initializeCamera(
    streamUrl: string,
    snapshotUrl?: string,
    auth?: string,
    enableSnapshotMotion = (this.platform.config.enableHKSV ?? false),
    twoWayAudioTemplateVars?: TwoWayAudioTemplateVars,
    twoWayAudioContext?: TwoWayAudioContext,
  ): void {
    // Camera streaming
    this.camera = new CameraService(
      this.platform,
      this.Accessory!,
      streamUrl,
      snapshotUrl,
      auth || '',
      twoWayAudioTemplateVars,
      twoWayAudioContext,
    );

    // Snapshot-based motion sensor (typically HKSV)
    if (enableSnapshotMotion) {
      this.Service['CameraMotion'] = new CameraMotionSensor(
        this.platform,
        this.Accessory!,
        this.camera,
        {
          triggerDoorbell: () =>
            (this.Service.PrimaryService as Doorbell).triggerDoorbell(),
        },
      );

      this.platform.log.info(
        `[${this.device.name}] Motion sensor enabled (HKSV active).`,
      );
    } else {
      this.platform.log.debug(
        `[${this.device.name}] Snapshot motion sensor not enabled for this camera.`,
      );
    }

    this.platform.log.info(
      `[${this.device.name}] Camera configured: ${streamUrl}`,
    );
  }

  /**
   * Registers all sub-controls exposed by the intercom device
   * (e.g. door release buttons) as HomeKit switch services.
   */
  private registerChildItems(): void {
    if (!this.device.subControls) {
      return;
    }

    for (const childUuid in this.device.subControls) {
      const child = this.device.subControls[childUuid];
      const serviceName = child.name.replace(/\s/g, '');

      this.Service[serviceName] = new Switch(
        this.platform,
        this.Accessory!,
        child,
      );

      for (const stateName in child.states) {
        const uuid = child.states[stateName];
        this.ItemStates[uuid] = {
          service: serviceName,
          state: stateName,
        };
      }
    }
  }

  private parseSecuredDetails(raw: unknown): SecuredDetails | undefined {
    const parseJson = (value: unknown): SecuredDetails | undefined => {
      if (typeof value === 'string') {
        return JSON.parse(value) as SecuredDetails;
      }

      if (value && typeof value === 'object') {
        return value as SecuredDetails;
      }

      return undefined;
    };

    try {
      const objectValue = raw as { LL?: { value?: unknown } } | undefined;
      if (objectValue?.LL?.value !== undefined) {
        return parseJson(objectValue.LL.value);
      }

      return parseJson(raw);
    } catch {
      return undefined;
    }
  }

  private extractHost(input?: string): string | undefined {
    if (!input) {
      return undefined;
    }

    try {
      return new URL(input).host;
    } catch {
      const match = input.match(/^(?:https?:\/\/)?([^/?#]+)/i);
      return match?.[1];
    }
  }

  private buildTwoWayTemplateVars(audioInfo?: SecuredDetails['audioInfo']): TwoWayAudioTemplateVars {
    const vars: TwoWayAudioTemplateVars = {};
    if (!audioInfo) {
      return vars;
    }

    if (audioInfo.host) {
      vars.audio_host = audioInfo.host;
    }
    if (audioInfo.user) {
      vars.audio_user = audioInfo.user;
    }
    if (audioInfo.pass) {
      vars.audio_pass = audioInfo.pass;
    }
    return vars;
  }
}
