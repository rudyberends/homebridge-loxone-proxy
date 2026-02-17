/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { v4 as uuidv4 } from 'uuid';
import * as LxCommunicator from 'lxcommunicator';
import { LoxonePlatform } from '../LoxonePlatform';

const WebSocketConfig = LxCommunicator.WebSocketConfig;

/**
 * Represents a handler for Loxone communication.
 */
class LoxoneHandler {
  private socket: any;
  private loxdata: any;
  private log: any;
  private host: string;
  private port: number;
  private tls: boolean;
  private username: string;
  private password: string;
  private uuidCallbacks: { [uuid: string]: ((message: string) => void)[] };
  private uuidCache: { [uuid: string]: string };

  /**
   * Creates an instance of LoxoneHandler.
   * @param {LoxonePlatform} platform - The Loxone platform instance.
   */
  constructor(platform: LoxonePlatform) {
    this.socket = undefined;
    this.loxdata = undefined;
    this.log = platform.log;
    this.host = platform.config.host;
    this.port = platform.config.port;
    this.tls = platform.config.TLS;
    this.username = platform.config.username;
    this.password = platform.config.password;
    this.uuidCallbacks = {};
    this.uuidCache = {};

    this.startListener();
  }

  /**
   * Starts the listener for Loxone events.
   * @private
   */
  private startListener(): void {
    if (typeof this.socket === 'undefined') {
      const uuid = uuidv4();

      // choose WS or WSS depending on TLS
      const proto = this.tls ? WebSocketConfig.protocol.WSS : WebSocketConfig.protocol.WS;
      const webSocketConfig = new WebSocketConfig(proto,
        uuid, 'homebridge', WebSocketConfig.permission.APP, false);

      const handleAnyEvent = (uuid: string, message: any): void => {
        if (Object.prototype.hasOwnProperty.call(this.uuidCallbacks, uuid)) {
          // Fixes cases where returned data is not in expected structure
          if (typeof message === 'string') {
            if (message.includes('->')) {
              const parts = message.split('->');
              if (parts.length === 2) {
                message = parts[1].trim();
              }
            }
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            message = { uuid: uuid, value: message };
          }
          this.uuidCallbacks[uuid].forEach(callback => callback(message));
        }
        this.uuidCache[uuid] = message; // store in cache
      };

      webSocketConfig.delegate = {
        socketOnDataProgress: (socket: any, progress: string): void => {
          this.log.debug('data progress ' + progress);
        },
        socketOnTokenConfirmed: (socket: any, response: any): void => {
          this.log.debug('token confirmed');
        },
        socketOnTokenReceived: (socket: any, result: any): void => {
          this.log.debug('token received');
        },
        socketOnConnectionClosed: (socket: any, code: string): void => {
          this.log.info('Socket closed ' + code);
          if (code !== LxCommunicator.SupportCode.WEBSOCKET_MANUAL_CLOSE) {
            this.reconnect();
          }
        },
        socketOnEventReceived: (socket: any, events: any, type: any): void => {
          for (const evt of events) {
            switch (type) {
              case LxCommunicator.BinaryEvent.Type.EVENT:
                handleAnyEvent(evt.uuid, evt.value);
                handleAnyEvent(evt.uuid, evt);
                break;
              case LxCommunicator.BinaryEvent.Type.EVENTTEXT:
                handleAnyEvent(evt.uuid, evt.text);
                break;
              case LxCommunicator.BinaryEvent.Type.WEATHER:
                handleAnyEvent(evt.uuid, evt);
                break;
              default:
                break;
            }
          }
        },
      };

      this.socket = new LxCommunicator.WebSocket(webSocketConfig);

      this.connect()
        .catch(error => {
          this.log.error('Couldn\'t open socket: ' + error);
          this.reconnect();
        });
    }
  }

  /**
   * Connects to the Loxone Miniserver.
   * Allows TLS hostnames like 300-400-500-600.serial.dyndns.loxonecloud.com with custom port.
   * @private
   * @returns {Promise<boolean>} A promise that resolves to true if the connection is successful, false otherwise.
   */
  private async connect(): Promise<boolean> {
    this.log.info(`Trying to connect to Miniserver at ${this.host}:${this.port} (TLS=${this.tls})`);

    let url: string;
    if (this.tls) {
      // assume host is already a valid TLS hostname; just prepend https://
      url = `https://${this.host}`;
      if (this.port && this.port !== 443) {
        url += `:${this.port}`;
      }
    } else {
      url = `http://${this.host}:${this.port}`;
    }

    try {
      await this.socket.open(url, this.username, this.password);
      const file = await this.socket.send('data/LoxAPP3.json');
      this.loxdata = JSON.parse(file);
      this.startBinaryStatusUpdates();
      this.log.info('Connected to Miniserver');
      return true;
    } catch (error) {
      this.log.error('Connection failed: ' + error);
      try {
        this.socket.close();
      } catch { /* empty */ }
      return false;
    }
  }

