import type { Control } from '../loxone/StructureFile';
import type { LoxoneItemStates } from '../loxone/LoxoneTypes';
import type { HomeKitServiceKind } from '../homekit/HomeKitServiceFactory';

export interface CommandActionContext {
  device?: Control;
  service?: unknown;
}

export interface CommandBinding {
  uuid?: string;
  action: string | ((value: unknown, context: CommandActionContext) => string | undefined);
  source?: string;
}

export interface ServicePlan {
  id: string;
  kind: HomeKitServiceKind;
  name?: string;
  device?: Control;
  commands?: Record<string, CommandBinding>;
}

export interface AccessoryPlan {
  id: string;
  displayName: string;
  room: string;
  serviceLabels?: {
    namespace: 'arabic-numerals' | 'dots';
  };
  source: {
    type: string;
    uuidAction: string;
    originalName: string;
  };
  context: {
    device: Control;
  };
  services: ServicePlan[];
  stateBindings: LoxoneItemStates;
}
