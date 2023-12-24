<p align="center">
<img src="https://github.com/rudyberends/homebridge-loxone-proxy/assets/75836217/a320c391-de67-452e-9dd7-41bb47f3e310" />
</p>

# Homebridge Loxone Proxy 

[![npm](https://badgen.net/npm/v/homebridge-loxone-proxy)](https://npmjs.com/package/homebridge-loxone-proxy)
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![apache-license](https://badgen.net/npm/license/homebridge-loxone-proxy)](https://github.com/0x5e/homebridge-loxone-proxy/blob/main/LICENSE)

Homebridge Proxy which exposes a Loxone System to Homekit.

The plugin uses Loxone [Lxcommunicator](https://github.com/Loxone/lxcommunicator) to setup a websocket connection to a Loxone miniserver.
It retrieves the loxone StructureFile and tries to map all items to HomeKit accessories.

### Mapped Items
The following list displays all supported itemtypes supported by this plugin.

|loxone Item |HomeKit Accessory |Mapping |Note
|--- |--- |--- |--- |
| `Alarm` | SecuritySystem | Auto
|`Brightness` | LightSensor | Manual | Requires an alias in the config.
| `ColorPickerV2` | Lightbulb | Auto | Individual ColorPickers, or items parsed from LightControllerV2.
| `Dimmer` | Lightbulb | Auto | Individual Dimmers, or items parsed from LightControllerV2.
|`Gate` | GarageDoorOpener | Auto
|`Humidity` | HumiditySensor | Manual | Requires an alias in the config.
|`Intercom` | Doorbell, Camera | Auto
|`IntercomV2` | Doorbell, MotionSensor, Camera | Auto | "Use in userinterface" has to be enabled on the MotionSensor for it to be detected.
|`IRoomControllerV2` | Thermostat | Auto
|`Jalousie` | Window Covering | Auto
|`LightControllerV2` | MoodSwitch, Lightbulb | Auto | When enabled, all LightControllerV2 moods are mapped to a Switch Group as a seperate switch. Individual lights are mapped to a Lightbulb.
|`Lock` | LockMechanism | Manual | A switch with an alias that is defined in the config.
|`Motion` | MotionSensor | Manual | Requires an alias in the config.
|`PresenceDetector` | OccupancySensor | Auto
|`Switch, Pushbutton` | Switch, Outlet, or Lightbulb | Auto
|`Temperature` | TemperatureSensor | Manual | Requires an alias in the config.
|`Ventilation` | Fanv2 | Auto
|`WindowMonitor` | ContactSensor | Auto

For the plugin to recognize the items, the item needs to be vissible in the user interface. This can be done by enabling "use" in the userinterface section of the item.

<img width="408" alt="useinuserinterface" src="https://github.com/rudyberends/homebridge-loxone-proxy/assets/75836217/b422015b-4a5d-411e-b98c-42ef86cf8d58">

### Exclusions
To exclude Itemtypes from being mapped, they can be added to the Exclussions section in the config. Use a comma-seperated list for multiple ItemTypes. The itemtype name can be found in the "mapped items" table.

### Manual mapping
Some items cannot be mapped automatically and require a naming convention to be recognized. For example, giving all motion detectors the convention "MoXX" in Loxone Config and then setting the alias "Mo" in the plugin will result in all items with "Mo" in the name being recognized as motion detectors.

Items that require an alias are listed in the table above.

### Limitations

Apple does not allow more than 150 items per bridge. This plugin will not map more than 150 items, but if you have other plugins activated, you might still hit this limit. To prevent this you can run this plugin as a child bridge. Another way to solve it is to use a dedicated loxone user for the plugin and only expose the items that you want to use in HomeKit.
