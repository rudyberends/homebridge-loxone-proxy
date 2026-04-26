import type { Service } from 'homebridge';
import type { Control } from '../loxone/StructureFile';
import type { LoxoneUpdateMessage } from '../loxone/LoxoneTypes';

export interface HomeKitServiceAdapter {
  device?: Control;
  service?: Service;
  updateService(message: never): void;
}

export function dispatchHomeKitUpdate(
  service: HomeKitServiceAdapter,
  message: LoxoneUpdateMessage,
): void {
  service.updateService(message as never);
}
