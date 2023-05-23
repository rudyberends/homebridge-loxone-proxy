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

      const webSocketConfig = new WebSocketConfig(WebSocketConfig.protocol.WS,
        uuid, 'homebridge', WebSocketConfig.permission.APP, false);

      const handleAnyEvent = (uuid: string, message: string): void => {
        this.uuidCache[uuid] = message;
        if (Object.prototype.hasOwnProperty.call(this.uuidCallbacks, uuid)) {
          this.uuidCallbacks[uuid].forEach(callback => callback(message));
        }
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
   * @private
   * @returns {Promise<boolean>} A promise that resolves to true if the connection is successful, false otherwise.
   */
  private connect(): Promise<boolean> {
    this.log.info('Trying to connect to Miniserver');

    return this.socket.open(this.host + ':' + this.port, this.username, this.password)
      .then(() => this.socket.send('data/LoxAPP3.json'))
      .then((file: string) => {
        this.loxdata = JSON.parse(file);
        return this.socket.send('jdev/sps/enablebinstatusupdate');
      })
      .then(() => {
        this.log.info('Connected to Miniserver');
        return true;
      })
      .catch(error => {
        this.log.error('Connection failed: ' + error);
        this.socket.close();
        return false;
      });
  }

  /**
   * Handles the reconnection to the Loxone Miniserver.
   * @private
   */
  private reconnect(): void {
    this.log.info('Reconnecting in 10 seconds...');

    const delay = (ms: number): Promise<void> => {
      return new Promise(resolve => setTimeout(resolve, ms));
    };

    const runTimer = async (): Promise<void> => {
      await delay(10000);
      const success = await this.connect();
      if (!success) {
        this.reconnect();
      }
    };

    runTimer();
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
      this.uuidCallbacks[uuid].forEach(callback => callback(this.uuidCache[uuid]));
    }
  }

  /**
   * Sends a command to the Loxone Miniserver.
   * @param {string} uuid - The UUID of the device.
   * @param {string} action - The action to be performed.
   */
  public sendCommand(uuid: string, action: string): void {
    this.socket.send(`jdev/sps/io/${uuid}/${action}`, 2);
  }

  /**
   * Gets the last cached value for the specified UUID.
   * @param {string} uuid - The UUID of the device.
   * @returns {string} The last cached value for the UUID.
   */
  public getLastCachedValue(uuid: string): string {
    return this.uuidCache[uuid];
  }
}

export default LoxoneHandler;