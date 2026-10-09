import type { GrantProjection, GrantProjectionAck, GrantSet } from '../../../shared/contracts/src/grants.js';
import type { CharacterKey, DefinitionRef, SessionBinding, StableFormKey } from '../../../shared/contracts/src/identity.js';
import type { GrantProjectionPort, IdentityPort, ProjectionReceipt, RecordCatalogPort } from '../../../shared/contracts/src/ports.js';
import { compose, compareRevisions, effectiveSet } from '../../../modules/actor-state-system/src/index.ts';
import { canonicalJson, withTransaction } from '../../../shared/persistence/src/index.js';
import type { PoolPort, PoolClient } from '../../../shared/persistence/src/index.js';
import type { ActorReady, Actors } from '../actors.js';
import type { RuntimeMp } from '../host.js';
import { ProjectionError, SpellHost } from './host.js';
import { nativeGrantKeys, portGrantSet } from '../composition.ts';
import type { PerkDelivery } from './perks.ts';

export type ItemStatus = 'APPLIED_HOST' | 'REMOVED_HOST' | 'APPLIED_CLIENT' | 'REMOVED_CLIENT' | 'SENT_UNCONFIRMED' | 'ALREADY_PRESENT' | 'ALREADY_ABSENT' | 'UNSUPPORTED' | 'FAILED' | 'PENDING';
export interface ProjectionItem {
  readonly definition: DefinitionRef;
  readonly status: ItemStatus;
  readonly reason: string;
}
export type ProjectionState = 'APPLIED_HOST' | 'PARTIAL' | 'UNCHANGED' | 'PENDING' | 'REJECTED' | 'FAILED';
export interface ProjectionOutcome extends ProjectionReceipt {
  readonly state: ProjectionState;
  readonly items: readonly ProjectionItem[];
  readonly delivery: 'UNCONFIRMED';
  readonly perkDelivery?: ReturnType<PerkDelivery['status']>;
}
export type ProjectionResult =
  | { readonly status: 'SUPPORTED'; readonly value: ProjectionOutcome }
  | { readonly status: 'UNSUPPORTED'; readonly reason: string; readonly state: ProjectionState; readonly items: readonly ProjectionItem[] };
interface Head { grant_set: GrantSet; complete: boolean }
interface Row { stable_form_key: StableFormKey; definition: DefinitionRef; revision: GrantSet['revision']; owned: boolean; active: boolean }
interface Options {
  readonly pool: PoolPort | undefined;
  readonly unavailableReason?: string;
  readonly schema?: string;
  readonly mp: RuntimeMp | undefined;
  readonly catalogs: readonly RecordCatalogPort[];
  readonly identity: IdentityPort;
  readonly canProject?: (binding: SessionBinding) => boolean;
  readonly nativeRecords?: (binding: SessionBinding) => ReadonlySet<StableFormKey>;
  readonly actors: Pick<Actors, 'onReady' | 'onUnbound'>;
  readonly signal: AbortSignal;
  readonly warn: (message: string) => void;
  readonly perks?: PerkDelivery;
}
const rejected = (reason: string, items: readonly ProjectionItem[] = [], state: ProjectionState = 'REJECTED'): ProjectionResult =>
  Object.freeze({ status: 'UNSUPPORTED', reason, state, items: Object.freeze([...items]) });
const code = (error: unknown) => error instanceof ProjectionError ? error.code : 'PROJECTION_FAILED';

/** B5a implements the fixed port; richer receipts describe host application only.
 * Durable rows are projection bookkeeping, never domain facts or another ledger.
 */
