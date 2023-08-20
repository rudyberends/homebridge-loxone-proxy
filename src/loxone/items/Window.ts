import { LoxoneAccessory } from '../../LoxoneAccessory';

/**
 * Loxone Window/Door Item
*/
export class Window extends LoxoneAccessory {

  configureServices(): void {

    console.log(this.device.name);
    this.ItemStates = {
      [this.device.states.numOpen]: {'service': 'PrimaryService', 'state': 'numOpen'},
      [this.device.states.numClosed]: {'service': 'PrimaryService', 'state': 'numClosed'},
      [this.device.states.numTilted]: {'service': 'PrimaryService', 'state': 'numTilted'},
      [this.device.states.windowStates]: {'service': 'PrimaryService', 'state': 'windowStates'},
    };

  }
}