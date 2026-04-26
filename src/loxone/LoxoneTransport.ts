import type { StructureFile } from './StructureFile';
import type { LoxoneEventValue } from './LoxoneTypes';

export interface LoxoneTransportClientOptions {
  autoReconnectEnabled?: boolean;
  keepAliveEnabled?: boolean;
  messageLogEnabled?: boolean;
  logAllEvents?: boolean;
  maintainLatestEvents?: boolean;
}

export interface LoxoneTransportOptions {
  host: string;
  username: string;
  password: string;
  useTls: boolean;
  clientOptions?: LoxoneTransportClientOptions;
}

export interface LoxoneTransportResponse {
  value?: unknown;
  data?: unknown;
  code?: number;
  toString(): string;
}

export type LoxoneValueEventListener = (uuid: string, value: LoxoneEventValue) => void;
export type LoxoneTextEventListener = (uuid: string, text: string) => void;
export type LoxoneDisconnectListener = (reason: string) => void;
export type LoxoneErrorListener = (error: Error) => void;

export interface LoxoneTransport {
  connect(existingToken?: string): Promise<void>;
  getStructureFile(): Promise<StructureFile>;
  enableUpdates(): Promise<void>;
  sendCommand(
    uuid: string,
    command: string,
    timeoutOverride?: number,
  ): Promise<LoxoneTransportResponse>;
  watch(uuid: string | string[]): void;
  getActiveCommunicationToken(): string | undefined;
  onValueEvent(listener: LoxoneValueEventListener): void;
  onTextEvent(listener: LoxoneTextEventListener): void;
  onDisconnect(listener: LoxoneDisconnectListener): void;
  onError(listener: LoxoneErrorListener): void;
}

export type LoxoneTransportFactory = (options: LoxoneTransportOptions) => LoxoneTransport;
