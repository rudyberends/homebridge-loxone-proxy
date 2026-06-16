import type { PlatformAccessory } from 'homebridge';
import type { ControlHandle, IntercomControl, IntercomSecuredDetails, IntercomV2Control, LoxoneClient } from 'loxone-ts-client';
import type { LoxonePlatform } from '../../LoxonePlatform';
import { sanitizeName } from '../../AccessoryNameRegistry';
import { CameraService, type TwoWayAudioContext, type TwoWayAudioTemplateVars } from '../../homekit/services/Camera';
import { CameraMotionSensor } from '../../homekit/services/CameraMotionSensor';
import { Doorbell } from '../../homekit/services/Doorbell';

/** Accessories whose camera controller has already been configured (configure once, not per rebuild). */
const camerasConfigured = new WeakSet<PlatformAccessory>();

interface IntercomLike extends ControlHandle {
  bell?: boolean;
  securedDetails(): Promise<IntercomSecuredDetails | undefined>;
}

/**
 * Binds an Intercom/IntercomV2 onto its accessory: a Doorbell (rung by the `bell`
 * state), the door-release sub-controls as switches, and — once — the camera +
 * HKSV controller (reusing the existing CameraService glue). The camera stream is
 * derived from the typed handle's `securedDetails()` (V1) or `address` (V2); the
 * Miniserver token for two-way audio now comes from `platform.getCommunicationToken()`.
 *
 * NOTE: the camera/HKSV path cannot be unit/CI-verified — verify against a real
 * intercom in a running Homebridge.
 */
export function bindIntercom(
  platform: LoxonePlatform,
  accessory: PlatformAccessory,
  control: IntercomControl | IntercomV2Control,
  client: LoxoneClient,
  isV2: boolean,
): () => void {
  const disposers: Array<() => void> = [];
  const handle = control as IntercomLike;

  // --- Doorbell (primary service), rung by the `bell` state ---
  const doorbell = new Doorbell(platform, accessory);
  try {
    disposers.push(
      handle.onState('bell', () => {
        if (handle.bell) {
          doorbell.triggerDoorbell();
        }
      }, { emitCurrent: false }),
    );
  } catch (error) {
    platform.log.warn(`[${control.name}] No bell state to subscribe (${(error as Error).message})`);
  }

  // --- Door-release sub-controls as switches ---
  for (const sub of control.control.subControls.values()) {
    const subHandle = client.item(sub);
    if (!subHandle) {
      continue;
    }
    disposers.push(bindDoorReleaseSwitch(platform, accessory, subHandle));
  }

  // --- Camera + HKSV (configure once per accessory) ---
  if (!camerasConfigured.has(accessory)) {
    const doorbellTrigger = { triggerDoorbell: () => doorbell.triggerDoorbell() };
    if (isV2) {
      disposers.push(configureV2Camera(platform, accessory, control as IntercomV2Control, client, doorbellTrigger));
    } else {
      void configureV1Camera(platform, accessory, handle, doorbellTrigger).catch((error) => {
        platform.log.warn(`[${control.name}] Camera configuration failed: ${(error as Error).message}`);
      });
    }
  }

  return () => disposers.forEach((dispose) => dispose());
}

function bindDoorReleaseSwitch(platform: LoxonePlatform, accessory: PlatformAccessory, sub: ControlHandle): () => void {
  const C = platform.Characteristic;
  const subtype = `intercom-sub:${sub.uuid}`;
  const name = sanitizeName(sub.name) || 'Output';
  const service =
    accessory.getServiceById(platform.Service.Switch, subtype) ??
    accessory.addService(platform.Service.Switch, name, subtype);
  service.addOptionalCharacteristic(C.ConfiguredName);
  service.setCharacteristic(C.ConfiguredName, name);

  const readOn = (): boolean => sub.state('active')?.booleanValue ?? false;
  const on = service.getCharacteristic(C.On);
  on.onGet(() => readOn());
  on.onSet(async (value) => {
    await sub.send(value ? 'On' : 'Off');
  });

  if (sub.state('active')) {
    return sub.onState('active', () => on.updateValue(readOn()), { emitCurrent: true });
  }
  return () => undefined;
}

async function configureV1Camera(
  platform: LoxonePlatform,
  accessory: PlatformAccessory,
  handle: IntercomLike,
  doorbellTrigger: { triggerDoorbell: () => void },
): Promise<void> {
  const secured = await handle.securedDetails();
  const videoInfo = secured?.videoInfo;
  if (!videoInfo) {
    platform.log.debug(`[${handle.name}] No videoInfo in securedDetails; camera not configured.`);
    return;
  }

  const user = typeof videoInfo.user === 'string' ? videoInfo.user : '';
  const pass = typeof videoInfo.pass === 'string' ? videoInfo.pass : '';
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const alertImage = typeof videoInfo.alertImage === 'string' ? videoInfo.alertImage : undefined;
  const apiStreamUrl = typeof videoInfo.streamUrl === 'string' ? videoInfo.streamUrl : undefined;

  let streamUrl: string | undefined;
  let snapshotUrl: string | undefined;

  const deviceType = handle.control.details['deviceType'];
  if (deviceType === 0) {
    // Third-party IP camera.
    streamUrl = apiStreamUrl;
    const host = alertImage ? undefined : extractHost(apiStreamUrl);
    snapshotUrl = alertImage ?? (host ? `http://${host}/jpg/image.jpg` : undefined);
  } else {
    // Loxone Intercom V1/XL: the alertImage host serves both MJPEG and snapshots.
    const host = extractHost(alertImage);
    if (host) {
      streamUrl = `http://${host}/mjpg/video.mjpg`;
      snapshotUrl = `http://${host}/jpg/image.jpg`;
    } else if (apiStreamUrl) {
      streamUrl = apiStreamUrl;
      snapshotUrl = alertImage;
    }
  }

  if (!streamUrl) {
    platform.log.warn(`[${handle.name}] No usable stream URL for intercom.`);
    return;
  }

  initializeCamera(platform, accessory, streamUrl, snapshotUrl, auth, doorbellTrigger, buildTwoWayVars(secured), undefined);
}

