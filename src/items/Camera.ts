import { PlatformAccessory, Service, CameraControllerOptions } from 'homebridge';
import { LoxonePlatform } from '../LoxonePlatform';
import { IntercomStreamer } from '../lib/IntercomStreamer';

export class Camera {
  private CameraOperatingMode: Service;
  private CameraRTPStreamManagement: Service;
  private DataStreamManagement: Service;
  private CameraRecordingManagement: Service;
  //private device: Control;

  constructor(
    private readonly platform: LoxonePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly ip: string,
  ) {

    this.CameraOperatingMode =
      this.accessory.getService(this.platform.Service.CameraOperatingMode) ||
      this.accessory.addService(this.platform.Service.CameraOperatingMode);

    this.CameraOperatingMode.getCharacteristic(this.platform.Characteristic.EventSnapshotsActive)
      .onGet(this.handleEventSnapshotsActiveGet.bind(this))
      .onSet(this.handleEventSnapshotsActiveSet.bind(this));

    this.CameraOperatingMode.getCharacteristic(this.platform.Characteristic.PeriodicSnapshotsActive)
      .onGet(this.handlePeriodicSnapshotsActiveGet.bind(this))
      .onSet(this.handlePeriodicSnapshotsActiveSet.bind(this));

    this.CameraOperatingMode.getCharacteristic(this.platform.Characteristic.HomeKitCameraActive)
      .onGet(this.handleHomeKitCameraActiveGet.bind(this))
      .onSet(this.handleHomeKitCameraActiveSet.bind(this));

    this.CameraRTPStreamManagement =
      this.accessory.getService(this.platform.Service.CameraRTPStreamManagement) ||
      this.accessory.addService(this.platform.Service.CameraRTPStreamManagement);

    this.CameraRTPStreamManagement.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.handleActive.bind(this));

    this.DataStreamManagement =
      this.accessory.getService(this.platform.Service.DataStreamTransportManagement) ||
      this.accessory.addService(this.platform.Service.DataStreamTransportManagement);

    this.DataStreamManagement.getCharacteristic(this.platform.Characteristic.Version)
      .onGet(this.handleVersionGet.bind(this));

    this.CameraRecordingManagement =
      this.accessory.getService(this.platform.Service.CameraRecordingManagement) ||
      this.accessory.addService(this.platform.Service.CameraRecordingManagement);

    this.CameraRecordingManagement.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.handleActiveGet.bind(this))
      .onSet(this.handleActiveSet.bind(this));


    const streamingDelegate = new IntercomStreamer(this.platform, this.platform.api.hap, ip);
    const options: CameraControllerOptions = {
      cameraStreamCount: 5, // HomeKit requires at least 2 streams, but 1 is also just fine
      delegate: streamingDelegate,

      streamingOptions: {
        srtp: true, // legacy option which will just enable AES_CM_128_HMAC_SHA1_80 (can still be used though)
        // eslint-disable-next-line max-len
        supportedCryptoSuites: [this.platform.api.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          codec: {
            profiles: [
              this.platform.api.hap.H264Profile.BASELINE,
              this.platform.api.hap.H264Profile.MAIN,
              this.platform.api.hap.H264Profile.HIGH,
            ],
            levels: [
              this.platform.api.hap.H264Level.LEVEL3_1,
              this.platform.api.hap.H264Level.LEVEL3_2,
              this.platform.api.hap.H264Level.LEVEL4_0,
            ],
          },
          resolutions: [
            [1280, 720, 30],
            [1024, 768, 30],
            [640, 480, 30],
            [640, 360, 30],
            [480, 360, 30],
            [480, 270, 30],
            [320, 240, 30],
            [320, 240, 15], // Apple Watch requires this configuration (Apple Watch also seems to required OPUS @16K)
            [320, 180, 30],
          ],
        },
      },
    };

    const cameraController = new this.platform.api.hap.CameraController(options);
    streamingDelegate.controller = cameraController;

    this.accessory.configureController(cameraController);
  }

  handleActive() {
    return 1;
  }

  /**
   * Handle requests to get the current value of the "Event Snapshots Active" characteristic
   */
  handleEventSnapshotsActiveGet() {
    this.platform.log.debug('Triggered GET EventSnapshotsActive');

    // set this to a valid value for EventSnapshotsActive
    const currentValue = this.platform.Characteristic.EventSnapshotsActive.DISABLE;

    return currentValue;
  }

  /**
   * Handle requests to set the "Event Snapshots Active" characteristic
   */
  handleEventSnapshotsActiveSet(value) {
    this.platform.log.debug('Triggered SET EventSnapshotsActive:'+ value);
  }

  /**
   * Handle requests to get the current value of the "Periodic Snapshots Active" characteristic
   */
  handlePeriodicSnapshotsActiveGet() {
    this.platform.log.debug('Triggered GET PeriodicSnapshotsActive');
    const currentValue = this.platform.Characteristic.PeriodicSnapshotsActive.DISABLE;
    return currentValue;
  }

  /**
   * Handle requests to set the "Periodic Snapshots Active" characteristic
   */
  handlePeriodicSnapshotsActiveSet(value) {
    this.platform.log.debug('Triggered SET PeriodicSnapshotsActive:'+ value);
  }

  /**
   * Handle requests to get the current value of the "HomeKit Camera Active" characteristic
   */
  handleHomeKitCameraActiveGet() {
    this.platform.log.debug('Triggered GET HomeKitCameraActive');

    // set this to a valid value for HomeKitCameraActive
    const currentValue = this.platform.Characteristic.HomeKitCameraActive.OFF;
    return currentValue;
  }

  /**
   * Handle requests to set the "HomeKit Camera Active" characteristic
   */
  handleHomeKitCameraActiveSet(value) {
    this.platform.log.debug('Triggered SET HomeKitCameraActive:'+ value);
  }

  /**
   * Handle requests to get the current value of the "Version" characteristic
   */
  handleVersionGet() {
    this.platform.log.debug('Triggered GET Version');
    const currentValue = 1;
    return currentValue;
  }

  /**
   * Handle requests to get the current value of the "Active" characteristic
   */
  handleActiveGet() {
    this.platform.log.debug('Triggered GET Active');

    // set this to a valid value for Active
    const currentValue = this.platform.Characteristic.Active.INACTIVE;

    return currentValue;
  }

  /**
   * Handle requests to set the "Active" characteristic
   */
  handleActiveSet(value) {
    this.platform.log.debug('Triggered SET Active:' + value);
  }
}