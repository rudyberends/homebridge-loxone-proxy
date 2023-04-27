import { API } from 'homebridge';
import { LoxonePlatform } from './LoxonePlatform';

export = (api: API) => {
  api.registerPlatform('LoxonePlatform', LoxonePlatform);
};