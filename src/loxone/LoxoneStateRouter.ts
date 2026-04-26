import type { LoxonePlatform } from '../LoxonePlatform';
import type { LoxoneEventMessage, LoxoneEventValue, LoxoneItemStates, LoxoneUpdateMessage } from './LoxoneTypes';

export interface LoxoneStateTarget {
  device: { name?: string };
  ItemStates: LoxoneItemStates;
  callBackHandler(message: LoxoneUpdateMessage): void;
}

export class LoxoneStateRouter {
  constructor(private readonly platform: LoxonePlatform) {}

  bind(target: LoxoneStateTarget, bindings: LoxoneItemStates): void {
    this.platform.log.debug(`[${target.device.name}] Registering ${Object.keys(bindings).length} state bindings`);

    for (const uuid in bindings) {
      this.platform.LoxoneHandler.registerListenerForUUID(uuid, (message) => {
        this.route(target, message);
      });
    }
  }

  replayCachedState(target: LoxoneStateTarget, uuid: string): void {
    const value = this.getCachedValue(uuid);
    if (value === undefined) {
      this.platform.log.debug(`[StateRouter] No cached value found for UUID: ${uuid}`);
      return;
    }

    const binding = target.ItemStates[uuid];
    if (!binding) {
      this.platform.log.warn(`[StateRouter] UUID not registered in ItemStates for device ${target.device?.name}`);
      return;
    }

    target.callBackHandler({
      uuid,
      service: binding.service,
      state: binding.state,
      value,
    });
  }

  getCachedValue(uuid: string): LoxoneEventValue | undefined {
    return this.platform.LoxoneHandler.getLastCachedValue(uuid);
  }

  private route(target: LoxoneStateTarget, message: LoxoneEventMessage): void {
    const binding = target.ItemStates[message.uuid];
    if (!binding) {
      this.platform.log.debug(`[${target.device.name}] No state binding registered for ${message.uuid}`);
      return;
    }

    target.callBackHandler({
      ...message,
      service: binding.service,
      state: binding.state,
    });
  }
}
