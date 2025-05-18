<p align="center">
  <img width="1325" alt="logo" src="https://github.com/rudyberends/homebridge-loxone-proxy/assets/75836217/be6b9cee-865c-4f9d-a0c1-dafa0f89047e">
</p>

[![npm](https://badgen.net/npm/v/homebridge-loxone-proxy)](https://npmjs.com/package/homebridge-loxone-proxy)
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![apache-license](https://badgen.net/npm/license/homebridge-loxone-proxy)](https://github.com/0x5e/homebridge-loxone-proxy/blob/main/LICENSE)

Homebridge Dynamic Platform Plugin which exposes a Loxone System to Homekit.

The plugin uses Loxone [Lxcommunicator](https://github.com/Loxone/lxcommunicator) to setup a websocket connection to a Loxone miniserver.
It retrieves the loxone [Structure-File](https://www.loxone.com/wp-content/uploads/datasheets/StructureFile.pdf) and tries to map all items to HomeKit accessories. The websocket connection allows for realtime 2 way updates between Loxone and HomeKit.

# Mapped Items
The following list displays all supported itemtypes supported by this plugin.

|loxone Item |HomeKit Accessory |Mapping |Note
|--- |--- |--- |--- |
| `Alarm` | SecuritySystem | Auto
|`Brightness` | LightSensor | Auto | InfoOnlyAnalog Item. Tries to map based on its format. Can be overridden with a mapping.
| `ColorPickerV2` | Lightbulb | Auto | Individual ColorPickers, or items parsed from LightControllerV2.
| `Dimmer, EIBDimmer` | Lightbulb | Auto | Individual Dimmers, or items parsed from LightControllerV2.
|`Gate` | GarageDoorOpener | Auto
|`Humidity` | HumiditySensor | Auto | InfoOnlyAnalog Item. Tries to map based on its format. Can be overridden with a mapping.
|`Intercom` | Doorbell, Camera | Auto
|`IntercomV2` | Doorbell, MotionSensor, Camera | Auto | "Use in userinterface" has to be enabled on the MotionSensor for it to be detected.
|`IRoomControllerV2` | Thermostat | Auto
|`Jalousie` | Window Covering | Auto
|`Leak` | LeakSensor | Manual | InfoOnlyDigital Item. Requires a mapping.
|`LightControllerV2` | MoodSwitch, Lightbulb | Auto | When enabled, all LightControllerV2 moods are mapped to a Switch Group as a seperate switch. Individual lights are mapped to a Lightbulb.
|`Lock` | LockMechanism | Manual | Switch Item. Requires a mapping. By default, it expects the switch to be ON for the dooor to be locked. There is an option in the config to reverse this behavior.
|`Motion` | MotionSensor | Manual | InfoOnlyDigital Item. Requires a mapping.
|`NfcCodeTouch` | Doorbell, MotionSensor | Auto | It will map to a Doorbell by default. There is an advanced switch in the config to set it to MotionSensor
|`PresenceDetector` | OccupancySensor | Auto
|`Radio` | Switch (Group) | Auto | All Radio outputs are mapped to a Switch Group as a seperate switch.
|`Smoke` | SmokeSensor | Manual | InfoOnlyDigital Item. Requires a mapping.
|`Switch, Pushbutton` | Switch, Outlet, or Lightbulb | Auto | Proxy determines type using the configured icons.
|`Temperature` | TemperatureSensor | Auto | InfoOnlyAnalog Item. Tries to map based on its format. Can be overridden with a mapping.
|`Ventilation` | Fanv2 | Auto
|`WindowMonitor` | ContactSensor | Auto

For the plugin to recognize the items, the item needs to be vissible in the user interface. This can be done by enabling "use" in the userinterface section of the item.

<img width="408" alt="useinuserinterface" src="https://github.com/rudyberends/homebridge-loxone-proxy/assets/75836217/b422015b-4a5d-411e-b98c-42ef86cf8d58">

# Configuration
Configuration of the plugin can be done using the Homebridge UI without having to manually edit the Homebridge config.json file.

## Required Settings
At a minimum, the plugin requires these settings to connect to the miniserver.

| Parameter | Note |
| --- | --- |
| `host` | IP of your loxone miniserver |
| `port` | optional, port of your miniserver (default: 80) |
| `username` | loxone username |
| `password` | loxone password |
| `TLS` | use a secure connection |

If you create a dedicated user for the plugin, you can filter items by only assigning rights to items you want to expose to HomeBridge.

## Filters
Filters allow you to select what to expose to HomeKit.

### Moodswitches
When enabled, all LightControllerV2 moods are mapped to a homekit switch. All Switches from  the same LightController will be grouped together. In homeKit this works as a radio switch, so only one switch (mood) can be active at the same time. Mixing moods is not possible. 

### Exclusions
To exclude Itemtypes from being mapped, they can be added to the Exclussions section in the config. Use a comma-seperated list for multiple ItemTypes.

<img width="748" alt="filters" src="https://github.com/rudyberends/homebridge-loxone-proxy/assets/75836217/c61daa1b-83aa-467b-a258-8b648a6f575e">

The itemtype name can be found in the "mapped items" table.

### Room Filter
The roomfilter List can fuction as a filter for certain rooms. Use a comma-seperated list for multiple Rooms. Depending on the roomfilter Type, this serves as an inclusion, or exclusion list.

## Manual mapping
Some items cannot be mapped automatically and require a naming convention to be recognized. For example, giving all Brightness sensors the convention "MH0'XX'" in Loxone Config 

<img width="408" alt="mapping2" src="https://github.com/rudyberends/homebridge-loxone-proxy/assets/75836217/4fd61eaf-4080-41aa-bdc0-363b5ca0fcb1">

and then setting the alias "MH0" in the plugin will result in all InfoOnlyAnalog items with "MH0" in the name being recognized as LightSensors.

<img width="748" alt="filters" src="https://github.com/rudyberends/homebridge-loxone-proxy/assets/75836217/4ed2ce2b-4003-41bb-930c-f9eee7df517a">

Items that require an alias are listed in the "mapped items" table.

**NOTE:** When the "description" field is set in Loxone Config, then this field is exposed to the plugin instead of the "name" field. For the mapping to work, the description field needst to be empty, or it needs to contain the correct convention. 

# Limitations
Apple does not allow more than 150 items per bridge. This plugin will not map more than 150 items, but if you have other plugins activated, you might still hit this limit. To prevent this you can run this plugin as a child bridge. Another way to solve it is to use a dedicated loxone user for the plugin and only expose the items that you want to use in HomeKit.
