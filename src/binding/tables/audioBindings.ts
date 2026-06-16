import type { AudioZoneV2Control } from 'loxone-ts-client';
import type { BindingTable } from '../CharacteristicBinding';

// Loxone AudioZoneV2 playState: -1 unknown, 0 stopped, 1 paused, 2 playing.
// HAP CurrentMediaState: 0 PLAY, 1 PAUSE, 2 STOP, 4 LOADING, 5 INTERRUPTED.
// HAP TargetMediaState:  0 PLAY, 1 PAUSE, 2 STOP.
function mediaStateFromPlayState(playState: number | undefined): number {
  switch (playState) {
    case 2:
      return 0; // playing → PLAY
    case 1:
      return 1; // paused → PAUSE
    default:
      return 2; // stopped / unknown → STOP
  }
}

// HomeKit Volume is a 0–100 percentage; the Loxone zone volume uses the same range.
function clampVolume(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * AudioZoneV2 (a Loxone Audioserver zone) → HomeKit SmartSpeaker. HomeKit only
 * models transport (play/pause/stop) and volume, so source/playlist/queue/track
 * selection is intentionally not exposed. The zone has no "stop" verb, so STOP
 * maps to pause() — the closest equivalent.
 */
export const audioBindings: BindingTable<AudioZoneV2Control> = [
  {
    char: 'CurrentMediaState',
    get: (a) => mediaStateFromPlayState(a.playState),
    subscribeTo: 'playState',
  },
  {
    char: 'TargetMediaState',
    get: (a) => mediaStateFromPlayState(a.playState),
    set: (a, value) => {
      switch (Number(value)) {
        case 0:
          return a.play();
        case 1:
          return a.pause();
        default:
          return a.pause(); // STOP — no stop command on the zone; pause is the closest
      }
    },
    subscribeTo: 'playState',
  },
  {
    char: 'Volume',
    get: (a) => clampVolume(a.volume),
    set: (a, value) => a.setVolume(clampVolume(Number(value))),
    subscribeTo: 'volume',
  },
];