function configureV2Camera(
  platform: LoxonePlatform,
  accessory: PlatformAccessory,
  control: IntercomV2Control,
  client: LoxoneClient,
  doorbellTrigger: { triggerDoorbell: () => void },
): () => void {
  // The V2 LAN IP arrives asynchronously via the `address` state.
  const handle = control as IntercomLike;
  try {
    return control.onState('address', () => {
      if (camerasConfigured.has(accessory)) {
        return;
      }
      const address = normalizeAddress((control as IntercomV2Control).address);
      if (!address) {
        return;
      }
      const auth = Buffer.from(`${platform.config.username}:${platform.config.password}`, 'utf8').toString('base64');
      const streamUrl = `http://${address}/mjpg/video.mjpg`;
      const twoWayContext: TwoWayAudioContext = { mode: 'loxone-intercom-v2', signalingBaseUrl: `http://${address}` };

      const nativeMotionBound = bindNativeMotion(platform, accessory, control, client);
      const useSnapshotMotion = (platform.config.enableHKSV ?? false) && !nativeMotionBound;
      initializeCamera(platform, accessory, streamUrl, undefined, auth, doorbellTrigger, undefined, twoWayContext, useSnapshotMotion);
    }, { emitCurrent: true });
  } catch (error) {
    platform.log.warn(`[${handle.name}] No address state for IntercomV2 (${(error as Error).message})`);
    return () => undefined;
  }
}

function initializeCamera(
  platform: LoxonePlatform,
  accessory: PlatformAccessory,
  streamUrl: string,
  snapshotUrl: string | undefined,
  auth: string,
  doorbellTrigger: { triggerDoorbell: () => void },
  twoWayVars: TwoWayAudioTemplateVars | undefined,
  twoWayContext: TwoWayAudioContext | undefined,
  enableSnapshotMotion = platform.config.enableHKSV ?? false,
): void {
  if (camerasConfigured.has(accessory)) {
    return;
  }
  camerasConfigured.add(accessory);

  const camera = new CameraService(platform, accessory, streamUrl, snapshotUrl, auth, twoWayVars, twoWayContext);
  if (enableSnapshotMotion) {
    // eslint-disable-next-line no-new -- registers its own polling + characteristics on the accessory
    new CameraMotionSensor(platform, accessory, camera, doorbellTrigger);
    platform.log.info(`[${accessory.displayName}] Camera + snapshot motion configured.`);
  } else {
    platform.log.info(`[${accessory.displayName}] Camera configured: ${streamUrl}`);
  }
}

/** Best-effort native motion sensor for an IntercomV2 (a nearby motion control sharing the device UUID prefix). */
function bindNativeMotion(
  platform: LoxonePlatform,
  accessory: PlatformAccessory,
  control: IntercomV2Control,
  client: LoxoneClient,
): boolean {
  const deviceUuid = control.control.details['deviceUuid'];
  if (typeof deviceUuid !== 'string') {
    return false;
  }
  const prefix = deviceUuid.split('-')[0];
  const candidates = client.items({ includeSubControls: true }).filter(
    (item) =>
      item.uuid.startsWith(prefix) &&
      item.uuid !== control.uuid &&
      item.type !== control.type &&
      item.control.stateNames.length > 0,
  );
  if (candidates.length === 0) {
    return false;
  }

  const best = candidates.sort((a, b) => motionScore(b) - motionScore(a))[0];
  const C = platform.Characteristic;
  const motionName = sanitizeName(`${control.name} Motion`) || 'Motion';
  const service = accessory.getServiceById(platform.Service.MotionSensor, 'intercom-native-motion')
    ?? accessory.addService(platform.Service.MotionSensor, motionName, 'intercom-native-motion');
  const detected = service.getCharacteristic(C.MotionDetected);
  detected.onGet(() => best.state('active')?.booleanValue ?? false);
  if (best.state('active')) {
    best.onState('active', () => detected.updateValue(best.state('active')?.booleanValue ?? false), { emitCurrent: true });
  }
  platform.log.info(`[${control.name}] Native IntercomV2 motion sensor bound (${best.name}).`);
  return true;
}

function motionScore(item: ControlHandle): number {
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

function buildTwoWayVars(secured: IntercomSecuredDetails | undefined): TwoWayAudioTemplateVars | undefined {
  const audio = secured?.audioInfo;
  if (!audio) {
    return undefined;
  }
  const vars: TwoWayAudioTemplateVars = {};
  if (typeof audio.host === 'string') {
    vars.audio_host = audio.host;
  }
  if (typeof audio.user === 'string') {
    vars.audio_user = audio.user;
  }
  if (typeof audio.pass === 'string') {
    vars.audio_pass = audio.pass;
  }
  return vars;
}

function extractHost(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  try {
    return new URL(input).host;
  } catch {
    return input.match(/^(?:https?:\/\/)?([^/?#]+)/i)?.[1];
  }
}

function normalizeAddress(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      return new URL(trimmed).host;
    } catch {
      return undefined;
    }
  }
  return trimmed.split('/')[0];
}
