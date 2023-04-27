
<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>


# Homebridge Loxone Proxy 

Homebridge Proxy which exposes a Loxone System to Homekit.

The plugin uses Loxone Lxcomunicator to setup a websocket connection to a Loxone miniserver.
It retrieves the loxone StructureFile and tries to map all items to HomeKit accessories.

### Mapped Items

|loxone Item |HomeKit Accessory |Mapping |Note
|--- |--- |--- |--- |
| `Alarm` | SecuritySystem | Auto
|`Brightness` | LightSensor | Manual | Requires an alias in the config.
| `Dimmer` | Lightbulb | Auto | Individual Dimmers, or items parsed from LightControllerV2.
|`Gate` | GarageDoorOpener | Auto
|`Humidity` | HumiditySensor | Manual | Requires an alias in the config.
|`IntercomV2` | Doorbell, MotionSensor, Camera | Auto
|`IRoomControllerV2` | Thermostat | Auto
|`Lock` | LockMechanism | Manual | A switch with an alias that is defined in the config.
|`MoodSwitch` | Switch | Auto | all LightControllerV2 moods are maped to a seperate switch.
|`Motion` | MotionSensor | Manual | Requires an alias in the config.
|`PresenceDetector` | OccupancySensor | Auto
|`Switch` | Switch, Outlet, or Lightbulb | Auto
|`Ventilation` | Fanv2 | Auto
