/**
 * Strips a Loxone name down to what HAP accepts on a `Name`/`ConfiguredName`
 * characteristic: parentheses are unwrapped (keeping their content) and any
 * character that isn't a letter, number, space or apostrophe is removed, so the
 * result starts and ends with a letter/number. May return '' for an all-symbol
 * input — callers should fall back to a default.
 */
export function sanitizeName(value: string): string {
  return value
    .replace(/\((.*?)\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s']/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Keeps HomeKit accessory names clean, unique, and stable across the session: a
 * given control UUID always maps to the same generated name, and collisions get a
 * numeric suffix.
 */
export class AccessoryNameRegistry {
  private readonly usedNames = new Set<string>();
  private readonly accessoryNameMap = new Map<string, string>();

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
    return sanitizeName(value);
  }
}
