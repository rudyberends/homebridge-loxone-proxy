import { Switch } from './Switch';

/**
 * Outlet
 * Represents an Outlet service for Homebridge.
 */
export class Outlet extends Switch {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSwitchType(): any {
    return this.platform.Service.Outlet;
  }
}