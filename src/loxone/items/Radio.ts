import { LoxoneAccessory } from '../../LoxoneAccessory';
import { Outlet } from '../../homekit/services/Outlet';
import { Switch as SwitchService } from '../../homekit/services/Switch';
import { Switch } from './Switch'; // Access determineSwitchType

/**
 * Loxone Radio Item
 */
export class Radio extends LoxoneAccessory {

  configureServices(): void {
    this.ItemStates = {
      [this.device.states.activeOutput]: { service: 'PrimaryService', state: 'activeOutput' },
    };

    this.registerRadioSwitches();
  }

  /**
   * Registers virtual switches for radio outputs.
   */
  registerRadioSwitches(): void {
    // Add "allOff" virtual output to outputs[0]
    this.device.details!.outputs![0] = this.device.details.allOff;

    for (const radioSwitchKey in this.device.details.outputs) {
      const rawName = this.device.details.outputs[radioSwitchKey];
      const uniqueName = this.platform.generateUniqueName(this.device.room, rawName);

      const radioItem = {
        ...this.device,
        name: uniqueName,
        type: 'Switch',
        cat: radioSwitchKey, // Store the radio ID in 'cat' for callback reference
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
   * Updates the on/off state of each radio output switch.
   */
  callBackHandler(message: { uuid: string; state: string; service: string; value: string | number }): void {
    const currentValue = message.value as number;

    for (const serviceName in this.Service) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service: any = this.Service[serviceName];
      message.value = currentValue === parseInt(service.device.cat) ? 1 : 0;

      const updateService = new Function(
        'message',
        `return this.Service["${serviceName}"].updateService(message);`,
      );
      updateService.call(this, message);
    }
  }

  /**
   * Sends the selected radio output or reset command to Loxone.
   */
  protected handleLoxoneCommand(value: string): void {
    const command = parseInt(value) === 0 ? 'reset' : value;
    this.platform.log.debug(`[${this.device.name}] Send command to Loxone: ${command}`);
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);
  }
}
