declare const brand: unique symbol;
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };

/** Opaque durable identifiers. D1 determines their source, not their spelling. */
export type ProfileKey = Brand<string, 'ProfileKey'>;
export type CharacterKey = Brand<string, 'CharacterKey'>;
/** Runtime only: never persist this value as a record or character identity. */
export type RuntimeFormId = Brand<number, 'RuntimeFormId'>;
export interface ActorRef { readonly actorId: RuntimeFormId }
/** Unique per binding, including process restart; never reuse for another session. */
export type SessionEpoch = Brand<string, 'SessionEpoch'>;
export interface SessionBinding {
  readonly profileKey: ProfileKey;
  readonly characterKey: CharacterKey;
  readonly actorRef: ActorRef;
  readonly epoch: SessionEpoch;
}

/** Canonical defining-plugin|XXXXXX. Contains no runtime load-order index. */
export type StableFormKey = Brand<string, 'StableFormKey'>;
/** TES4 metadata is required: an .esp (or .esm) can be light. */
export type PluginKind = 'FULL' | 'LIGHT';
export interface StableFormKeyParts {
  readonly plugin: string;
  readonly localFormId: number;
}

function checkParts(plugin: string, localFormId: number, pluginKind: PluginKind): void {
  if (pluginKind !== 'FULL' && pluginKind !== 'LIGHT') throw new TypeError('Plugin kind is required');
  if (!/^[^\x00-\x1f\\/:|\s][^\x00-\x1f\\/:|]*\.(esm|esp|esl)$/.test(plugin) || plugin.trim() !== plugin) {
    throw new TypeError('Expected a plugin filename, not a path or runtime descriptor');
  }
  if (plugin.endsWith('.esl') && pluginKind !== 'LIGHT') throw new TypeError('ESL must be light');
  const maximum = pluginKind === 'LIGHT' ? 0xfff : 0xffffff;
  if (!Number.isSafeInteger(localFormId) || localFormId < 1 || localFormId > maximum) {
    throw new RangeError('Expected a non-null local FormID within the plugin range');
  }
}

/** Pure codec, not a resolver. Kind must come from trusted catalog metadata. */
export function createStableFormKey(plugin: string, localFormId: number, pluginKind: PluginKind): StableFormKey {
  if (typeof plugin !== 'string') throw new TypeError('Plugin must be a string');
  const normalized = plugin.toLowerCase();
  checkParts(normalized, localFormId, pluginKind);
  return `${normalized}|${localFormId.toString(16).padStart(6, '0').toUpperCase()}` as StableFormKey;
}

/** Accepts only six local hex digits; never masks a 32-bit runtime FormID. */
export function parseStableFormKey(text: string, pluginKind: PluginKind): StableFormKey {
  if (typeof text !== 'string') throw new TypeError('StableFormKey must be a string');
  const match = /^([^|]+)\|([0-9a-fA-F]{6})$/.exec(text);
  if (!match) throw new TypeError('Expected defining-plugin|XXXXXX');
  return createStableFormKey(match[1]!, Number.parseInt(match[2]!, 16), pluginKind);
}

/** Formats a validated key; JavaScript/untrusted callers are checked as well. */
export function formatStableFormKey(key: StableFormKey, pluginKind: PluginKind): string {
  return parseStableFormKey(key, pluginKind);
}

export function stableFormKeyParts(key: StableFormKey, pluginKind: PluginKind): StableFormKeyParts {
  const canonical = parseStableFormKey(key, pluginKind);
  const separator = canonical.lastIndexOf('|');
  return Object.freeze({ plugin: canonical.slice(0, separator), localFormId: Number.parseInt(canonical.slice(separator + 1), 16) });
}

export type RecordType = 'RACE' | 'PERK' | 'SPEL' | 'MGEF' | 'WEAP' | 'ARMO' | 'AMMO'
  | 'NPC_' | 'ACTI' | 'REFR' | 'KYWD' | 'ENCH' | 'ALCH' | 'LVLI';
export type CatalogSignature = Brand<string, 'CatalogSignature'>;
export interface DefinitionRef<T extends RecordType = RecordType> {
  readonly stableFormKey: StableFormKey;
  readonly recordType: T;
  readonly catalogSignature: CatalogSignature;
}
