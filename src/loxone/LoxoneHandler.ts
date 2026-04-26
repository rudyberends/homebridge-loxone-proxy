import { LoxonePlatform } from '../LoxonePlatform';
import type { StructureFile } from './StructureFile';
import { LoxoneEventMessage, LoxoneEventValue } from './LoxoneTypes';
import type {
  LoxoneTransport,
  LoxoneTransportFactory,
  LoxoneTransportResponse,
} from './LoxoneTransport';
import { LoxoneTsApiTransport } from './LoxoneTsApiTransport';
import {
  assertValidLoxoneConnectionConfig,
  LoxoneConnectionConfig,
} from '../LoxoneConfig';

type LoxoneEventCallback = (message: LoxoneEventMessage) => void;

/**
 * Handles all Miniserver communication through @rudyberends/loxone-ts-api.
 */
class LoxoneHandler {
  public loxdata!: StructureFile;

  private readonly host: string;
  private readonly port: number;
  private readonly tls: boolean;
  private readonly username: string;
  private readonly password: string;
  private readonly uuidCallbacks: Record<string, LoxoneEventCallback[]> = {};
  private readonly uuidCache: Record<string, LoxoneEventMessage> = {};
  private readonly watchedUuids = new Set<string>();
  private readonly configReady: Promise<void>;
  private transport: LoxoneTransport | undefined;
  private resolveConfigReady!: () => void;
  private configResolved = false;

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly transportFactory: LoxoneTransportFactory =
      (options) => new LoxoneTsApiTransport(options),
  ) {
    assertValidLoxoneConnectionConfig(platform.config as LoxoneConnectionConfig);

    this.host = platform.config.host;
    this.port = platform.config.port;
    this.tls = platform.config.TLS;
    this.username = platform.config.username;
    this.password = platform.config.password;
    this.configReady = new Promise((resolve) => {
      this.resolveConfigReady = resolve;
    });

    void this.start();
  }

  private async start(): Promise<void> {
    try {
      const transport = this.transportFactory({
        host: this.buildHost(),
        username: this.username,
        password: this.password,
        useTls: this.tls,
        clientOptions: {
          autoReconnectEnabled: true,
          keepAliveEnabled: true,
          messageLogEnabled: false,
          logAllEvents: false,
          maintainLatestEvents: true,
        },
      });

      this.transport = transport;
      this.wireTransportEvents(transport);
      this.applyWatchList();

      this.platform.log.info(
        `Trying to connect to Miniserver at ${this.buildHost()} (TLS=${this.tls})`,
      );
      await transport.connect();
      await this.loadStructureAndStartUpdates(transport);
    } catch (error) {
      this.platform.log.error(`Connection failed: ${this.formatError(error)}`);
    }
  }

  private wireTransportEvents(transport: LoxoneTransport): void {
    transport.onValueEvent((uuid, value) => {
      this.handleEvent(uuid, value);
    });

    transport.onTextEvent((uuid, text) => {
      this.handleEvent(uuid, text);
    });

    transport.onDisconnect((reason) => {
      this.platform.log.info(`Socket closed: ${reason}`);
    });

    transport.onError((error) => {
      this.platform.log.error(`Loxone client error: ${this.formatError(error)}`);
    });
  }

  private async loadStructureAndStartUpdates(transport: LoxoneTransport): Promise<void> {
    this.loxdata = await transport.getStructureFile();

    if (!this.configResolved) {
      this.configResolved = true;
      this.resolveConfigReady();
    }

    await transport.enableUpdates();
    this.platform.log.info('Connected to Miniserver');
  }

  private buildHost(): string {
    if (!this.port || this.host.includes(':')) {
      return this.host;
    }

    return `${this.host}:${this.port}`;
  }

  private applyWatchList(): void {
    if (!this.transport || this.watchedUuids.size === 0) {
      return;
    }

    this.transport.watch([...this.watchedUuids]);
  }

  public waitForConfig(): Promise<void> {
    return this.configReady;
  }

  public registerListenerForUUID(uuid: string, callback: LoxoneEventCallback): void {
    if (Object.prototype.hasOwnProperty.call(this.uuidCallbacks, uuid)) {
      this.uuidCallbacks[uuid].push(callback);
    } else {
      this.uuidCallbacks[uuid] = [callback];
    }

    this.watchedUuids.add(uuid);
    this.transport?.watch(uuid);

    if (uuid in this.uuidCache) {
      callback(this.uuidCache[uuid]);
    }
  }

  public async sendCommand(uuid: string, action: string): Promise<string | undefined> {
    try {
      await this.waitForConfig();
      const response = await this.transport?.sendCommand(uuid, action, 2000);
      return this.stringifyResponseValue(response);
    } catch (error) {
      this.platform.log.error(`sendCommand failed: ${this.formatError(error)}`);
      return undefined;
    }
  }

  public async getsecuredDetails(uuid: string): Promise<unknown> {
    await this.waitForConfig();

    if (!this.transport) {
      throw new Error('Loxone client is not connected');
    }

    const response = await this.transport.sendCommand(uuid, 'securedDetails');
    return response.value ?? response.data;
  }

  /**
   * Returns the active Miniserver communication token if available.
   * Used for authenticated side channels (for example IntercomV2 signaling).
   */
  public getActiveCommunicationToken(): string | undefined {
    return this.transport?.getActiveCommunicationToken();
  }

  public getLastCachedValue(uuid: string): LoxoneEventValue | undefined {
    return this.uuidCache[uuid]?.value;
  }

  private handleEvent(uuid: string, payload: unknown): void {
    const message = this.normalizeEventMessage(uuid, payload);
    this.uuidCache[uuid] = message;

    if (Object.prototype.hasOwnProperty.call(this.uuidCallbacks, uuid)) {
      this.uuidCallbacks[uuid].forEach(callback => callback(message));
    }
  }

  private normalizeEventMessage(uuid: string, payload: unknown): LoxoneEventMessage {
    if (typeof payload === 'string') {
      let value = payload;
      if (value.includes('->')) {
        const parts = value.split('->');
        if (parts.length === 2) {
          value = parts[1].trim();
        }
      }

      return { uuid, value };
    }

    return {
      uuid,
      value: this.toEventValue(payload),
    };
  }

  private toEventValue(payload: unknown): LoxoneEventValue {
    if (
      typeof payload === 'string' ||
      typeof payload === 'number' ||
      typeof payload === 'boolean' ||
      Array.isArray(payload)
    ) {
      return payload;
    }

    if (payload && typeof payload === 'object') {
      return payload as Record<string, unknown>;
    }

    return '';
  }

  private stringifyResponseValue(response?: LoxoneTransportResponse): string | undefined {
    const value = response?.value ?? response?.data;
    if (value === undefined) {
      return undefined;
    }

    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

export default LoxoneHandler;