  /**
   * Starts binary status updates from the Miniserver after all listeners are registered.
   */
  private startBinaryStatusUpdates(): void {
    this.log.debug('[LoxoneHandler] Enabling binary status updates...');
    this.socket.send('jdev/sps/enablebinstatusupdate');
  }

  /**
   * Handles the reconnection to the Loxone Miniserver.
   * @private
   */
  private reconnect(attempt = 0): void {
    const delay = Math.min(10000 * (attempt + 1), 60000); // up to 1 min
    this.log.info(`Reconnecting in ${delay / 1000}s...`);
    setTimeout(async () => {
      const success = await this.connect();
      if (!success && attempt < 10) {
        this.reconnect(attempt + 1);
      } else if (!success) {
        this.log.error('Max reconnect attempts reached');
      }
    }, delay);
  }

  /**
   * Registers a listener for the specified UUID.
   * @param {string} uuid - The UUID to listen for.
   * @param {Function} callback - The callback function to be called when an event is received for the UUID.
   */
  public registerListenerForUUID(uuid: string, callback: (message: string) => void): void {
    if (Object.prototype.hasOwnProperty.call(this.uuidCallbacks, uuid)) {
      this.uuidCallbacks[uuid].push(callback);
    } else {
      this.uuidCallbacks[uuid] = [callback];
    }

    if (uuid in this.uuidCache) {
      this.uuidCallbacks[uuid].forEach(cb => cb(this.uuidCache[uuid]));
    }
  }

  /**
   * Sends a command to the Loxone Miniserver.
   * @param {string} uuid - The UUID of the device.
   * @param {string} action - The action to be performed.
   */
  public sendCommand(uuid: string, action: string): Promise<any> {
    return this.socket.send(`jdev/sps/io/${uuid}/${action}`, 2)
      .catch(err => this.log.error(`sendCommand failed: ${err}`));
  }

  /**
   * Gets securedDetails from item.
   * @param {string} uuid - The UUID of the device.
   */
  public getsecuredDetails(uuid: string): Promise<string> {
    return this.socket.send(`jdev/sps/io/${uuid}/securedDetails`);
  }

  /**
   * Returns the active Miniserver communication token if available.
   * Used for authenticated side channels (for example IntercomV2 signaling).
   */
  public getActiveCommunicationToken(): string | undefined {
    try {
      const tokenHandler = this.socket?._tokenHandler;
      if (!tokenHandler?.getToken) {
        return undefined;
      }

      const appToken =
        tokenHandler.getToken(WebSocketConfig.permission.APP, this.username) ??
        tokenHandler.getToken(WebSocketConfig.permission.APP);
      if (appToken?.token) {
        return appToken.token as string;
      }

      const webToken =
        tokenHandler.getToken(WebSocketConfig.permission.WEB, this.username) ??
        tokenHandler.getToken(WebSocketConfig.permission.WEB);
      if (webToken?.token) {
        return webToken.token as string;
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Gets the last cached value for the specified UUID.
   * @param {string} uuid - The UUID of the device.
   * @returns {string} The last cached value for the UUID.
   */
  public getLastCachedValue(uuid: string): string {
    return this.uuidCache[uuid];
  }

  /**
   * Simulates a binary event from cache for a specific UUID.
   * This allows triggering the accessory callback handler even if Loxone did not push the value.
   *
   * @param accessory - The LoxoneAccessory instance (must have ItemStates defined)
   * @param uuid - The UUID of the state to simulate
   */
  public pushCachedState(accessory: { device: any; ItemStates: any; callBackHandler: (msg: any) => void }, uuid: string): void {
    const value = this.getLastCachedValue(uuid);

    if (value === undefined) {
      this.log.debug(`[pushCachedState] No cached value found for UUID: ${uuid}`);
      return;
    }

    const itemState = accessory.ItemStates?.[uuid];
    if (!itemState) {
      this.log.warn(`[pushCachedState] UUID not registered in ItemStates for device ${accessory.device?.name}`);
      return;
    }

    const message = {
      uuid,
      state: itemState.state,
      service: itemState.service,
      value,
    };

    this.log.debug(`[pushCachedState] Pushing Cached state for ${accessory.device?.name} [${itemState.state}] = ${value}`);
    accessory.callBackHandler(message);
  }
}

export default LoxoneHandler;
