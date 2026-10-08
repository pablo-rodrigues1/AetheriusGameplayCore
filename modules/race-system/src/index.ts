import type { Grant, StableFormKey } from '../../../shared/contracts/src/index.ts';
import type { DomainCatalog, ResolvedRecord } from '../../../shared/record-catalog/src/types.ts';
import type { QueryExecutor } from '../../../shared/persistence/src/index.ts';

export interface RaceFact {
  readonly status: 'SUPPORTED' | 'UNSUPPORTED';
  readonly raceKey: StableFormKey | null;
  readonly reason: string | null;
  readonly observedAt: string;
  readonly revision: number;
}
export type RaceDefinition = Pick<ResolvedRecord, 'definition' | 'data'>;
export interface RaceCatalog {
  readonly status: DomainCatalog['status'];
  readonly roots: readonly RaceDefinition[];
  byKey(key: StableFormKey): RaceDefinition | undefined;
}
export class RaceError extends Error { constructor(readonly code: string) { super(code); } }
export function raceRecord(catalog: RaceCatalog | undefined, key: StableFormKey): RaceDefinition {
  if (catalog?.status !== 'SUPPORTED') throw new RaceError('RACE_CATALOG_UNAVAILABLE');
  const root = catalog.roots.find(r => r.definition.stableFormKey === key);
  if (!root || root.definition.recordType !== 'RACE' || !Array.isArray(root.data.actorEffects)) throw new RaceError('RACE_NOT_PLAYABLE');
  return root;
}
export function initialRaceAttributes(catalog: RaceCatalog | undefined, key: StableFormKey) {
  const starting = raceRecord(catalog, key).data.starting as Record<string, unknown> | undefined;
  if (!starting || !['Health','Magicka','Stamina'].every(k => typeof starting[k] === 'number' && Number.isFinite(starting[k]))) {
    throw new RaceError('RACE_ATTRIBUTES_UNSUPPORTED');
  }
  return Object.freeze({ health: starting.Health as number, magicka: starting.Magicka as number, stamina: starting.Stamina as number });
}
/** Describes native delivery. Never applies a spell, perk or actor value. */
export function raceGrants(catalog: RaceCatalog | undefined, fact: RaceFact | undefined): readonly Grant[] {
  if (!fact || fact.status === 'UNSUPPORTED') return Object.freeze([]);
  if (!fact.raceKey || !Number.isSafeInteger(fact.revision) || fact.revision < 1) throw new RaceError('INVALID_RACE_FACT');
  const root = raceRecord(catalog, fact.raceKey);
  const source = Object.freeze({ kind: 'RACE' as const, key: fact.raceKey });
  const perks = new Map<StableFormKey, RaceDefinition>();
  const spells: Grant[] = (root.data.actorEffects as StableFormKey[]).map(key => {
    const spell = catalog!.byKey(key);
    if (!spell || spell.definition.recordType !== 'SPEL' || !Array.isArray(spell.data.effects)) throw new RaceError('RACE_SPELL_UNSUPPORTED');
    for (const effectKey of spell.data.effects as StableFormKey[]) {
      const effect = catalog!.byKey(effectKey);
      if (!effect || effect.definition.recordType !== 'MGEF') throw new RaceError('RACE_EFFECT_UNSUPPORTED');
      const perkKey = (effect.data.fields as Record<string, unknown>)?.PerkToApply;
      if (typeof perkKey === 'string') {
        const perk = catalog!.byKey(perkKey as StableFormKey);
        if (!perk || perk.definition.recordType !== 'PERK') throw new RaceError('RACE_PERK_UNSUPPORTED');
        perks.set(perkKey as StableFormKey, perk);
      }
    }
    const kind = spell.data.spellType === 'Ability' ? 'ability'
      : ['Power','LesserPower'].includes(String(spell.data.spellType)) ? 'power' : spell.data.spellType === 'Spell' ? 'spell' : undefined;
    if (!kind) throw new RaceError('RACE_SPELL_KIND_UNSUPPORTED');
    return Object.freeze({ kind, definition: spell.definition as Grant['definition'] & {recordType:'SPEL'}, source, revision: fact.revision });
  });
  const grants = [...spells, ...[...perks.values()].map(perk => Object.freeze({ kind: 'perk' as const,
    definition: perk.definition as Grant['definition'] & {recordType:'PERK'}, rank: 1, source, revision: fact.revision }))];
  return Object.freeze(grants.sort((a,b) => a.definition.stableFormKey.localeCompare(b.definition.stableFormKey, 'en')));
}
export async function readRace(tx: QueryExecutor, characterKey: string): Promise<RaceFact | undefined> {
  const row = (await tx.query<{status:RaceFact['status']; race_key:StableFormKey|null; reason:string|null; observed_at:Date|string; revision:string}>(
    'SELECT status,race_key,reason,observed_at,revision FROM gc_race_observation WHERE character_key=$1', [characterKey])).rows[0];
  if (!row) return undefined;
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new RaceError('INVALID_RACE_REVISION');
  if ((row.status !== 'SUPPORTED' && row.status !== 'UNSUPPORTED')
    || (row.status === 'SUPPORTED' && (!row.race_key || row.reason !== null))
    || (row.status === 'UNSUPPORTED' && (row.race_key !== null || !row.reason))) throw new RaceError('INVALID_RACE_FACT');
  return Object.freeze({status:row.status, raceKey:row.race_key, reason:row.reason,
    observedAt:new Date(row.observed_at).toISOString(), revision});
}
