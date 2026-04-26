import type { Controls, Control, StructureFile, Room, CatValue } from './StructureFile';
import type { LoxonePlatform } from '../LoxonePlatform';
import { normalizeLoxoneConfig } from '../LoxoneConfig';
import { getLoxoneItemConstructor } from './LoxoneItemRegistry';

export interface PreparedLoxoneControls {
  controls: Controls;
  items: Control[];
}

export class LoxoneControlMapper {
  constructor(private readonly platform: LoxonePlatform) {}

  prepare(config: StructureFile): PreparedLoxoneControls {
    const rooms: Record<string, Room> = { ...config.rooms };
    const cats: Record<string, CatValue> = { ...config.cats };
    const controls: Controls = {};

    for (const [uuid, control] of Object.entries(config.controls)) {
      controls[uuid] = {
        ...control,
        room: rooms[control.room]?.name ?? 'undefined',
        catIcon: cats[control.cat]?.image ?? 'undefined',
        cat: cats[control.cat]?.type ?? 'undefined',
      };
    }

    return {
      controls,
      items: Object.values(controls),
    };
  }

  map(items: Control[]): void {
    const config = normalizeLoxoneConfig(this.platform.config);

    for (const item of items) {
      if (this.isFiltered(item, config)) {
        continue;
      }

      const ItemConstructor = getLoxoneItemConstructor(item.type);
      if (!ItemConstructor) {
        this.platform.log.info(`[mapLoxoneItem] Unsupported item type: ${item.name} → ${item.type}`);
        continue;
      }

      try {
        new ItemConstructor(this.platform, item);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.platform.log.warn(`[mapLoxoneItem] Failed to map ${item.name} (${item.type}): ${message}`);
      }
    }
  }

  private isFiltered(
    item: Control,
    config: ReturnType<typeof normalizeLoxoneConfig>,
  ): boolean {
    if (config.excludedTypes.includes(item.type)) {
      return true;
    }

    const room = item.room.toLowerCase();
    const roomMatched = config.roomFilter.rooms.includes(room);

    return config.roomFilter.type === 'exclusion'
      ? roomMatched
      : !roomMatched;
  }
}
