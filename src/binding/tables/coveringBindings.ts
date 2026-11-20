import type { GateControl, JalousieControl, WindowControl } from 'loxone-ts-client';
import type { BindingTable, CharacteristicBinding } from '../CharacteristicBinding';

// HAP PositionState enum values.
const DECREASING = 0;
const INCREASING = 1;
const STOPPED = 2;
// HAP CurrentDoorState / TargetDoorState enum values.
const DOOR_OPEN = 0;
const DOOR_CLOSED = 1;
const DOOR_OPENING = 2;
const DOOR_CLOSING = 3;
const DOOR_STOPPED = 4;

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

// --- Jalousie → WindowCovering ----------------------------------------------
// Loxone position: 0 = up/open … 1 = down/closed. HomeKit: 0 = closed … 100 = open (REVERSED).

const jalousiePosition = (j: JalousieControl): number => clampPercent(100 - (j.position ?? 0) * 100);

// shadePosition 0 (horizontal) … 1 (vertical) → HomeKit tilt −90 … 90.
const jalousieTilt = (j: JalousieControl): number => Math.max(-90, Math.min(90, (j.slatsPosition ?? 0) * 180 - 90));

export function jalousieBindings(isBlinds: boolean): BindingTable<JalousieControl> {
  const rows: CharacteristicBinding<JalousieControl>[] = [
    { char: 'CurrentPosition', get: jalousiePosition, subscribeTo: 'position' },
    {
      char: 'TargetPosition',
      get: jalousiePosition, // Loxone reports the live position; current == target
      set: (j, value) => j.setPosition(100 - Number(value)),
      subscribeTo: 'position',
    },
    {
      char: 'PositionState',
      get: (j) => (j.isMovingUp ? INCREASING : j.isMovingDown ? DECREASING : STOPPED),
      subscribeTo: ['up', 'down'],
    },
    { char: 'ObstructionDetected', get: () => false },
  ];

  // Slat tilt only applies to blinds (details.animation === 0); HomeKit shows the
  // tilt control whenever the characteristic exists, so add it only for blinds.
  if (isBlinds) {
    rows.push(
      { char: 'CurrentHorizontalTiltAngle', get: jalousieTilt, subscribeTo: 'shadePosition' },
      {
        char: 'TargetHorizontalTiltAngle',
        get: jalousieTilt,
        set: (j, value) => j.setSlats((Number(value) + 90) * 100 / 180),
        subscribeTo: 'shadePosition',
      },
    );
  }
  return rows;
}

// --- Window → Window --------------------------------------------------------
// Loxone position: 0 = closed … 1 = open. HomeKit: 0 = closed … 100 = open (NOT reversed).

export const windowBindings: BindingTable<WindowControl> = [
  { char: 'CurrentPosition', get: (w) => Math.round((w.position ?? 0) * 100), subscribeTo: 'position' },
  {
    char: 'TargetPosition',
    // WindowControl has no typed targetPosition getter yet; read the raw state.
    get: (w) => Math.round((w.state('targetPosition')?.numericValue ?? 0) * 100),
    set: (w, value) => w.setPosition(Number(value)),
    subscribeTo: 'targetPosition',
  },
  {
    char: 'PositionState',
    get: (w) => (w.movement === -1 ? DECREASING : w.movement === 1 ? INCREASING : STOPPED),
    subscribeTo: 'direction',
  },
];

// --- Gate → GarageDoorOpener ------------------------------------------------
// Loxone position: 0 = closed … 1 = open; movement (`active`): -1 closing, 0 idle, 1 opening.

function gateCurrentDoorState(g: GateControl): number {
  if (g.movement === -1) {
    return DOOR_CLOSING;
  }
  if (g.movement === 1) {
    return DOOR_OPENING;
  }
  const position = g.position ?? 0;
  if (position <= 0) {
    return DOOR_CLOSED;
  }
  return position >= 1 ? DOOR_OPEN : DOOR_STOPPED;
}

function gateTargetDoorState(g: GateControl): number {
  if (g.movement === -1) {
    return DOOR_CLOSED;
  }
  if (g.movement === 1) {
    return DOOR_OPEN;
  }
  return (g.position ?? 0) <= 0 ? DOOR_CLOSED : DOOR_OPEN;
}

export const gateBindings: BindingTable<GateControl> = [
  { char: 'CurrentDoorState', get: gateCurrentDoorState, subscribeTo: ['active', 'position'] },
  {
    char: 'TargetDoorState',
    get: gateTargetDoorState,
    set: (g, value) => (Number(value) === DOOR_OPEN ? g.open() : g.close()),
    subscribeTo: ['active', 'position'],
  },
  { char: 'ObstructionDetected', get: () => false },
];
