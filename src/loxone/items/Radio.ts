import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Outlet } from '../../homekit/services/Outlet';
import { Switch as SwitchService } from '../../homekit/services/Switch';
import { Switch } from './Switch';

/**
 * Loxone Radio Item
 */
export class Radio extends LoxoneAccessory {

  configureServices(): void {
    this.ItemStates = {
      [this.device.states.activeOutput]: {
        service: 'PrimaryService',
        state: 'activeOutput',
      },
    };

    this.registerRadioSwitches();
  }

  /**
   * Registers virtual switches for radio outputs
   */
  registerRadioSwitches(): void {
    // Insert "allOff" virtual item at 0
    this.device.details!.outputs![0] = this.device.details.allOff;

    const outputs = this.device.details.outputs;

    for (const key in outputs) {
      const rawName = outputs[key];

      const uniqueName = this.platform.generateUniqueName(
        this.device.room,
        rawName,
        `${this.device.uuidAction}:radio:${key}`,
      );

      const radioItem = {
        ...this.device,
        name: uniqueName,
        type: 'Switch',
        cat: key,             // used later to determine active radio output
        details: {},
        subControls: {},
      };

      const serviceType = Switch.determineSwitchType(radioItem, this.platform.config);

      this.platform.log.info(`[Radio: ${uniqueName}] resolved to service type: ${serviceType}`);

      this.Service[uniqueName] =
        serviceType === 'outlet'
          ? new Outlet(this.platform, this.Accessory!, radioItem, this.handleLoxoneCommand.bind(this))
          : new SwitchService(this.platform, this.Accessory!, radioItem, this.handleLoxoneCommand.bind(this));
    }
  }

  /**
   * Updates all radio switches when activeOutput changes
   */
  callBackHandler(message: {
    uuid: string;
    state: string;
    service: string;
    value: string | number;
  }): void {
    const active = Number(message.value);

    for (const serviceName in this.Service) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service: any = this.Service[serviceName];
      message.value = active === Number(service.device.cat) ? 1 : 0;

      const updateService = new Function(
        'message',
        `return this.Service["${serviceName}"].updateService(message);`,
      );
      updateService.call(this, message);
    }
  }

  /**
   * Sends command to Loxone Miniserver
   */
  protected handleLoxoneCommand(value: string): void {
    const numeric = Number(value);
    const command = numeric === 0 ? 'reset' : value;

    this.platform.log.debug(`[${this.device.name}] Send command: ${command}`);
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);
  }
}