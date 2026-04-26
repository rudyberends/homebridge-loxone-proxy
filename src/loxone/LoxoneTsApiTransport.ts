import type { StructureFile } from './StructureFile';
import type { LoxoneEventValue } from './LoxoneTypes';
import type {
  LoxoneDisconnectListener,
  LoxoneErrorListener,
  LoxoneTextEventListener,
  LoxoneTransport,
  LoxoneTransportOptions,
  LoxoneTransportResponse,
  LoxoneValueEventListener,
} from './LoxoneTransport';

interface LoxoneApiUuid {
  stringValue: string;
}

interface LoxoneApiValueEvent {
  uuid: LoxoneApiUuid;
  value: LoxoneEventValue;
}

interface LoxoneApiTextEvent {
  uuid: LoxoneApiUuid;
  text: string;
}

export interface LoxoneApiClient {
  auth?: {
    tokenHandler?: {
      token?: string;
    };
  };
  connect(existingToken?: string): Promise<void>;
  getStructureFile(): Promise<StructureFile>;
  enableUpdates(): Promise<void>;
  control(uuid: string, command: string, timeoutOverride?: number): Promise<LoxoneTransportResponse>;
  addUuidToWatchList(uuid: string | string[]): void;
  on(event: 'event_value', listener: (event: LoxoneApiValueEvent) => void): this;
  on(event: 'event_text', listener: (event: LoxoneApiTextEvent) => void): this;
  on(event: 'disconnected', listener: (reason: string) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

export type LoxoneClientConstructor = new (
  host: string,
  username: string,
  password: string,
  useTls: boolean,
  options?: LoxoneTransportOptions['clientOptions'],
) => LoxoneApiClient;

interface LoxoneApiModule {
  default: LoxoneClientConstructor;
}

export type LoxoneClientLoader = () => Promise<LoxoneClientConstructor>;

const importEsm = new Function(
  'specifier',
  'return import(specifier)',
) as (specifier: string) => Promise<LoxoneApiModule>;

export class LoxoneTsApiTransport implements LoxoneTransport {
  private client: LoxoneApiClient | undefined;
  private readonly watchedUuids = new Set<string>();
  private readonly valueListeners: LoxoneValueEventListener[] = [];
  private readonly textListeners: LoxoneTextEventListener[] = [];
  private readonly disconnectListeners: LoxoneDisconnectListener[] = [];
  private readonly errorListeners: LoxoneErrorListener[] = [];

  constructor(
    private readonly options: LoxoneTransportOptions,
    private readonly loadClient: LoxoneClientLoader = defaultLoxoneClientLoader,
  ) {}

  async connect(existingToken?: string): Promise<void> {
    const client = await this.getOrCreateClient();
    this.applyWatchList();
    await client.connect(existingToken);
  }

  async getStructureFile(): Promise<StructureFile> {
    return this.requireClient().getStructureFile();
  }

  async enableUpdates(): Promise<void> {
    await this.requireClient().enableUpdates();
  }

  async sendCommand(
    uuid: string,
    command: string,
    timeoutOverride?: number,
  ): Promise<LoxoneTransportResponse> {
    return this.requireClient().control(uuid, command, timeoutOverride);
  }

  watch(uuid: string | string[]): void {
    const uuids = Array.isArray(uuid) ? uuid : [uuid];
    uuids.forEach((item) => this.watchedUuids.add(item));
    this.client?.addUuidToWatchList(uuid);
  }

  getActiveCommunicationToken(): string | undefined {
    return this.client?.auth?.tokenHandler?.token;
  }

  onValueEvent(listener: LoxoneValueEventListener): void {
    this.valueListeners.push(listener);
  }

  onTextEvent(listener: LoxoneTextEventListener): void {
    this.textListeners.push(listener);
  }

  onDisconnect(listener: LoxoneDisconnectListener): void {
    this.disconnectListeners.push(listener);
  }

  onError(listener: LoxoneErrorListener): void {
    this.errorListeners.push(listener);
  }

  private async getOrCreateClient(): Promise<LoxoneApiClient> {
    if (this.client) {
      return this.client;
    }

    const LoxoneClient = await this.loadClient();
    const client = new LoxoneClient(
      this.options.host,
      this.options.username,
      this.options.password,
      this.options.useTls,
      this.options.clientOptions,
    );

    this.client = client;
    this.wireClientEvents(client);
    return client;
  }

  private wireClientEvents(client: LoxoneApiClient): void {
    client.on('event_value', (event) => {
      this.valueListeners.forEach((listener) => listener(event.uuid.stringValue, event.value));
    });

    client.on('event_text', (event) => {
      this.textListeners.forEach((listener) => listener(event.uuid.stringValue, event.text));
    });

    client.on('disconnected', (reason) => {
      this.disconnectListeners.forEach((listener) => listener(reason));
    });

    client.on('error', (error) => {
      this.errorListeners.forEach((listener) => listener(error));
    });
  }

  private applyWatchList(): void {
    if (this.watchedUuids.size === 0) {
      return;
    }

    this.requireClient().addUuidToWatchList([...this.watchedUuids]);
  }

  private requireClient(): LoxoneApiClient {
    if (!this.client) {
      throw new Error('Loxone transport is not connected');
    }

    return this.client;
  }
}

async function defaultLoxoneClientLoader(): Promise<LoxoneClientConstructor> {
  const { default: LoxoneClient } = await importEsm('@rudyberends/loxone-ts-api');
  return LoxoneClient;
}
