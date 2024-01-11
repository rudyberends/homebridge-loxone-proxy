import { LoxoneAccessory } from '../../LoxoneAccessory';
import { SwitchService } from '../../homekit/services/Switch';

/**
 * Loxone Radio Item
*/
export class Radio extends LoxoneAccessory {

  configureServices(): void {

    this.ItemStates = {
      [this.device.states.activeOutput]: { 'service': 'PrimaryService', 'state': 'activeOutput' },
    };

    this.registerRadioSwitches();
  }

  // Create Radio Switches
  registerRadioSwitches(): void {

    this.device.details!.outputs![0] = this.device.details.allOff; // allOff Switch

    for (const radioSwitchKey in this.device.details.outputs) {
      const radioSwitch = this.device.details.outputs[radioSwitchKey];
      const radioItem = { ...this.device };
      radioItem.name = `radio_${radioSwitch}`;
      radioItem.type = 'Switch';
      radioItem.cat = radioSwitchKey; // Store ID in CAT field
      radioItem.details = {};

      this.Service[radioItem.name] = new SwitchService(this.platform, this.Accessory!, radioItem, this.handleLoxoneCommand.bind(this));
    }
  }

  callBackHandler(message: { uuid: string; state: string; service: string; value: string | number }): void {
    const currentValue = message.value as number;

    for (const serviceName in this.Service) {
      const service: any = this.Service[serviceName];
      message.value = currentValue as number === parseInt(service.device.cat) ? 1 : 0;

      const updateService = new Function('message', `return this.Service.${serviceName}.updateService(message);`);
      updateService.call(this, message);
    }
  }

  protected handleLoxoneCommand(value : string): void {
    const command = parseInt(value) === 0 ? 'reset' : value;

    this.platform.log.debug(`[${this.device.name}] Send command to Loxone: ${command}`);
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);
  }
}