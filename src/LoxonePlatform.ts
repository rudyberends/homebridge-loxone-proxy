import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import {
  StructureFile,
  Controls,
  MSInfo,
  Control,
} from './loxone/StructureFile';

import LoxoneHandler from './loxone/LoxoneHandler';
import { AccessoryNameRegistry } from './AccessoryNameRegistry';
import { LoxoneControlMapper } from './loxone/LoxoneControlMapper';
import { AccessoryReconciler } from './platform/AccessoryReconciler';
import { LoxoneCommandBus } from './loxone/LoxoneCommandBus';
import { LoxoneStateRouter } from './loxone/LoxoneStateRouter';

/**
 * LoxonePlatform
 * Main plugin class
 */
export class LoxonePlatform implements DynamicPlatformPlugin {
  public LoxoneHandler!: LoxoneHandler;
  public AccessoryCount = 1;
  public msInfo: MSInfo = {} as MSInfo;
  public LoxoneItems: Controls = {} as Controls;

  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  public readonly accessoryReconciler: AccessoryReconciler;
  public readonly commandBus: LoxoneCommandBus;
  public readonly stateRouter: LoxoneStateRouter;

  private readonly nameRegistry: AccessoryNameRegistry;
  private readonly controlMapper: LoxoneControlMapper;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.nameRegistry = new AccessoryNameRegistry();
    this.controlMapper = new LoxoneControlMapper(this);
    this.accessoryReconciler = new AccessoryReconciler(this);
    this.commandBus = new LoxoneCommandBus(this);
    this.stateRouter = new LoxoneStateRouter(this);

    this.api.on('didFinishLaunching', async () => {
      await this.LoxoneInit();
    });
  }

  /**
   * Initial startup
   */
  async LoxoneInit(): Promise<void> {
    this.nameRegistry.reset();

    this.LoxoneHandler = new LoxoneHandler(this);

    await this.waitForLoxoneConfig();
    this.log.debug(
      `[LoxoneInit] Got Structure File; Modified: ${this.LoxoneHandler.loxdata.lastModified}`,
    );

    this.parseLoxoneConfig(this.LoxoneHandler.loxdata);
    this.log.info('[LoxoneInit] Loxone Platform initialized');
  }

  waitForLoxoneConfig(): Promise<void> {
    return this.LoxoneHandler.waitForConfig();
  }

  /**
   * Parse structure file
   */
  parseLoxoneConfig(config: StructureFile): void {
    this.msInfo = config.msInfo;

    const prepared = this.controlMapper.prepare(config);
    this.LoxoneItems = prepared.controls;
    this.accessoryReconciler.beginRun();
    this.mapLoxoneItems(prepared.items);
    this.removeUnmappedAccessories();
  }

  /**
   * Map items → accessories
   */
  mapLoxoneItems(items: Control[]): void {
    this.controlMapper.map(items);
  }

  /**
   * Remove unused cached accessories
   */
  removeUnmappedAccessories(): void {
    this.accessoryReconciler.removeUnmapped();
  }

  configureAccessory(acc: PlatformAccessory): void {
    this.log.debug('Loaded from cache:', acc.displayName);
    this.accessories.push(acc);
  }

  /**
   * Clean + unique + HAP-safe + UUID-stable name builder
   */
  generateUniqueName(
    room: string,
    base: string,
    uuid?: string,
    isSubItem = false,
  ): string {
    return this.nameRegistry.generate(room, base, uuid, isSubItem);
  }
}
