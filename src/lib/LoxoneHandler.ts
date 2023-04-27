/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { v4 } from 'uuid';
import * as LxCommunicator from 'lxcommunicator';
import { LoxonePlatform } from '../LoxonePlatform';

const WebSocketConfig = LxCommunicator.WebSocketConfig;

const LoxoneHandler = function (this, platform: LoxonePlatform) {
  this.socket = undefined;
  this.loxdata = undefined;

  this.log = platform.log;

  this.host = platform.config.host;
  this.port = platform.config.port;
  this.username = platform.config.username;
  this.password = platform.config.password;

  this.uuidCallbacks = [];

  // cache of the last value of any uuid received via the websocket
  this.uuidCache = [];

  this.startListener();
};

LoxoneHandler.prototype.startListener = async function () {
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const self = this;

  if (typeof this.socket === 'undefined') {
    this.uuid = v4();

    const webSocketConfig = new WebSocketConfig(WebSocketConfig.protocol.WS,
      this.uuid, 'homebridge', WebSocketConfig.permission.APP, false);

    // eslint-disable-next-line no-inner-declarations
    const handleAnyEvent = (uuid: string, message: string) => {
      //self.log.debug('WS: update event ' + uuid + ':' + message);
      self.uuidCache[uuid] = message;
      if (typeof self.uuidCallbacks[uuid] !== 'undefined') {
        for (let r = 0; r < self.uuidCallbacks[uuid].length; r++) {
          this.log.debug('Sending Callback');
          self.uuidCallbacks[uuid][r](message);
        }
      }
    };

    webSocketConfig.delegate = {
      socketOnDataProgress: (socket: any, progress: string) => {
        this.log.debug('data progress ' + progress);
      },
      socketOnTokenConfirmed: (socket: any, response: any) => {
        this.log.debug('token confirmed');
      },
      socketOnTokenReceived: (socket: any, result: any) => {
        this.log.debug('token received');
      },
      socketOnConnectionClosed: (socket: any, code: string) => {
        this.log.info('Socket closed ' + code);

        if (code !== LxCommunicator.SupportCode.WEBSOCKET_MANUAL_CLOSE) {
          this.reconnect();
        }
      },
      socketOnEventReceived: (socket: any, events: any, type: any) => {
        //this.log.debug(`socket event received ${type} ${JSON.stringify(events)}`);
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

    const success = await this.connect();

    if (!success) {
      this.reconnect();
    }
  }

};

LoxoneHandler.prototype.connect = async function () {
  this.log.info('Trying to connect to Miniserver');

  try {
    await this.socket.open(this.host + ':' + this.port, this.username, this.password);
  } catch (error) {
    this.log.error('Couldn\'t open socket: ' + error);
    return false;
  }

  let file: string;
  try {
    file = await this.socket.send('data/LoxAPP3.json');
  } catch (error) {
    this.log.error('Couldn\'t get structure file: ' + error);
    this.socket.close();
    return false;
  }
  this.loxdata = JSON.parse(file);

  try {
    await this.socket.send('jdev/sps/enablebinstatusupdate');
  } catch (error) {
    this.log.error('Couldn\'t enable status updates: ' + error);
    this.socket.close();
    return false;
  }

  this.log.info('Connected to Miniserver');
  return true;
};

LoxoneHandler.prototype.reconnect = function () {
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const self = this;

  this.log.info('Reconnecting in 10 seconds...');

  function delay(ms: number | undefined) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function runTimer() {
    await delay(10000);
    const success = await self.connect();
    if (!success) {
      self.reconnect();
    }
  }
  runTimer();
};

LoxoneHandler.prototype.registerListenerForUUID = function (uuid: string, callback: any) {
  if (uuid in this.uuidCallbacks) {
    this.uuidCallbacks[uuid].push(callback);
  } else {
    this.uuidCallbacks[uuid] = [callback];
  }

  if (uuid in this.uuidCache) {
    for (let r = 0; r < this.uuidCallbacks[uuid].length; r++) {
      this.uuidCallbacks[uuid][r](this.uuidCache[uuid]);
    }
  }
};

LoxoneHandler.prototype.sendCommand = function (uuid: any, action: any) {
  this.socket.send(`jdev/sps/io/${uuid}/${action}`, 2);
};

LoxoneHandler.prototype.getLastCachedValue = function (uuid: string | number) {
  return this.uuidCache[uuid];
};

export default LoxoneHandler;