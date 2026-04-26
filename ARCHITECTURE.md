# Architecture

This plugin has one product boundary: Loxone <-> HomeKit. The architecture is optimized for that bridge and should stay boring, explicit, and testable.

## Layers

| Layer | Owns | Must not own |
| --- | --- | --- |
| `LoxoneTransport` | The plugin-owned communication contract. | HomeKit concepts or item mapping. |
| `LoxoneTsApiTransport` | Adapting `@rudyberends/loxone-ts-api` to `LoxoneTransport`. | Loxone item semantics or HomeKit behavior. |
| `LoxoneHandler` | Connection orchestration, Structure File loading, command dispatch, state callback cache. | Concrete `loxone-ts-api` client details. |
| `LoxoneControlMapper` | Structure File normalization, room/category metadata, filtering. | Creating HomeKit services directly. |
| Item classes | Declarative accessory/service plans, command bindings, state bindings. | Sending commands directly to Loxone. |
| `LoxoneCommandBus` | Executing resolved command bindings. | Inventing command strings. |
| `LoxoneStateRouter` | Routing Loxone state UUID updates to accessories. | Parsing HomeKit service behavior. |
| HomeKit services | Binding characteristics to command IDs and state IDs. | Talking to Loxone transport directly. |
| `AccessoryReconciler` | Homebridge accessory cache reconciliation. | Loxone command/state semantics. |

## Command And State Rules

- Loxone command strings belong in item plans.
- HomeKit services refer to command IDs, not raw Loxone command strings.
- Loxone state UUIDs belong in item state bindings.
- Runtime command execution goes through `LoxoneCommandBus`.
- Runtime state updates go through `LoxoneStateRouter`.
- Item classes must not call `LoxoneHandler.sendCommand()` directly.
- HomeKit service classes must not call `LoxoneHandler` or `LoxoneTransport` directly.

## Transport Boundary

`@rudyberends/loxone-ts-api` is maintained together with this plugin, so the adapter is intentionally thin. The boundary still matters because it gives the plugin a stable internal contract:

- tests can run without a Miniserver;
- `LoxoneHandler` stays independent from concrete client event shapes;
- transport behavior can evolve in `loxone-ts-api` without leaking into HomeKit mapping code.

## Intercom Boundary

Intercom and IntercomV2 are intentionally treated as a separate bounded context. They include HKSV, signaling, prebuffering, talkback, camera streams, and token use. Those flows are not the same as normal command/state accessories.

The command/state architecture should keep supporting regular Intercom accessory planning where useful, but Intercom-specific media and signaling code should remain isolated from the generic command bus and state router rules.

## Release Rules

Versioning is owned by semantic-release. Use conventional commits:

| Commit | Release |
| --- | --- |
| `fix: ...` | patch |
| `feat: ...` | minor |
| `refactor!: ...` plus `BREAKING CHANGE: ...` footer | major |

For breaking beta refactors, prefer:

```text
refactor!: migrate Loxone communication to loxone-ts-api

BREAKING CHANGE: requires Node.js 20 and replaces lxcommunicator with @rudyberends/loxone-ts-api.
```

The `beta` branch publishes prereleases. The `master` branch publishes stable releases.
