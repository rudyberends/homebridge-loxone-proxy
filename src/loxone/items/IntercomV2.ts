import { Intercom } from './Intercom';
import { MotionSensor } from '../../homekit/services/MotionSensor';
import { Control } from '../StructureFile';

/**
 * IntercomV2
 *
 * Handles Loxone Intercom V2 devices. The camera IP is provided via the
 * "address" state and must be listened for asynchronously. V2 exposes a
 * direct MJPEG stream with no snapshot endpoint.
 *
 * Native Loxone motion is preferred when available. If HKSV is enabled and no
 * native motion is found, snapshot-based motion detection is used as fallback.
 */
export class IntercomV2 extends Intercom {

  /**
   * Waits for the V2 intercom to report its LAN IP address. Once received,
   * constructs the direct MJPEG stream URL and initializes the camera.
   */
  async configureCamera(): Promise<void> {
    let isConfigured = false;

    this.platform.LoxoneHandler.registerListenerForUUID(
      this.device.states.address,
      (value: unknown) => {

        if (isConfigured) {
          return;
        }

        const address = this.normalizeAddress(value);

        if (!address) {
          return this.platform.log.debug(`[${this.device.name}] Invalid IP for IntercomV2.`);
        }

        const username = this.platform.config.username;
        const password = this.platform.config.password;
        const auth = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');

        const nativeMotionBound = this.bindNativeMotionSensor();
        const enableHKSV = this.platform.config.enableHKSV ?? false;
        const useSnapshotMotion = enableHKSV && !nativeMotionBound;

        // Intercom V2 provides a fixed MJPEG stream path
        const streamUrl = `http://${address}/mjpg/video.mjpg`;
        const twoWayAudioContext = {
          mode: 'loxone-intercom-v2' as const,
          signalingBaseUrl: `http://${address}`,
        };

        // Uses base-class initializer (handles HKSV motion, logging, etc.)
        this.initializeCamera(
          streamUrl,
          undefined,
          auth,
          useSnapshotMotion,
          undefined,
          twoWayAudioContext,
        );
        isConfigured = true;
      },
    );
  }

  private bindNativeMotionSensor(): boolean {
    const deviceUuid = this.device.details.deviceUuid;
    if (!deviceUuid) {
      return false;
    }

    const uuidPrefix = deviceUuid.split('-')[0];
    const candidates = Object.entries(this.platform.LoxoneItems)
      .filter(([uuid, item]) =>
        uuid.startsWith(uuidPrefix) &&
        item.uuidAction !== this.device.uuidAction &&
        item.type !== this.device.type &&
        Object.keys(item.states ?? {}).length > 0,
      );

    if (!candidates.length) {
      this.platform.log.debug(`[${this.device.name}] No native IntercomV2 motion candidate found.`);
      return false;
    }

    const [, motionDevice] = this.pickBestMotionCandidate(candidates);
    const serviceName = 'NativeMotion';

    this.Service[serviceName] = new MotionSensor(this.platform, this.Accessory!, motionDevice);

    for (const stateName in motionDevice.states) {
      const stateUuid = motionDevice.states[stateName];
      this.platform.LoxoneHandler.registerListenerForUUID(stateUuid, (message: unknown) => {
        const normalized = this.normalizeBinaryValue(message);
        if (normalized === undefined) {
          return;
        }

        (this.Service[serviceName] as MotionSensor).updateService({ value: normalized });
      });
    }

    this.platform.log.info(`[${this.device.name}] Native IntercomV2 motion sensor bound.`);
    return true;
  }

  private pickBestMotionCandidate(candidates: [string, Control][]): [string, Control] {
    const scored = candidates
      .map(([uuid, item]) => ({
        uuid,
        item,
        score: this.motionCandidateScore(item),
      }))
      .sort((a, b) => b.score - a.score);

    return [scored[0].uuid, scored[0].item];
  }

  private motionCandidateScore(item: Control): number {
    const label = `${item.type} ${item.name}`.toLowerCase();
    let score = 0;

    if (item.type === 'InfoOnlyDigital') {
      score += 10;
    }

    if (label.includes('motion') || label.includes('beweging') || label.includes('presence')) {
      score += 6;
    }

    if (label.includes('intercom') || label.includes('doorbell')) {
      score += 2;
    }

    return score;
  }

  private normalizeAddress(value: unknown): string | undefined {
    const rawValue =
      typeof value === 'string'
        ? value
        : (value && typeof value === 'object' && 'value' in value)
          ? String((value as { value?: unknown }).value ?? '')
          : '';

    const trimmed = rawValue.trim();
    if (!trimmed) {
      return undefined;
    }

    // If state already includes URL, reduce to host[:port]
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      try {
        return new URL(trimmed).host;
      } catch {
        return undefined;
      }
    }

    // Strip accidental path suffix (e.g. "192.168.1.20/mjpg/video.mjpg")
    return trimmed.split('/')[0];
  }

  private normalizeBinaryValue(message: unknown): number | undefined {
    const raw =
      typeof message === 'number' || typeof message === 'string'
        ? message
        : (message && typeof message === 'object' && 'value' in message)
          ? (message as { value?: unknown }).value
          : undefined;

    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      return undefined;
    }

    return numeric === 0 ? 0 : 1;
  }
}
