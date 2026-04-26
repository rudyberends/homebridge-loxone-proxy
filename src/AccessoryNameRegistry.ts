/**
 * Keeps HomeKit accessory names clean, unique, and stable during one mapping run.
 */
export class AccessoryNameRegistry {
  private usedNames = new Set<string>();
  private accessoryNameMap = new Map<string, string>();

  reset(): void {
    this.usedNames.clear();
    this.accessoryNameMap.clear();
  }

  generate(room: string, base: string, uuid?: string, isSubItem = false): string {
    const cleanRoom = this.clean(room || 'Unknown');
    const cleanBase = this.clean(base || 'Unnamed');

    const alreadyPrefixed =
      cleanBase.toLowerCase().startsWith(cleanRoom.toLowerCase()) ||
      cleanBase.toLowerCase().startsWith(cleanRoom.toLowerCase() + ' ');

    const baseName = alreadyPrefixed
      ? cleanBase
      : `${cleanRoom} ${cleanBase}`;

    if (isSubItem) {
      return baseName;
    }

    if (uuid && this.accessoryNameMap.has(uuid)) {
      return this.accessoryNameMap.get(uuid)!;
    }

    let finalName = baseName;
    let counter = 1;

    while (this.usedNames.has(finalName)) {
      finalName = `${baseName} ${counter++}`;
    }

    this.usedNames.add(finalName);

    if (uuid) {
      this.accessoryNameMap.set(uuid, finalName);
    }

    return finalName;
  }

  private clean(value: string): string {
    return value
      .replace(/\((.*?)\)/g, '$1')
      .replace(/[^\p{L}\p{N}\s']/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
