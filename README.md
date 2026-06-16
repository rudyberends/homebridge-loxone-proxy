<p align="center">
  <img width="1325" alt="logo" src="https://github.com/rudyberends/homebridge-loxone-proxy/assets/75836217/be6b9cee-865c-4f9d-a0c1-dafa0f89047e">
</p>

[![npm](https://badgen.net/npm/v/homebridge-loxone-proxy)](https://npmjs.com/package/homebridge-loxone-proxy)
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![apache-license](https://badgen.net/npm/license/homebridge-loxone-proxy)](https://github.com/0x5e/homebridge-loxone-proxy/blob/main/LICENSE)

Homebridge Dynamic Platform Plugin which exposes a Loxone System to Homekit.

The plugin uses [`loxone-ts-client`](https://www.npmjs.com/package/loxone-ts-client) to set up and maintain the connection to a Loxone Miniserver.
It retrieves the Loxone [Structure-File](https://www.loxone.com/wp-content/uploads/datasheets/StructureFile.pdf) and maps supported controls to HomeKit accessories. The connection allows realtime two-way updates between Loxone and HomeKit.

# Requirements

| Requirement | Version |
| --- | --- |
| Node.js | 22 or newer |
| Homebridge | 1.7.0 or newer, including Homebridge 2 beta |

# Architecture

This plugin is intentionally focused on one integration path: Loxone <-> HomeKit. The current architecture keeps that path explicit:

| Layer | Responsibility |
| --- | --- |
| Loxone communication | Connects to the Miniserver through `loxone-ts-client`, loads the Structure File, subscribes to state updates, and sends commands. |
| Control mapping | Normalizes Loxone rooms, categories, controls, states, and command bindings into plugin-owned types. |
| Accessory planning | Converts each supported Loxone control into a declarative HomeKit accessory plan. |
| HomeKit reconciliation | Creates, updates, restores, and removes Homebridge platform accessories from those plans. |
| Services | Bind HomeKit characteristics to Loxone state IDs and command IDs. |

Commands and states are kept separate on purpose. Item implementations describe what HomeKit should expose, which Loxone state UUIDs feed it, and which Loxone command should be executed for each HomeKit action. Runtime code then routes state updates and command execution through shared infrastructure instead of letting each item talk to the Miniserver directly.

The Loxone transport is also explicit. All Miniserver communication (websocket, token authentication, Structure File parsing, encrypted commands, state subscriptions) lives in the standalone [`loxone-ts-client`](https://www.npmjs.com/package/loxone-ts-client) package. This plugin depends on it and adds only the HomeKit binding layer on top, so the ownership boundary between "talking to Loxone" and "exposing it to HomeKit" stays clear.

The detailed architecture rules and release commit conventions are documented in [ARCHITECTURE.md](ARCHITECTURE.md).

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
|`Intercom` | Doorbell, Camera | Auto | Full HKSV support with prebuffered recording
|`IntercomV2` | Doorbell, MotionSensor, Camera | Auto | "Use in userinterface" has to be enabled on the MotionSensor for it to be detected. Full HKSV support with prebuffered recording.
| `Irrigation` | IrrigationSystem | Auto
|`IRoomControllerV2` | Thermostat | Auto
|`Jalousie` | Window Covering | Auto
|`Leak` | LeakSensor | Manual | InfoOnlyDigital Item. Requires a mapping.
|`LightControllerV2` | MoodSwitch, Lightbulb | Auto | When enabled, all LightControllerV2 moods are mapped to a Switch Group as a seperate switch. Individual lights are mapped to a Lightbulb.
|`Lock` | LockMechanism | Manual | Switch Item. Requires a mapping. By default, it expects the switch to be ON for the dooor to be locked. There is an option in the config to reverse this behavior.
|`Motion` | MotionSensor | Manual | InfoOnlyDigital Item. Requires a mapping.
|`NfcCodeTouch` | Doorbell, MotionSensor | Auto | It will map to a Doorbell by default. There is an advanced switch in the config to set it to MotionSensor.
|`PresenceDetector` | OccupancySensor | Auto
|`Radio` | Switch (Group) | Auto | All Radio outputs are mapped to a Switch Group as a seperate switch.
|`Smoke` | SmokeSensor | Manual | InfoOnlyDigital Item. Requires a mapping.
|`Switch, Pushbutton` | Switch, Outlet, or Lightbulb | Auto | Proxy determines type using the configured icons.
|`Temperature` | TemperatureSensor | Auto | InfoOnlyAnalog Item. Tries to map based on its format. Can be overridden with a mapping.
|`Ventilation` | Fanv2 | Auto
|`WindowMonitor` | ContactSensor | Auto
|`Window` | Window | Auto

For the plugin to recognize the items, the item needs to be visible in the user interface. This can be done by enabling "use" in the userinterface section of the item.

<img width="408" alt="useinuserinterface" src="https://github.com/rudyberends/homebridge-loxone-proxy/assets/75836217/b422015b-4a5d-411e-b98c-42ef86cf8d58">

# Configuration

The plugin ships a **custom configuration UI** for the Homebridge UI — there is no need to edit `config.json` by hand. Open the plugin settings in Homebridge and you get a tabbed interface:

- **Connection** — Miniserver host, port, credentials and TLS. The plugin can auto-discover Miniservers on your network, so you can pick one instead of typing the IP.
- **Room filter** — per-room control over what is exposed and how (see [Per-room bridges](#per-room-bridges)).
- **Control types** — exclude whole item types from being mapped.
- **Options** — general behaviour (mood switches, ventilation override, …).
- **Mappings** — aliases for items that need manual mapping.
- **HomeKit Secure Video** — enable HKSV and two-way audio.

## Connection
At a minimum the plugin needs these to connect to the Miniserver:

| Parameter | Note |
| --- | --- |
| `host` | IP/hostname of your Loxone Miniserver (without `http://`) |
| `port` | Miniserver port (default: 80) |
| `username` | Loxone username |
| `password` | Loxone password |
| `TLS` | Use a secure (TLS) connection |

If you create a dedicated Loxone user for the plugin, you can filter items by only granting that user rights to the items you want to expose to HomeKit.

## Control types (exclusions)
To stop whole item types from being mapped, exclude them on the **Control types** tab (stored as the `Exclusions` list). Matching is case-sensitive; the item type names are listed in the [Mapped Items](#mapped-items) table.

## Room filter & per-room bridges
The **Room filter** tab lists every Loxone room and lets you choose, per room:

- **Expose** — whether the room's controls are mapped to HomeKit at all.
- **Own bridge** — publish that room as its own HomeKit bridge (see below).

Central functions (Loxone's *central* room type, e.g. "Woning"/"Home") are always kept on the main bridge — they aren't a physical room. The legacy `roomfilter` inclusion/exclusion list is still honored for older configs.

### Per-room bridges
HomeKit's biggest quirk with a single bridge is that **all** of that bridge's accessories land in whichever HomeKit room you assign the bridge to — Loxone's room layout is lost. To fix that, you can give a room its **own HomeKit bridge** straight from this plugin (no separate child-bridge process is needed). Each room bridge:

- Is named after the room (e.g. "Woonkamer").
- Has its own pairing code, shown inline in the Room filter tab.
- Keeps its pairing across restarts (its identity is derived from the room name).

**Pairing workflow** — this is what makes the room assignment stick: in the Home app, first open the **target room**, then tap **Add Accessory → More options…**, pick the room's bridge and enter the code shown in the UI. HomeKit drops the freshly-paired accessories into the room you had open.

## Mood switches
When enabled (Options tab), all LightControllerV2 moods are mapped to HomeKit switches, grouped per LightController. In HomeKit this behaves like a radio group: only one mood can be active at a time, and mixing moods is not possible.

## Manual mapping (aliases)
Some items cannot be classified automatically and need a naming convention. For example, give all Brightness sensors the convention `MH0'XX'` in Loxone Config

<img width="408" alt="mapping2" src="https://github.com/rudyberends/homebridge-loxone-proxy/assets/75836217/4fd61eaf-4080-41aa-bdc0-363b5ca0fcb1">

and set the alias `MH0` on the **Mappings** tab; every InfoOnlyAnalog item whose name starts with `MH0` is then exposed as a LightSensor.

<img width="748" alt="alias example" src="https://github.com/rudyberends/homebridge-loxone-proxy/assets/75836217/4ed2ce2b-4003-41bb-930c-f9eee7df517a">

Items that require an alias are listed in the [Mapped Items](#mapped-items) table.

**NOTE:** When the "description" field is set in Loxone Config, that field is exposed to the plugin instead of the "name" field. For the mapping to work, the description field must be empty or contain the correct convention.

# HomeKit Secure Video & Intercom
Loxone `Intercom` and `IntercomV2` controls are exposed as a Doorbell + Camera (and, for IntercomV2, a motion sensor). Enable **HomeKit Secure Video** on the HKSV tab (`enableHKSV`) to add motion/doorbell-triggered recording with a rolling prebuffer, so the seconds *before* an event are captured too. Recordings follow the resolution, frame rate and bitrate HomeKit negotiates.

**Two-way audio (experimental).** Enable *Two-Way Audio* under Advanced. Loxone Intercom V2 uses automatic WebRTC talkback, so no extra configuration is needed. For non-Loxone cameras you can supply FFmpeg return-audio output args (`TwoWayAudioOutputArgs`) using the `{camera_host}`, `{stream_url}`, `{audio_host}`, `{audio_user}` and `{audio_pass}` placeholders.

# Limitations
Apple does not allow more than 150 accessories per bridge. This plugin will not map more than 150 items on a single bridge, but if you have other plugins active you might still hit the limit. Ways to stay under it: split rooms onto their [own bridges](#per-room-bridges), run this plugin as a child bridge, or use a dedicated Loxone user and only expose the items you actually want in HomeKit.
