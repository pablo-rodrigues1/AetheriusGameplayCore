import { parseStableFormKey } from '../../../shared/contracts/src/identity.ts';
import type { DefinitionRef, Grant, GrantSource, RevisionVector } from '../../../shared/contracts/src/index.ts';

export function fail(code: string, path: string): never {
  throw new TypeError(`${code}: ${path}`);
}
export function object(value: unknown, fields: readonly string[], path: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_OBJECT', path);
  const keys = Object.keys(value);
  if (keys.length !== fields.length || fields.some(key => !Object.hasOwn(value, key))
    || keys.some(key => !fields.includes(key))) fail('INVALID_FIELDS', path);
}
export function text(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) fail('INVALID_TEXT', path);
}
export function counter(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail('INVALID_REVISION', path);
}
export const revisionFields = ['facts', 'grants', 'equipment', 'effects', 'catalog'] as const satisfies readonly (keyof RevisionVector)[];
export function copyRevision(value: RevisionVector): RevisionVector {
  object(value, revisionFields, 'revision');
  for (const key of revisionFields) counter(value[key], `revision.${key}`);
  return Object.freeze({ facts: value.facts, grants: value.grants, equipment: value.equipment,
    effects: value.effects, catalog: value.catalog });
}
const sourceKinds = ['CLASS', 'RACE', 'STANDING_STONE', 'RELIGION', 'QUEST', 'EQUIPMENT',
  'LEARNED', 'ADMIN', 'SYSTEM', 'TRANSFORMATION'] as const satisfies readonly GrantSource['kind'][];
export function copySource(value: GrantSource, path: string): GrantSource {
  object(value, ['kind', 'key'], path);
  if (!sourceKinds.some(kind => kind === value.kind)) fail('INVALID_SOURCE_KIND', `${path}.kind`);
  text(value.key, `${path}.key`);
  return Object.freeze({ kind: value.kind, key: value.key });
}
const recordTypes = ['RACE', 'PERK', 'SPEL', 'MGEF', 'WEAP', 'ARMO', 'AMMO', 'NPC_',
  'ACTI', 'REFR', 'KYWD', 'ENCH', 'ALCH', 'LVLI'] as const satisfies readonly DefinitionRef['recordType'][];
export function copyDefinition(value: DefinitionRef, path: string): DefinitionRef {
  object(value, ['stableFormKey', 'recordType', 'catalogSignature'], path);
  text(value.stableFormKey, `${path}.stableFormKey`);
  try {
    // DefinitionRef has no pluginKind: ESPFE metadata is checked by RecordCatalog.
    const kind = value.stableFormKey.includes('.esl|') ? 'LIGHT' : 'FULL';
    if (parseStableFormKey(value.stableFormKey, kind) !== value.stableFormKey) fail('NONCANONICAL_DEFINITION', path);
  } catch { fail('INVALID_DEFINITION', `${path}.stableFormKey`); }
  if (!recordTypes.some(type => type === value.recordType)) fail('INVALID_RECORD_TYPE', path);
  text(value.catalogSignature, `${path}.catalogSignature`);
  return Object.freeze({ stableFormKey: value.stableFormKey, recordType: value.recordType,
    catalogSignature: value.catalogSignature });
}
export function copyGrant(value: Grant, path: string): Grant {
  if (value === null || typeof value !== 'object') fail('INVALID_GRANT', path);
  const fields = ['kind', 'definition', 'source', 'revision'];
  if (value.kind === 'perk') fields.push('rank');
  if (value.kind === 'modifier') fields.push('owner');
  object(value, fields, path);
  const definition = copyDefinition(value.definition, `${path}.definition`);
  const source = copySource(value.source, `${path}.source`);
  counter(value.revision, `${path}.revision`);
  const base = { source, revision: value.revision };
  switch (value.kind) {
    case 'perk':
      if (definition.recordType !== 'PERK') fail('INVALID_DEFINITION_TYPE', path);
      if (!Number.isInteger(value.rank) || value.rank < 1 || value.rank > 255) fail('INVALID_RANK', `${path}.rank`);
      return Object.freeze({ ...base, kind: 'perk', definition: Object.freeze({ ...definition, recordType: 'PERK' } as const), rank: value.rank });
    case 'spell': case 'ability': case 'power':
      if (definition.recordType !== 'SPEL') fail('INVALID_DEFINITION_TYPE', path);
      return Object.freeze({ ...base, kind: value.kind, definition: Object.freeze({ ...definition, recordType: 'SPEL' } as const) });
    case 'modifier':
      if (!['AETHERIUS_SERVER', 'NATIVE_SERVER', 'NATIVE_CLIENT', 'DISABLED'].includes(value.owner)) fail('INVALID_OWNER', path);
      return Object.freeze({ ...base, kind: 'modifier', definition, owner: value.owner });
    default: return fail('INVALID_GRANT_KIND', path);
  }
}
/** Length/escaping safe tuple identities; rank/revision/signature are state. */
export function itemIdentity(value: Pick<Grant, 'kind' | 'definition'>): string {
  return JSON.stringify([value.kind, value.definition.recordType, value.definition.stableFormKey]);
}
export function sourceIdentity(source: GrantSource): string {
  return JSON.stringify([source.kind, source.key]);
}
export function grantIdentity(value: Grant): string {
  return JSON.stringify([itemIdentity(value), sourceIdentity(value.source)]);
}
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
