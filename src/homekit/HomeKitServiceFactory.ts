import type { PlatformAccessory } from 'homebridge';
import type { LoxonePlatform } from '../LoxonePlatform';
import type { ServicePlan } from '../platform/AccessoryPlan';
import type { HomeKitServiceAdapter } from './HomeKitServiceAdapter';
import { ColorLightBulb } from './services/ColorLightBulb';
import { ContactSensor } from './services/ContactSensor';
import { Doorbell } from './services/Doorbell';
import { Fanv2 } from './services/Fanv2';
import { GarageDoorOpener } from './services/GarageDoorOpener';
import { IrrigationSystem } from './services/IrrigationSystem';
import { HumiditySensor } from './services/HumiditySensor';
import { LeakSensor } from './services/LeakSensor';
import { LightBulb } from './services/LightBulb';
import { LightSensor } from './services/LightSensor';
import { LockMechanism } from './services/LockMechanism';
import { MotionSensor } from './services/MotionSensor';
import { OccupancySensor } from './services/OccupancySensor';
import { Outlet } from './services/Outlet';
import { SecuritySystem } from './services/SecuritySystem';
import { SmokeSensor } from './services/SmokeSensor';
import { Switch } from './services/Switch';
import { TemperatureSensor } from './services/TemperatureSensor';
import { Thermostat } from './services/Thermostat';
import { Window } from './services/Window';
import { WindowCovering } from './services/WindowCovering';

export type HomeKitServiceKind =
  | 'color-lightbulb'
  | 'contact-sensor'
  | 'doorbell'
  | 'fanv2'
  | 'garage-door-opener'
  | 'humidity-sensor'
  | 'irrigation-system'
  | 'leak-sensor'
  | 'lightbulb'
  | 'light-sensor'
  | 'lock-mechanism'
  | 'motion-sensor'
  | 'occupancy-sensor'
  | 'outlet'
  | 'security-system'
  | 'smoke-sensor'
  | 'switch'
  | 'temperature-sensor'
  | 'thermostat'
  | 'window'
  | 'window-covering';

type HomeKitServiceConstructor = new (
  platform: LoxonePlatform,
  accessory: PlatformAccessory,
  device?: ServicePlan['device'],
  commandExecutor?: HomeKitCommandExecutor,
) => HomeKitServiceAdapter;

export type HomeKitCommandExecutor = (
  commandId: string,
  value?: unknown,
  service?: unknown,
) => void;

const serviceConstructors: Record<HomeKitServiceKind, HomeKitServiceConstructor> = {
  'color-lightbulb': ColorLightBulb,
  'contact-sensor': ContactSensor,
  'doorbell': Doorbell,
  'fanv2': Fanv2,
  'garage-door-opener': GarageDoorOpener,
  'humidity-sensor': HumiditySensor,
  'irrigation-system': IrrigationSystem,
  'leak-sensor': LeakSensor,
  'lightbulb': LightBulb,
  'light-sensor': LightSensor,
  'lock-mechanism': LockMechanism,
  'motion-sensor': MotionSensor,
  'occupancy-sensor': OccupancySensor,
  'outlet': Outlet,
  'security-system': SecuritySystem,
  'smoke-sensor': SmokeSensor,
  'switch': Switch,
  'temperature-sensor': TemperatureSensor,
  'thermostat': Thermostat,
  'window': Window,
  'window-covering': WindowCovering,
};

export function buildHomeKitService(
  platform: LoxonePlatform,
  accessory: PlatformAccessory,
  plan: ServicePlan,
): HomeKitServiceAdapter {
  const ServiceConstructor = serviceConstructors[plan.kind];
  return new ServiceConstructor(platform, accessory, plan.device, createCommandExecutor(platform, plan));
}

function createCommandExecutor(
  platform: LoxonePlatform,
  plan: ServicePlan,
): HomeKitCommandExecutor {
  return (commandId, value, service) => {
    const binding = plan.commands?.[commandId];
    if (!binding) {
      platform.log.warn(`[${plan.name ?? plan.id}] Missing command binding: ${commandId}`);
      return;
    }

    const action = typeof binding.action === 'function'
      ? binding.action(value, { device: plan.device, service })
      : binding.action;

    if (!action) {
      return;
    }

    const uuid = binding.uuid ?? plan.device?.uuidAction;
    if (!uuid) {
      platform.log.warn(`[${plan.name ?? plan.id}] Missing command UUID for: ${commandId}`);
      return;
    }

    platform.commandBus.execute({
      uuid,
      action,
      source: binding.source ?? plan.name ?? plan.id,
    });
  };
}
