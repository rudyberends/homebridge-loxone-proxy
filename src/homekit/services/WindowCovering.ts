import { BaseService } from "./BaseService";
import { CharacteristicValue } from "homebridge";

export class WindowCovering extends BaseService {
  State = {
    CurrentPosition: 0,
    TargetPosition: 0,
    PositionState: 2, // Stopped
  };

  setupService(): void {
    this.service =
      this.accessory.getService(this.platform.Service.WindowCovering) ||
      this.accessory.addService(this.platform.Service.WindowCovering);

    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentPosition)
      .onGet(() => this.State.CurrentPosition);

    this.service
      .getCharacteristic(this.platform.Characteristic.TargetPosition)
      .onGet(() => this.State.TargetPosition)
      .onSet((value) => this.handleTargetPositionSet(value));

    this.service
      .getCharacteristic(this.platform.Characteristic.PositionState)
      .onGet(() => this.State.PositionState);
  }

  async handleTargetPositionSet(value: CharacteristicValue): Promise<void> {
    const targetPosition = Number(value);
    if (isNaN(targetPosition)) {
      this.platform.log.error(
        `[${this.device.name}] Invalid target position: ${value}`
      );
      return;
    }

    this.platform.log.debug(
      `[${this.device.name}] Setting target position to ${targetPosition}`
    );

    const command = targetPosition > this.State.CurrentPosition ? "up" : "down";
    this.platform.LoxoneHandler.sendCommand(this.device.uuidAction, command);

    this.State.CurrentPosition = targetPosition;
    if (this.service) {
      this.service
        .getCharacteristic(this.platform.Characteristic.CurrentPosition)
        .updateValue(this.State.CurrentPosition);

      this.State.PositionState =
        targetPosition > this.State.CurrentPosition ? 1 : 0; // Moving up or down
      setTimeout(() => {
        this.State.PositionState = 2; // Stopped
        if (this.service) {
          this.service
            .getCharacteristic(this.platform.Characteristic.PositionState)
            .updateValue(this.State.PositionState);
        }
      }, 1000); // Adjust delay as needed
    } else {
      this.platform.log.error(`[${this.device.name}] Service is undefined`);
    }

    this.platform.log.debug(`[${this.device.name}] Command sent: ${command}`);
  }
}
