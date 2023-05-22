import { BaseService } from './BaseService';

export class OccupancySensor extends BaseService {

  State = {
    OccupancyDetected: false,
  };

  setupService() {
    this.service =
      this.accessory.getService(this.platform.Service.OccupancySensor) ||
      this.accessory.addService(this.platform.Service.OccupancySensor);

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.OccupancyDetected)
      .onGet(this.handleOccupancyDetectedGet.bind(this));
  }

  updateService( message: { value: boolean} ) {
    this.platform.log.debug(`[${this.device.name}] Callback state update for MotionSensor: ${!!message.value}`);
    this.State.OccupancyDetected = !!message.value;

    //also make sure this change is directly communicated to HomeKit
    this.service!
      .getCharacteristic(this.platform.Characteristic.OccupancyDetected)
      .updateValue(this.State.OccupancyDetected);
  }

  /**
   * Handle requests to get the current value of the "Motion Detected" characteristic
   */
  handleOccupancyDetectedGet() {
    this.platform.log.debug('Triggered GET Occupancy Detected');
    return this.State.OccupancyDetected;
  }
}