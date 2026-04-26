import type { LoxonePlatform } from '../LoxonePlatform';

export interface LoxoneCommand {
  uuid: string;
  action: string;
  source?: string;
}

export class LoxoneCommandBus {
  constructor(private readonly platform: LoxonePlatform) {}

  send(uuid: string, action: string, source?: string): Promise<string | undefined> {
    if (source) {
      this.platform.log.debug(`[${source}] Send command to Loxone: ${action}`);
    }

    return this.platform.LoxoneHandler.sendCommand(uuid, action);
  }

  execute(command: LoxoneCommand): Promise<string | undefined> {
    return this.send(command.uuid, command.action, command.source);
  }
}
