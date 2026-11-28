# Architecture

This plugin has one product boundary: Loxone <-> HomeKit. The architecture is optimized for that bridge and should stay boring, explicit, and testable.

## Layers

| Layer | Module(s) | Owns | Must not own |
| --- | --- | --- | --- |
| Platform (host) | `LoxonePlatform`, `index.ts` | Homebridge lifecycle and the accessory cache: implements `HomeKitHost` on Homebridge's API. The only modules that import `homebridge`. | Loxone protocol details or item semantics. |
| Core | [`loxone-homekit`](https://github.com/rudyberends/loxone-homekit) (external dependency) | Everything Loxone ⇄ HomeKit: binding coordinator, control binders and tables, room bridges, naming, HKSV/intercom media. See its ARCHITECTURE.md. | Homebridge specifics. |
| Loxone transport | [`loxone-ts-client`](https://www.npmjs.com/package/loxone-ts-client) (via the core; also used directly by the config UI for discovery) | All Miniserver communication. | HomeKit concepts. |
| Config UI | `homebridge-ui/` | Miniserver discovery, room settings, room-bridge pairing codes (from the core's manifest). | Binding logic; its `SUPPORTED_TYPES` copy is checked against the core's `SUPPORTED_CONTROL_TYPES` by a test. |

New Loxone controls, HomeKit mappings and media fixes belong in `loxone-homekit`; this plugin only changes for Homebridge-side concerns (lifecycle, cache, config schema, config UI).

The plugin keeps `@homebridge/camera-utils`, `ffmpeg-for-homebridge` and `@roamhq/wrtc` as dependencies: they are optional peers of the core, needed here for intercom video and talkback.

## Release Rules

Versioning is owned by semantic-release. Use conventional commits:

| Commit | Release |
| --- | --- |
| `fix: ...` | patch |
| `feat: ...` | minor |
| `refactor!: ...` plus `BREAKING CHANGE: ...` footer | major |

Example of a breaking footer:

```text
refactor!: rebuild on a declarative binding engine over loxone-ts-client

BREAKING CHANGE: requires Node.js 22 and replaces lxcommunicator with loxone-ts-client.
```

The `beta` branch publishes prereleases. The `master` branch publishes stable releases.
