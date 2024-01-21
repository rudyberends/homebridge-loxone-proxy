import { Switch } from './Switch';

/**
 * Outlet
 * Represents an Outlet service for Homebridge.
 */
export class Outlet extends Switch {
  getSwitchType(): any {
    return this.platform.Service.Outlet;
  }
}