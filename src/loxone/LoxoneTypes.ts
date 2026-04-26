import type { Control } from './StructureFile';
import type { LoxonePlatform } from '../LoxonePlatform';

export type LoxoneEventValue =
  | string
  | number
  | boolean
  | Record<string, unknown>
  | unknown[];

export interface LoxoneEventMessage {
  uuid: string;
  value: LoxoneEventValue;
  text?: string;
  [key: string]: unknown;
}

export interface LoxoneUpdateMessage extends LoxoneEventMessage {
  service: string;
  state: string;
}

export type LoxoneItemStates = Record<string, { service: string; state: string }>;

export type LoxoneItemConstructor = new (
  platform: LoxonePlatform,
  device: Control,
) => unknown;
