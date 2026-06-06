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
  /**
   * When true, services left on a restored accessory that are not part of this
   * plan are removed. Only safe for accessories whose plan is the complete set
   * of services (grouped switches); accessories that add services outside the
   * plan (e.g. cameras configured asynchronously) must leave this unset.
   */
  pruneStale?: boolean;
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
