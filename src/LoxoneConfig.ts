import { PlatformConfig } from 'homebridge';

export type RoomFilterType = 'inclusion' | 'exclusion';

export interface NormalizedLoxoneConfig {
  excludedTypes: string[];
  roomFilter: {
    type: RoomFilterType;
    rooms: string[];
  };
}

export interface LoxoneConnectionConfig {
  host?: unknown;
  port?: unknown;
  username?: unknown;
  password?: unknown;
}

export function normalizeLoxoneConfig(config: PlatformConfig): NormalizedLoxoneConfig {
  return {
    excludedTypes: parseList(config.Exclusions),
    roomFilter: {
      type: config.roomfilter?.type === 'inclusion' ? 'inclusion' : 'exclusion',
      rooms: parseList(config.roomfilter?.list).map(room => room.toLowerCase()),
    },
  };
}

export function validateLoxoneConnectionConfig(config: LoxoneConnectionConfig): string[] {
  const errors: string[] = [];

  if (!isNonEmptyString(config.host)) {
    errors.push('host is required');
  }

  if (!isNonEmptyString(config.username)) {
    errors.push('username is required');
  }

  if (!isNonEmptyString(config.password)) {
    errors.push('password is required');
  }

  if (config.port !== undefined && config.port !== null && config.port !== '') {
    const port = Number(config.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push('port must be a number between 1 and 65535');
    }
  }

  return errors;
}

export function assertValidLoxoneConnectionConfig(config: LoxoneConnectionConfig): void {
  const errors = validateLoxoneConnectionConfig(config);
  if (errors.length > 0) {
    throw new Error(`Invalid Loxone configuration: ${errors.join(', ')}`);
  }
}

function parseList(value?: string): string[] {
  return value?.split(',').map(item => item.trim()).filter(Boolean) ?? [];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
