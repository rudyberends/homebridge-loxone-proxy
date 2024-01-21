import { SwitchService } from './Switch';

/**
 * Outlet
 * Represents an Outlet service for Homebridge.
 */
export class Outlet extends SwitchService {
  getSwitchType(): any {
    return this.platform.Service.Outlet;
  }
}