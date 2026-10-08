import { createStableFormKey, parseStableFormKey, stableFormKeyParts } from '../../contracts/src/identity.ts';
import type { PluginKind, StableFormKey } from '../../contracts/src/identity.ts';

export type FormKeySpelling = 'canonical' | 'housecarl' | 'damage' | 'skymp';

export function decodeFormKey(text: string, spelling: FormKeySpelling, kind: PluginKind): StableFormKey {
  if (spelling === 'canonical') return parseStableFormKey(text, kind);
  const pattern = spelling === 'damage' ? /^([^:]+):([\da-fA-F]{6})$/
    : spelling === 'housecarl' ? /^([\da-fA-F]{6}):([^:]+)$/
      : spelling === 'skymp' ? /^([\da-f]{1,6}):([^:]+)$/ : null;
  if (!pattern) throw new TypeError('Unknown FormKey spelling');
  const match = pattern.exec(text);
  if (!match) throw new TypeError(`Invalid ${spelling} FormKey`);
  return createStableFormKey(spelling === 'damage' ? match[1]! : match[2]!,
    Number.parseInt(spelling === 'damage' ? match[2]! : match[1]!, 16), kind);
}

/** Original filename casing can come from the dependency metadata. */
export function encodeFormKey(key: StableFormKey, spelling: FormKeySpelling, kind: PluginKind, filename?: string): string {
  const canonical = parseStableFormKey(key, kind);
  const { plugin, localFormId } = stableFormKeyParts(canonical, kind);
  const name = filename ?? plugin;
  if (name.toLowerCase() !== plugin || createStableFormKey(name, localFormId, kind) !== canonical) {
    throw new TypeError('Filename must match the defining plugin');
  }
  const hex = localFormId.toString(16);
  const padded = hex.padStart(6, '0').toUpperCase();
  switch (spelling) {
    case 'canonical': return canonical;
    case 'housecarl': return `${padded}:${name}`;
    case 'damage': return `${name}:${padded}`;
    case 'skymp': return `${hex}:${name}`;
    default: throw new TypeError('Unknown FormKey spelling');
  }
}
