# Architecture

This plugin has one product boundary: Loxone <-> HomeKit. The architecture is optimized for that bridge and should stay boring, explicit, and testable.

## Layers

| Layer | Module(s) | Owns | Must not own |
| --- | --- | --- | --- |
| Platform | `LoxonePlatform`, `index.ts` | Homebridge lifecycle, the accessory cache list, the name registry, exposing HAP `Service`/`Characteristic`. | Loxone protocol details or item semantics. |
| Loxone transport | [`loxone-ts-client`](https://www.npmjs.com/package/loxone-ts-client) (external dependency) | All Miniserver communication: websocket, token auth, Structure File parsing, encrypted commands, state subscriptions, and the typed room/control model. | HomeKit concepts. |
| Binding coordinator | `LoxoneBindingCoordinator` | Connection orchestration, per-room control discovery, accessory planning, reconciliation (create/update/restore/remove), routing accessories to the main or a per-room bridge, room/type filtering, central-room handling. | HAP characteristic specifics — it delegates those. |
| Control routing | `ControlBinders` (`CONTROL_BINDERS`, `COMPOSITE_BINDERS`) | Mapping each Loxone control `type` to a `PlannedAccessory` (which HomeKit service(s) and which bindings). | Talking to the Miniserver. |
| Binding tables | `binding/tables/*Bindings.ts` | Declarative characteristic ⇄ state/command bindings per control family (lighting, covering, fan, sensor, thermostat, alarm, radio, switch, pushbutton, mood, contact, smoke). | Imperative service construction. |
| Binding engine | `BindingEngine.bindCharacteristics`, `CharacteristicBinding`, `ServiceResolver` | Applying a binding: wiring a HAP characteristic to a control's Loxone state (`handle.onState`) and command (`handle.send`). | Inventing command strings or reaching past the typed handle. |
| Complex binders | `binding/binders/*` | Imperative wiring for controls that are not a simple table: `intercom` (+ HKSV), `nfcCodeTouch`, `irrigation`, `color`. | Generic command/state rules where a table suffices. |
| Per-room publishing | `RoomBridgePublisher` | One HAP `Bridge` per room, deterministic pairing identity, and the manifest the config UI reads. | Loxone semantics. |
| Naming | `AccessoryNameRegistry` | Clean, unique, HAP-safe, UUID-stable accessory names. | — |
| Media | `homekit/hksv/*`, `homekit/services/*` | Camera streaming, HKSV recording + prebuffer, doorbell, motion, WebRTC talkback. | Generic command/state routing. |

## Command And State Rules

- A control's HomeKit shape, its Loxone state UUIDs, and its commands live in the declarative binding tables (or in a binder, for complex controls).
- Bindings reach the Miniserver only through the typed `ControlHandle` from `loxone-ts-client`: read state via `handle.state(...)` / `handle.onState(...)`, send via `handle.send(...)`.
- The plugin has no hand-rolled command bus or state router; the library's typed handles own subscription and dispatch. Do not re-implement that layer.
- Binders and tables must not reach into the raw `loxone-ts-client` client/transport directly — go through the control handle.
- HomeKit service code must not talk to the transport directly.

## Transport Boundary

`loxone-ts-client` is a separately published, independently versioned npm package. It owns every Loxone protocol concern and exposes typed control handles, a room view, and Miniserver discovery. This plugin depends on it and adds only the HomeKit binding layer, which keeps the boundary clean:

- tests can run without a Miniserver;
- the binding coordinator stays independent of concrete protocol event shapes;
- transport behavior can evolve in `loxone-ts-client` without leaking into HomeKit mapping code.

## Intercom & Media Boundary

Intercom and IntercomV2 are intentionally a separate bounded context. They include HKSV, WebRTC signaling, prebuffering, talkback, camera streams, and Miniserver token use — flows that are not the same as normal command/state accessories. They live in `homekit/hksv/*` and `homekit/services/*`, wired up by `binding/binders/intercomBinder.ts`.

The command/state architecture still plans the regular Doorbell/Camera/MotionSensor accessory where useful, but the media and signaling code stays isolated from the generic binding tables and the `ControlHandle` command/state rules.

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
