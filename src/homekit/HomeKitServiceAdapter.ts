import type { Control } from '../loxone/StructureFile';
import type { LoxoneUpdateMessage } from '../loxone/LoxoneTypes';

export interface HomeKitServiceAdapter {
  device?: Control;
  updateService(message: never): void;
}

export function dispatchHomeKitUpdate(
  service: HomeKitServiceAdapter,
  message: LoxoneUpdateMessage,
): void {
  service.updateService(message as never);
}
