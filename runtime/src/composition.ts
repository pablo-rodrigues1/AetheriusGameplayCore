import type { CharacterKey, Grant, GrantSet, SessionBinding, StableFormKey } from '../../shared/contracts/src/index.ts';
import { compose } from '../../modules/actor-state-system/src/index.ts';
import { canonicalJson, lockCharacter, withTransaction } from '../../shared/persistence/src/index.ts';
import type { PoolPort, QueryExecutor } from '../../shared/persistence/src/index.ts';
import type { ProjectionResult } from './projection/index.ts';
import { scopedPool } from './persistence-scope.ts';
import type { DomainData } from '../../shared/record-catalog/src/types.ts';

/** PerkToApply is native magical delivery. Do not add the same PERK separately,
 * even if another source also lists it. Conditions stay owned by the engine. */
export function nativeStonePerkKeys(set:GrantSet, data:DomainData|undefined):ReadonlySet<StableFormKey>{
  const keys=new Set<StableFormKey>();if(!data)return keys;
  const records=new Map(data.records.map(record=>[record.stableFormKey,record]));
  for(const grant of set.grants.filter(g=>g.source.kind==='STANDING_STONE'&&g.definition.recordType==='SPEL')){
    const spell=records.get(grant.definition.stableFormKey);if(!spell||spell.signature!==grant.definition.catalogSignature)continue;
    const fields=spell.data.fields as Record<string,string>|undefined;
    for(const [field,key] of Object.entries(fields??{}))if(/^Effects\[[0-9]+\]\.BaseEffect$/.test(field)){
      const effect=records.get(key as StableFormKey),effectFields=effect?.data.fields as Record<string,string>|undefined;
      if(effect?.recordType==='MGEF'&&effectFields?.PerkToApply)keys.add(effectFields.PerkToApply as StableFormKey);
    }
  }
  return keys;
}

export interface CompositionProvider {
  readonly id: string;
  read(tx: QueryExecutor, key: CharacterKey): Promise<{ readonly grants: readonly Grant[]; readonly revision: number }>;
}
/** Runtime delivery boundary: native race records suppress every source of the
 * same record. Previous native records also remain protected for this transition.
 * The complete composition and its origins are retained for explanation. */
export function portGrantSet(set: GrantSet, previous?: GrantSet, observed: ReadonlySet<StableFormKey> = new Set()): GrantSet {
  const native = new Set<StableFormKey>([...set.grants, ...(previous?.grants ?? [])]
    .filter(g => g.source.kind === 'RACE').map(g => g.definition.stableFormKey));
  for (const key of observed) native.add(key);
  return compose(set.characterKey, [set.grants.filter(g => !native.has(g.definition.stableFormKey))], set.revision);
}
export function nativeGrantKeys(set: GrantSet, previous?: GrantSet): ReadonlySet<StableFormKey> {
  return new Set([...set.grants, ...(previous?.grants ?? [])].filter(g => g.source.kind === 'RACE').map(g => g.definition.stableFormKey));
}
/** One composition point for all domains. Each owner supplies its committed
 * facts and pure provider output; standing stones know no other domain. */
export class ActorComposition {
  private providers = new Map<string, CompositionProvider>();
  private tails = new Map<CharacterKey, Promise<unknown>>();
  private derived = new Map<CharacterKey, GrantSet>();
  private closed = false;
  constructor(private options: {
    readonly pool: PoolPort | undefined;
    readonly schema: string;
    readonly check: (binding: SessionBinding) => void;
    readonly publish: (binding: SessionBinding, set: ReturnType<typeof compose>) => Promise<ProjectionResult>;
    readonly onComposed?: (binding:SessionBinding,set:ReturnType<typeof compose>)=>void;
  }) {}
  register(provider: CompositionProvider): () => void {
    if (this.closed || this.providers.has(provider.id)) throw new Error('Duplicate/closed composition provider');
    this.providers.set(provider.id, provider);
    return () => { this.providers.delete(provider.id); };
  }
  /** Observation composes the same providers, without asking a delivery port to
   * reconcile unrelated grants. Only their owners request host delivery. */
  inspect(binding: SessionBinding): Promise<ReturnType<typeof compose>> {
    return this.serial(binding, set => set);
  }
  recompose(binding: SessionBinding): Promise<ProjectionResult> {
    return this.serial(binding, set => this.options.publish(binding, set));
  }
  private serial<T>(binding: SessionBinding, action: (set: ReturnType<typeof compose>) => T | Promise<T>): Promise<T> {
    const task = (this.tails.get(binding.characterKey) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const check = () => { if (this.closed) throw Error('COMPOSITION_CLOSED'); this.options.check(binding); };
      check(); if (!this.options.pool) throw Error('DATABASE_UNAVAILABLE');
      const set = await withTransaction(scopedPool(this.options.pool, this.options.schema, check), async tx => {
        await lockCharacter(tx, binding.characterKey); check();
        const outputs = [];
        for (const provider of [...this.providers.values()].sort((a,b) => a.id.localeCompare(b.id))) {
          outputs.push(await provider.read(tx, binding.characterKey)); check();
        }
        const revision = outputs.reduce((sum, output) => sum + output.revision, 0);
        const next = compose(binding.characterKey, outputs.map(output => output.grants), {
          facts: revision, grants: revision, equipment: 0, effects: 0, catalog: 1
        });
        // Publication counters belong to the derivation boundary. Facts alone
        // cannot identify provider output (development level, enabled systems,
        // winner signatures). Reuse the durable projection head across boots;
        // keep an issued set only while that head has not caught up yet.
        const head = (await tx.query<{grant_set: GrantSet}>(
          `SELECT grant_set FROM "${this.options.schema}".gc_spell_projection_heads WHERE character_key=$1`,
          [binding.characterKey])).rows[0]?.grant_set;
        check();
        const issued = this.derived.get(binding.characterKey);
        const previous = issued && (!head || issued.revision.grants > head.revision.grants) ? issued : head;
        if (!previous) return next;
        const contentChanged = canonicalJson(previous.grants) !== canonicalJson(next.grants);
        if (!contentChanged && revision <= previous.revision.facts) return compose(next.characterKey, [next.grants], previous.revision);
        const signatures = new Map(previous.grants.map(g => [g.definition.stableFormKey,g.definition.catalogSignature]));
        const catalogChanged = next.grants.some(g => signatures.has(g.definition.stableFormKey) &&
          signatures.get(g.definition.stableFormKey) !== g.definition.catalogSignature);
        return compose(next.characterKey, [next.grants], {
          facts: Math.max(revision, previous.revision.facts),
          grants: Math.max(revision, previous.revision.grants) + 1,
          equipment: previous.revision.equipment, effects: previous.revision.effects,
          catalog: previous.revision.catalog + (catalogChanged ? 1 : 0)
        });
      });
      check(); this.derived.set(binding.characterKey,set); this.options.onComposed?.(binding,set); return action(set);
    });
    const tail = task.finally(() => { if (this.tails.get(binding.characterKey) === tail) this.tails.delete(binding.characterKey); });
    this.tails.set(binding.characterKey, tail); return tail;
  }
  async shutdown(): Promise<void> { this.closed = true; await Promise.allSettled([...this.tails.values()]); this.providers.clear(); this.derived.clear(); }
}
