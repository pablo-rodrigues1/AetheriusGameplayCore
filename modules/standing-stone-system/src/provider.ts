import type { Grant, StableFormKey } from '../../../shared/contracts/src/index.ts';
import type { DomainCatalog, ResolvedRecord } from '../../../shared/record-catalog/src/types.ts';
import type { QueryExecutor } from '../../../shared/persistence/src/index.ts';

export interface StandingStoneFact { readonly stoneKey: StableFormKey; readonly revision: number }
export type StoneDefinition = Pick<ResolvedRecord, 'definition' | 'data'>;
/** Pure provider needs definitions only. Live commands still require DomainCatalog. */
export interface StandingStoneCatalog {
  readonly status: DomainCatalog['status'];
  readonly roots: readonly StoneDefinition[];
  readonly unsupported: DomainCatalog['unsupported'];
  byKey(key: StableFormKey): StoneDefinition | undefined;
}
export class StandingStoneError extends Error {
  constructor(readonly code: string) { super(code); }
}
export function stoneRecord(catalog: StandingStoneCatalog | undefined, key: StableFormKey): StoneDefinition {
  if (catalog?.status !== 'SUPPORTED') throw new StandingStoneError('CATALOG_UNAVAILABLE');
  const root = catalog.roots.find(r => r.definition.stableFormKey === key);
  if (!root || root.definition.recordType !== 'ACTI' || root.data.grantStatus !== 'SUPPORTED'
    || !Array.isArray(root.data.spells)) throw new StandingStoneError('STONE_UNSUPPORTED');
  return root;
}
/** Pure catalog-driven provider. It neither reads the host nor computes effects. */
export function standingStoneGrants(catalog: StandingStoneCatalog | undefined, fact: StandingStoneFact | undefined): readonly Grant[] {
  if (!fact) return Object.freeze([]);
  if (!Number.isSafeInteger(fact.revision) || fact.revision < 1) throw new StandingStoneError('INVALID_FACT_REVISION');
  const root = stoneRecord(catalog, fact.stoneKey);
  const excluded = new Set(catalog!.unsupported.map(link => link.stableFormKey));
  const keys = root.data.spells as readonly StableFormKey[];
  if (new Set(keys).size !== keys.length) throw new StandingStoneError('DUPLICATE_CATALOG_LINK');
  return Object.freeze(keys.filter(key => !excluded.has(key)).map(key => {
    const record = catalog!.byKey(key);
    if (!record || record.definition.recordType !== 'SPEL') throw new StandingStoneError('SPELL_LINK_UNSUPPORTED');
    const kind = record.data.spellType === 'Ability' ? 'ability'
      : ['Power', 'LesserPower'].includes(String(record.data.spellType)) ? 'power'
        : record.data.spellType === 'Spell' ? 'spell' : undefined;
    if (!kind) throw new StandingStoneError('SPELL_KIND_UNSUPPORTED');
    return Object.freeze({ kind, definition: record.definition as Grant['definition'] & { recordType: 'SPEL' },
      source: Object.freeze({ kind: 'STANDING_STONE' as const, key: fact.stoneKey }), revision: fact.revision });
  }));
}
export async function readStandingStone(tx: QueryExecutor, characterKey: string): Promise<StandingStoneFact | undefined> {
  const row = (await tx.query<{ stone_key: StableFormKey; revision: string }>(
    'SELECT stone_key, revision FROM gc_standing_stone_choice WHERE character_key=$1', [characterKey])).rows[0];
  if (!row) return undefined;
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new StandingStoneError('INVALID_FACT_REVISION');
  return Object.freeze({ stoneKey: row.stone_key, revision });
}