export class SpellProjection implements GrantProjectionPort {
  private ready = new Map<CharacterKey, string>();
  private pending = new Map<CharacterKey, GrantProjection>();
  private tails = new Map<CharacterKey, Promise<unknown>>();
  private closed = false;
  private unsubscribers: (() => void)[];
  private host: SpellHost | undefined;
  private schema: string;
  constructor(private options: Options) {
    this.schema = options.schema ?? 'public';
    if (!/^[a-z_][a-z_0-9]{0,62}$/.test(this.schema) || this.schema.startsWith('pg_')) throw new TypeError('Invalid projection schema');
    if (options.mp) this.host = new SpellHost(options.mp, options.catalogs);
    this.unsubscribers = [options.actors.onReady(event => this.actorReady(event)), options.actors.onUnbound(binding => {
      if (this.ready.get(binding.characterKey) === binding.epoch) this.ready.delete(binding.characterKey);
      if (this.pending.get(binding.characterKey)?.binding.epoch === binding.epoch) this.pending.delete(binding.characterKey);
    })];
    const invalidation = options.actors as Pick<Actors, 'onReady' | 'onUnbound'> & Partial<Pick<Actors, 'onInvalidated'>>;
    if (invalidation.onInvalidated) this.unsubscribers.push(invalidation.onInvalidated(binding => this.ready.delete(binding.characterKey)));
  }
  capability() {
    return Object.freeze({ status: !this.closed && this.options.pool && this.host ? 'PARTIAL' : 'UNSUPPORTED',
      reason: this.closed ? 'PROJECTION_CLOSED' : !this.options.pool ? this.options.unavailableReason ?? 'DATABASE_UNAVAILABLE' : !this.host ? 'HOST_UNAVAILABLE' : 'HOST_APPLICATION_ONLY',
      proof: ['runtime/tests/projection.test.mjs'],
      perks: this.options.perks?.capability() ?? {status:'UNSUPPORTED',reason:'CLIENT_PERK_DELIVERY_OFF_OR_UNAVAILABLE'},
      limitations: ['SPELL_DELIVERY_UNCONFIRMED', 'ONLINE_DELAY_APPROXIMATION_FOR_LEGACY_CLIENTS', ...this.options.perks ? [] : ['PERKS_UNSUPPORTED'], 'UNRECORDED_ADDITIONS_PRESERVED', 'EXTERNAL_GRANTS_AFTER_CORE_ADDITION_UNOBSERVABLE'] });
  }
  onAck(listener: (ack: GrantProjectionAck) => void): () => void { return this.options.perks?.onAck(listener) ?? (() => {}); }
  perkStatus(binding: SessionBinding) { return this.options.perks?.status(binding) ?? { state:'UNSUPPORTED' as const, items:[], reason:'CLIENT_PERK_DELIVERY_OFF_OR_UNAVAILABLE' }; }
  private check(binding: SessionBinding): void {
    if (this.closed || this.options.signal.aborted || !this.options.identity.isCurrent(binding)) throw new ProjectionError('STALE_BINDING');
    if (this.options.canProject && !this.options.canProject(binding)) throw new ProjectionError('FEATURE_MODE_REFUSED');
  }
  private serial<T>(key: CharacterKey, action: () => Promise<T>): Promise<T> {
    const task = (this.tails.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
    const tail = task.finally(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    this.tails.set(key, tail);
    return tail;
  }
  private receipt(projection: GrantProjection, state: ProjectionState, items: readonly ProjectionItem[]): ProjectionResult {
    return Object.freeze({ status: 'SUPPORTED', value: Object.freeze({ binding: projection.binding, revision: projection.set.revision,
      state, items: Object.freeze([...items]), delivery: 'UNCONFIRMED' }) });
  }
  publish(input: GrantProjection): Promise<ProjectionResult> {
    let projection: GrantProjection;
    try {
      // Validate and detach before the first await, including provenance and revisions.
      const set = compose(input.set.characterKey, [input.set.grants], input.set.revision);
      const binding = Object.freeze({ ...input.binding, actorRef: Object.freeze({ ...input.binding.actorRef }) });
      if (set.characterKey !== binding.characterKey || !/^profile:[1-9][0-9]*$/.test(set.characterKey)
        || !Number.isSafeInteger(Number(set.characterKey.slice(8)))) throw new ProjectionError('CHARACTER_MISMATCH');
      projection = Object.freeze({ binding, set }); this.check(binding);
      if (!this.options.pool || !this.host) return Promise.resolve(rejected(this.capability().reason));
      const prior = this.pending.get(set.characterKey);
      if (prior) this.acceptRevision(prior.set, set);
      this.pending.set(set.characterKey, projection);
    } catch (error) { return Promise.resolve(rejected(error instanceof ProjectionError ? error.code : 'INVALID_PROJECTION')); }
    return this.serial(projection.set.characterKey, () => this.runAndDeliver(projection, false));
  }
  private acceptRevision(previous: GrantSet, next: GrantSet): void {
    const relation = compareRevisions(next.revision, previous.revision);
    if (relation === 'before' || relation === 'incomparable') throw new ProjectionError('STALE_OR_INCOMPARABLE_REVISION');
    if (relation === 'equal' && canonicalJson(previous) !== canonicalJson(next)) throw new ProjectionError('REVISION_CONTENT_CONFLICT');
  }
  private actorReady({ binding }: ActorReady): void {
    try { this.check(binding); } catch { return; }
    this.ready.set(binding.characterKey, binding.epoch);
    const pending = this.pending.get(binding.characterKey);
    const input = pending?.binding.epoch === binding.epoch ? pending : { binding, set: undefined };
    void this.serial(binding.characterKey, () => this.runAndDeliver(input, true)).then(result => {
      if (result.status === 'UNSUPPORTED') this.options.warn(`spell reconciliation: ${result.reason}`);
    }).catch(() => this.options.warn('spell reconciliation: PROJECTION_FAILED'));
  }
  private async runAndDeliver(input: { binding: SessionBinding; set: GrantSet | undefined }, reconcile: boolean): Promise<ProjectionResult> {
    const result = await this.run(input, reconcile);
    if (!this.options.perks || result.status !== 'SUPPORTED' || result.value.state === 'PENDING' || input.set===undefined) return result;
    const set = this.pending.get(input.binding.characterKey)?.set;
    if (!set) return result;
    try {
      this.check(input.binding);
      const perkDelivery = await this.options.perks.publish({binding:input.binding,set},reconcile);
      return {status:'SUPPORTED',value:{...result.value,perkDelivery,items:[...result.value.items,...perkDelivery.items]}};
    } catch { return rejected('PERK_DELIVERY_FAILED', result.value.items, 'FAILED'); }
  }
  private async run(input: { binding: SessionBinding; set: GrantSet | undefined }, reconcile: boolean): Promise<ProjectionResult> {
    const { binding } = input;
    let client: PoolClient | undefined;
    let locked = false, discard = false;
    const items: ProjectionItem[] = [];
    let applying=false;
    const check = () => { this.check(binding); if(applying&&this.ready.get(binding.characterKey)!==binding.epoch)throw new ProjectionError('ACTOR_NOT_READY'); };
    const table = (name: string) => `"${this.schema}".${name}`;
    try {
      check();
      if (!this.options.pool || !this.host) return rejected(this.capability().reason);
      client = await this.options.pool.connect(); check();
      // Session lock spans separate DB transactions and synchronous host calls.
      // Uses B3's exact character namespace; no transaction is open at the host.
      await client.query('SELECT pg_advisory_lock($1::bigint)', [-Number(binding.characterKey.slice(8))]); locked = true; check();
      const head = (await client.query<Head>(`SELECT grant_set, complete FROM ${table('gc_spell_projection_heads')} WHERE character_key=$1`, [binding.characterKey])).rows[0]; check();
      const set = input.set ?? (head ? compose(head.grant_set.characterKey, [head.grant_set.grants], head.grant_set.revision) : undefined);
      if (!set) return rejected('NO_PUBLISHED_SET');
      const projection = { binding, set };
      this.pending.set(binding.characterKey, projection);
      if (head) this.acceptRevision(compose(head.grant_set.characterKey, [head.grant_set.grants], head.grant_set.revision), set);
      if (this.ready.get(binding.characterKey) !== binding.epoch) {
        return this.receipt(projection, 'PENDING', effectiveSet(portGrantSet(set, head?.grant_set)).grants.map(g => ({ definition: g.definition, status: 'PENDING', reason: 'ACTOR_NOT_READY' })));
      }
      applying=true;
      const observed = this.options.nativeRecords?.(binding) ?? new Set<StableFormKey>();
      const native = new Set([...nativeGrantKeys(set, head?.grant_set), ...observed]);
      const effective = effectiveSet(portGrantSet(set, head?.grant_set, observed));
      const desired = new Map<StableFormKey, DefinitionRef>();
      for (const item of effective.grants) {
        if (item.kind === 'perk' && this.options.perks) continue;
        if (!['spell', 'ability', 'power'].includes(item.kind) || item.definition.recordType !== 'SPEL') {
          items.push({ definition: item.definition, status: 'UNSUPPORTED', reason: 'B5A_SPEL_ONLY' });
        } else desired.set(item.definition.stableFormKey, item.definition);
      }
      if (!reconcile && head?.complete && compareRevisions(head.grant_set.revision, set.revision) === 'equal') {
        for (const definition of desired.values()) items.push({ definition, status: 'ALREADY_PRESENT', reason: 'RECORDED_SAME_REVISION_NO_HOST_CALL' });
        return this.receipt(projection, items.some(i => i.status === 'UNSUPPORTED') ? 'PARTIAL' : 'UNCHANGED', items);
      }
      const rows = (await client.query<Row>(`SELECT stable_form_key, definition, revision, owned, active FROM ${table('gc_spell_projections')} WHERE character_key=$1`, [binding.characterKey])).rows; check();
      const recorded = new Map(rows.map(row => [row.stable_form_key, row]));
      const actual = this.host.learned(binding, check);
      const save = async (row: Row | undefined, complete: boolean) => {
        check();
        // Reuse B3 lifecycle helper on the already borrowed, locked connection.
        const borrowed: PoolPort = { connect: async () => ({ query: async (sql, params) => {
          if (sql !== 'ROLLBACK') check();
          return client!.query(sql, params);
        }, release: error => { if (error) discard = true; } }) };
        await withTransaction(borrowed, async tx => {
          check();
          if (row) {
            await tx.query(`INSERT INTO ${table('gc_spell_projections')} (character_key, stable_form_key, definition, revision, owned, active)
              VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6) ON CONFLICT (character_key,stable_form_key) DO UPDATE
              SET definition=EXCLUDED.definition, revision=EXCLUDED.revision, owned=EXCLUDED.owned, active=EXCLUDED.active`,
            [binding.characterKey, row.stable_form_key, canonicalJson(row.definition), canonicalJson(set.revision), row.owned, row.active]); check();
          }
          await tx.query(`INSERT INTO ${table('gc_spell_projection_heads')} (character_key,grant_set,complete) VALUES ($1,$2::jsonb,$3)
            ON CONFLICT (character_key) DO UPDATE SET grant_set=EXCLUDED.grant_set,complete=EXCLUDED.complete,updated_at=CURRENT_TIMESTAMP`,
          [binding.characterKey, canonicalJson(set), complete]); check();
        }); check();
      };
      // Resolve every changed definition before touching it. Missing catalog leaves
      // that row intact; it never causes an unrelated spell to be revoked.
      for (const row of rows.filter(row => row.active && !desired.has(row.stable_form_key))) {
        check();
        try {
          let status: ItemStatus = 'ALREADY_PRESENT', reason = 'EXTERNAL_SPELL_PRESERVED';
          if (native.has(row.stable_form_key)) {
            // Native delivery takes precedence even over an earlier Core-owned
            // row. Relinquish bookkeeping ownership without touching the host.
            await save({ ...row, owned: false, active: false }, false); check();
            items.push({ definition: row.definition, status, reason: 'NATIVE_RACE_RECORD_PRESERVED' });
            continue;
          }
          if (row.owned) {
            const id = this.host.resolve(row.definition);
            if (actual.has(id)) {
              check();
              if (!this.host.mutate(binding, 'RemoveSpell', id)) throw new ProjectionError('REMOVE_REFUSED');
              actual.delete(id); status = 'REMOVED_HOST'; reason = 'CORE_OWNED';
            } else { status = 'ALREADY_ABSENT'; reason = 'HOST_ALREADY_ABSENT'; }
          }
          await save({ ...row, active: false }, false); check();
          items.push({ definition: row.definition, status, reason });
        } catch (error) {
          if (error instanceof ProjectionError && error.code === 'CATALOG_UNSUPPORTED') items.push({ definition: row.definition, status: 'UNSUPPORTED', reason: error.code });
          else { items.push({ definition: row.definition, status: 'FAILED', reason: code(error) }); throw error; }
        }
      }
      for (const [key, definition] of desired) {
        check();
        try {
          const id = this.host.resolve(definition);
          const prior = recorded.get(key);
          let owned = !!prior?.active && prior.owned;
          let status: ItemStatus = 'ALREADY_PRESENT', reason = owned ? 'CORE_RECORDED_PRESENT' : 'EXTERNAL_OR_UNRECORDED_PRESENT_PRESERVED';
          if (!actual.has(id)) {
            check();
            const added = this.host.mutate(binding, 'AddSpell', id);
            // False is the native already-known/base-spell outcome. Never claim it.
            owned = prior && !prior.owned ? false : added;
            status = added ? 'APPLIED_HOST' : 'ALREADY_PRESENT';
            reason = added ? 'HOST_ADDED_NO_CLIENT_ACK' : 'NATIVE_BASE_OR_ALREADY_KNOWN_PRESERVED';
            actual.add(id);
          }
          await save({ stable_form_key: key, definition, revision: set.revision, owned, active: true }, false); check();
          items.push({ definition, status, reason });
        } catch (error) {
          if (error instanceof ProjectionError && error.code === 'CATALOG_UNSUPPORTED') items.push({ definition, status: 'UNSUPPORTED', reason: error.code });
          else { items.push({ definition, status: 'FAILED', reason: code(error) }); throw error; }
        }
      }
      // Unsupported grant kinds are a terminal per-item outcome of B5a. They
      // must not cause repeated host reads for an otherwise completed revision.
      await save(undefined, !items.some(i => i.status === 'UNSUPPORTED' && i.reason !== 'B5A_SPEL_ONLY')); check();
      return this.receipt(projection, items.some(i => i.status === 'UNSUPPORTED') ? 'PARTIAL' : 'APPLIED_HOST', items);
    } catch (error) { return rejected(code(error), items, 'FAILED'); }
    finally {
      if (client) {
        // Cleanup must run even after unbind; it does not mutate projection rows.
        if (locked) { try { await client.query('SELECT pg_advisory_unlock($1::bigint)', [-Number(binding.characterKey.slice(8))]); } catch { discard = true; } }
        client.release(discard);
      }
    }
  }
  async shutdown(): Promise<void> {
    this.closed = true; for (const fn of this.unsubscribers.splice(0)) fn();
    this.ready.clear(); this.pending.clear();
    await Promise.allSettled([...this.tails.values()]);
    await this.options.perks?.shutdown();
  }
}
