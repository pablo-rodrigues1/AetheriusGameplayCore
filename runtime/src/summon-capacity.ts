import type { GrantSet, SessionBinding, StableFormKey } from '../../shared/contracts/src/index.ts';
import type { PerkCatalogLookup } from './combat-profile.ts';

const TWIN_SOULS = 'skyrim.esm|0D5F1C' as StableFormKey;
const RITUAL_STONE = 'skyrim.esm|0D2337';
const RITUAL_ABILITY = 'skyrim.esm|0E7329';
const RITUAL_EFFECT = 'mundus.esp|00081B' as StableFormKey;
const RITUAL_PERK = 'mundus.esp|000823' as StableFormKey;
export interface SummonCapacity {
  readonly limit: number;
  readonly bonuses: readonly ('TWIN_SOULS' | 'RITUAL_STONE')[];
}

/** Two certified +1 rules. Purchase prerequisites are not reapplied to a perk
 * already granted by the class provider. This is not a general PERK evaluator. */
export function composeSummonCapacity(set: GrantSet, lookup: PerkCatalogLookup): SummonCapacity {
  const bonuses = new Set<'TWIN_SOULS' | 'RITUAL_STONE'>();
  const fields = (key: StableFormKey) => lookup(key)?.data.fields as Record<string, string> | undefined;
  const addOne = (key: StableFormKey, index: number) => {
    const record = lookup(key), f = fields(key), prefix = `Effects[${index}]`;
    return record?.definition.recordType === 'PERK' && f?.[`${prefix}.EntryPoint`] === 'ModCommandedActorLimit'
      && f[`${prefix}.Modification`] === 'Add' && f[`${prefix}.Value`] === '1';
  };
  for (const grant of set.grants) {
    const key = grant.definition.stableFormKey, record = lookup(key);
    if (!record || record.definition.catalogSignature !== grant.definition.catalogSignature
      || record.definition.recordType !== grant.definition.recordType) continue;
    if (grant.kind === 'perk' && key === TWIN_SOULS && Number.isSafeInteger(grant.rank) && grant.rank >= 1
      && addOne(TWIN_SOULS, 0)) bonuses.add('TWIN_SOULS');
    // Possessing the learned spell or a stray native perk is not an active stone.
    // Only the selected stone's committed provider output enables this bonus.
    if (grant.kind === 'ability' && grant.source.kind === 'STANDING_STONE' && grant.source.key === RITUAL_STONE
      && key === RITUAL_ABILITY && fields(key)?.['Effects[0].BaseEffect'] === RITUAL_EFFECT
      && lookup(RITUAL_EFFECT)?.definition.recordType === 'MGEF'
      && fields(RITUAL_EFFECT)?.PerkToApply === RITUAL_PERK && addOne(RITUAL_PERK, 1)) bonuses.add('RITUAL_STONE');
  }
  return Object.freeze({ limit: 1 + bonuses.size, bonuses: Object.freeze([...bonuses].sort()) });
}

/** Private server cache derived from committed composition, never a client claim
 * or a persisted actor property which could survive a character/session change. */
export class SummonCapacityProjection {
  private values = new Map<number, { binding: SessionBinding; value: SummonCapacity }>();
  constructor(private lookup: PerkCatalogLookup, private current: (binding: SessionBinding) => boolean,
    private sourceAllowed: (binding: SessionBinding, kind: string) => boolean) {}
  publish(binding: SessionBinding, set: GrantSet): void {
    if (!this.current(binding) || binding.characterKey !== set.characterKey) return;
    const grants = set.grants.filter(grant => this.sourceAllowed(binding, grant.source.kind));
    const value = composeSummonCapacity({ ...set, grants }, this.lookup);
    this.values.set(binding.actorRef.actorId, { binding, value });
  }
  read(binding: SessionBinding) {
    const entry = this.values.get(binding.actorRef.actorId);
    return this.current(binding) && entry?.binding.epoch === binding.epoch && entry.binding.characterKey === binding.characterKey
      ? { status: 'SUPPORTED' as const, value: entry.value }
      : { status: 'UNSUPPORTED' as const, value: null, reason: 'SUMMON_CAPACITY_NOT_COMPOSED' };
  }
  clear(binding: SessionBinding): void {
    if (this.values.get(binding.actorRef.actorId)?.binding.epoch === binding.epoch) this.values.delete(binding.actorRef.actorId);
  }
  shutdown(): void { this.values.clear(); }
}
