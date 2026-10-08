import type { CharacterKey, Grant, GrantSet, SessionBinding, StableFormKey } from '../../shared/contracts/src/index.ts';
import { compose } from '../../modules/actor-state-system/src/index.ts';
import { lockCharacter, withTransaction } from '../../shared/persistence/src/index.ts';
import type { PoolPort, QueryExecutor } from '../../shared/persistence/src/index.ts';
import type { ProjectionResult } from './projection/index.ts';
import { scopedPool } from './persistence-scope.ts';

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
  private closed = false;
  constructor(private options: {
    readonly pool: PoolPort | undefined;
    readonly schema: string;
    readonly check: (binding: SessionBinding) => void;
    readonly publish: (binding: SessionBinding, set: ReturnType<typeof compose>) => Promise<ProjectionResult>;
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
        return compose(binding.characterKey, outputs.map(output => output.grants), {
          facts: revision, grants: revision, equipment: 0, effects: 0, catalog: 1
        });
      });
      check(); return action(set);
    });
    const tail = task.finally(() => { if (this.tails.get(binding.characterKey) === tail) this.tails.delete(binding.characterKey); });
    this.tails.set(binding.characterKey, tail); return tail;
  }
  async shutdown(): Promise<void> { this.closed = true; await Promise.allSettled([...this.tails.values()]); this.providers.clear(); }
}
