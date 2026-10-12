import { randomUUID } from 'node:crypto';
import type { DefinitionRef, SessionBinding, StableFormKey } from '../../../shared/contracts/src/identity.js';
import type { GrantProjection, GrantProjectionAck } from '../../../shared/contracts/src/grants.js';
import type { RecordCatalogPort } from '../../../shared/contracts/src/ports.js';
import type { PoolPort } from '../../../shared/persistence/src/index.js';
import { canonicalJson, lockCharacter, withTransaction } from '../../../shared/persistence/src/index.js';
import { effectiveSet, compareRevisions } from '../../../modules/actor-state-system/src/index.ts';
import { scopedPool } from '../persistence-scope.ts';
import { ClientDelivery, exact, MAX_ITEMS } from '../client-delivery.ts';
import type { DeliveryCycle } from '../client-delivery.ts';
import { nativeGrantKeys, portGrantSet } from '../composition.ts';
import type { ProjectionItem } from './index.js';

interface Row { stable_form_key: StableFormKey; definition: DefinitionRef; revision: GrantProjection['set']['revision']; owned: boolean; active: boolean; item_status: string }
interface WireItem { key: StableFormKey; plugin: string; localFormId: number; signature: string; action: 'ensure' | 'remove'; owned: boolean }
interface Pending { projection: GrantProjection; cycle: DeliveryCycle; challenge: string; id: string; items: WireItem[]; definitions: Map<string, DefinitionRef>; committing: boolean; expires: number; timer?: ReturnType<typeof setTimeout> }
export const PERK_ACK_TIMEOUT_MS = 10000;
export type PerkDeliveryState = 'UNSUPPORTED' | 'CLIENT_UNSUPPORTED' | 'ACTOR_NOT_READY' | 'SENT_UNCONFIRMED' | 'CONFIRMED' | 'PARTIAL' | 'FAILED';
interface Options {
  pool: PoolPort; schema: string; channel: ClientDelivery; catalogs: readonly RecordCatalogPort[];
  check(binding: SessionBinding): void;
  nativeRecords(binding: SessionBinding, set:GrantProjection['set']): ReadonlySet<StableFormKey>;
  rankRecords: ReadonlyMap<StableFormKey, ReadonlySet<number>>;
  warn(message: string): void;
  ackTimeoutMs?: number;
  serializeSameRevision?: boolean;
}
/** Internal PERK adapter of the single GrantProjectionPort, not a grant store.
 * Authorship is saved only after an exact current-session ACK transaction. */
export class PerkDelivery {
  private pending = new Map<string, Pending>();
  private results = new Map<string, { epoch: string; revision: GrantProjection['set']['revision']; state: PerkDeliveryState; items: readonly ProjectionItem[] }>();
  private listeners = new Set<(ack: GrantProjectionAck) => void>();
  private tails = new Set<Promise<unknown>>();
  private stops: (() => void)[];
  private closed = false;
  constructor(private options: Options) {
    this.stops = [options.channel.onReset(binding => {
      clearTimeout(this.pending.get(binding.characterKey)?.timer);
      this.pending.delete(binding.characterKey); this.results.delete(binding.characterKey);
    }), options.channel.onAck((cycle, p) => this.ack(cycle, p))];
  }
  capability() { return { status: 'SUPPORTED', reason: 'CLIENT_PROTOCOL_AVAILABLE', proof: ['runtime/tests/client-delivery.test.mjs', 'runtime/tests/perks.test.mjs'],
    limitations: ['PERK_ACK_IS_DELIVERY_EVIDENCE_ONLY', 'SPELL_DELIVERY_UNCONFIRMED', 'EXTERNAL_GRANTS_AFTER_CORE_ADDITION_UNOBSERVABLE', 'UNRECORDED_ADDITIONS_PRESERVED'] }; }
  status(binding: SessionBinding): { state: PerkDeliveryState; items: readonly ProjectionItem[] } {
    const state = this.results.get(binding.characterKey);
    const pending = this.pending.get(binding.characterKey);
    if (pending?.projection.binding.epoch === binding.epoch && performance.now() > pending.expires) return { state: 'SENT_UNCONFIRMED', items: state?.items ?? [] };
    const cycle=this.options.channel.current(binding);
    return Object.freeze({state:state?.epoch===binding.epoch?state.state:!cycle?.cycle?'CLIENT_UNSUPPORTED':cycle.ready?'SENT_UNCONFIRMED':'ACTOR_NOT_READY',
      items:Object.freeze((state?.epoch===binding.epoch?state.items:[]).map(item=>Object.freeze({...item})))});
  }
  onAck(fn: (ack: GrantProjectionAck) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private check(binding: SessionBinding): void { if (this.closed) throw Error('PERK_DELIVERY_CLOSED'); this.options.check(binding); }
  async publish(projection: GrantProjection, reconcile: boolean): Promise<{ state: PerkDeliveryState; items: readonly ProjectionItem[] }> {
    const { binding, set } = projection;
    this.check(binding);
    const cycle = this.options.channel.current(binding), current = this.results.get(binding.characterKey);
    if (!cycle?.ready || !cycle.challenge || !cycle.cycle) return { state: !cycle?.cycle ? 'CLIENT_UNSUPPORTED' : 'ACTOR_NOT_READY', items: [] };
    const cycleChallenge = cycle.challenge;
    if (current?.epoch === binding.epoch && current.state === 'CONFIRMED' && !reconcile && compareRevisions(current.revision, set.revision) === 'equal') return this.status(binding);
    // Never supersede an ACK transaction with the same revision; wait for its outcome.
    const busy = this.pending.get(binding.characterKey);
    // DEV sweep must not replace a still-unconfirmed initial ready delivery.
    // Other ready providers can request the same set before its ACK commits.
    if (this.options.serializeSameRevision && busy?.cycle === cycle && busy.challenge === cycleChallenge
      && canonicalJson(busy.projection.set) === canonicalJson(set)) return this.status(binding);
    if (busy?.committing) { await Promise.allSettled([...this.tails]); this.check(binding); return this.publish(projection, reconcile); }
    const table = `"${this.options.schema}".gc_perk_projections`;
    const rows = await withTransaction(scopedPool(this.options.pool, this.options.schema, () => this.check(binding)), async tx => {
      await lockCharacter(tx, binding.characterKey);
      return (await tx.query<Row>(`SELECT stable_form_key,definition,revision,owned,active,item_status FROM ${table} WHERE character_key=$1`, [binding.characterKey])).rows;
    });
    this.check(binding);
    if (this.options.channel.current(binding) !== cycle || !cycle.ready || cycle.challenge !== cycleChallenge) return { state: 'ACTOR_NOT_READY', items: [] };
    const native = new Set([...nativeGrantKeys(set), ...this.options.nativeRecords(binding,set),
      ...set.grants.filter(g => g.kind === 'perk' && g.source.kind === 'STANDING_STONE').map(g => g.definition.stableFormKey)]);
    const desired = effectiveSet(portGrantSet(set, undefined, native)).grants.filter(g => g.kind === 'perk');
    const recorded = new Map(rows.map(r => [r.stable_form_key, r]));
    const protectedRows=rows.filter(r=>r.owned&&native.has(r.stable_form_key));
    if(protectedRows.length)await withTransaction(scopedPool(this.options.pool,this.options.schema,()=>this.check(binding)),async tx=>{
      await lockCharacter(tx,binding.characterKey);
      for(const row of protectedRows)await tx.query(`UPDATE ${table} SET owned=false,active=false WHERE character_key=$1 AND stable_form_key=$2`,[binding.characterKey,row.stable_form_key]);
    });
    this.check(binding);
    if(this.options.channel.current(binding)!==cycle||!cycle.ready||cycle.challenge!==cycleChallenge)return {state:'ACTOR_NOT_READY',items:[]};
    const definitions = new Map<string, DefinitionRef>();
    const items: WireItem[] = [], failures: ProjectionItem[] = [];
    const wire = (definition: DefinitionRef, action: WireItem['action'], owned: boolean): WireItem | undefined => {
      if (definition.recordType !== 'PERK' || !this.options.catalogs.some(c => c.lookup(definition).status === 'SUPPORTED')) {
        failures.push({ definition, status: 'UNSUPPORTED', reason: 'CATALOG_UNSUPPORTED' }); return;
      }
      const [plugin, hex] = definition.stableFormKey.split('|');
      if (!plugin || !hex || !/^[0-9A-F]{6}$/.test(hex)) { failures.push({ definition, status: 'UNSUPPORTED', reason: 'INVALID_STABLE_KEY' }); return; }
      definitions.set(definition.stableFormKey, definition);
      return { key: definition.stableFormKey, plugin, localFormId: parseInt(hex, 16), signature: definition.catalogSignature, action, owned };
    };
    const desiredKeys = new Set(desired.map(g => g.definition.stableFormKey));
    for (const grant of desired) {
      if (grant.kind !== 'perk') continue;
      if (grant.rank !== 1 && !this.options.rankRecords.get(grant.definition.stableFormKey)?.has(grant.rank)) {
        failures.push({ definition: grant.definition, status: 'UNSUPPORTED', reason: 'RANK_NOT_AUDITED_AS_DISTINCT_RECORD' }); continue;
      }
      const row = recorded.get(grant.definition.stableFormKey);
      const item = wire(grant.definition, 'ensure', !!row?.owned);
      if (item) items.push(item);
    }
    for (const row of rows.filter(r => r.active && r.owned && !desiredKeys.has(r.stable_form_key) && !native.has(r.stable_form_key))) {
      const item = wire(row.definition, 'remove', true); if (item) items.push(item);
    }
    if (items.length > MAX_ITEMS) return { state: 'UNSUPPORTED', items: [{ definition: items.length ? definitions.get(items[0]!.key)! : desired[0]!.definition, status: 'UNSUPPORTED', reason: 'PERK_SET_TOO_LARGE' }] };
    const id = randomUUID(), challenge = cycle.challenge;
    clearTimeout(this.pending.get(binding.characterKey)?.timer);
    const timeout = this.options.ackTimeoutMs ?? PERK_ACK_TIMEOUT_MS;
    const pending: Pending = { projection, cycle, challenge, id, items, definitions, committing: false, expires: performance.now() + timeout };
    this.pending.set(binding.characterKey, pending);
    pending.timer = setTimeout(() => {
      if (this.pending.get(binding.characterKey) !== pending || pending.committing) return;
      try { this.check(binding); if (this.options.channel.current(binding) !== cycle) return; } catch { return; }
      this.options.warn(`perks ${binding.characterKey}: ACK_TIMEOUT; ${items.length} items; delivery=SENT_UNCONFIRMED`);
    }, timeout);
    pending.timer.unref();
    const outcome = { epoch: binding.epoch, revision: set.revision, state: 'SENT_UNCONFIRMED' as PerkDeliveryState,
      items: [...failures, ...items.map(i => ({ definition: definitions.get(i.key)!, status: 'SENT_UNCONFIRMED' as const, reason: 'NO_CLIENT_ACK_YET' }))] };
    this.results.set(binding.characterKey, outcome);
    if (!this.options.channel.send(cycle, { type: 'perks', cycle: cycle.cycle, challenge, id, revision: set.revision, items })) {
      clearTimeout(pending.timer);
      this.pending.delete(binding.characterKey); outcome.state = 'FAILED';
    }
    return this.status(binding);
  }
  private ack(cycle: DeliveryCycle, p: Record<string, unknown>): void {
    const pending = this.pending.get(cycle.binding.characterKey);
    if (!pending || pending.committing || pending.cycle !== cycle || pending.challenge !== cycle.challenge || p.id !== pending.id
      || performance.now() > pending.expires || !exact(p, ['channel','v','type','session','cycle','challenge','id','revision','items'])
      || !exact(p.revision,['facts','grants','equipment','effects','catalog'])
      || Object.values(p.revision).some(value=>!Number.isSafeInteger(value)||typeof value!=='number'||value<0)
      || canonicalJson(p.revision) !== canonicalJson(pending.projection.set.revision)
      || !Array.isArray(p.items) || p.items.length !== pending.items.length) return;
    const statuses = new Set(['APPLIED','REMOVED','ALREADY_PRESENT','ALREADY_ABSENT','UNRESOLVED','FAILED']);
    const reports = p.items as { key: string; signature: string; action: string; status: string }[];
    if (reports.some((r, i) => !exact(r, ['key','signature','action','status']) || !statuses.has(r.status)
      || r.key !== pending.items[i]!.key || r.signature !== pending.items[i]!.signature || r.action !== pending.items[i]!.action
      || (r.action === 'ensure' ? ['REMOVED','ALREADY_ABSENT'].includes(r.status) : ['APPLIED','ALREADY_PRESENT'].includes(r.status)))) return;
    pending.committing = true;
    clearTimeout(pending.timer);
    const count = (status: string) => reports.filter(r => r.status === status).length;
    this.options.warn(`perks ${cycle.binding.characterKey}: ACK_RECEIVED; applied=${count('APPLIED')}; alreadyPresent=${count('ALREADY_PRESENT')}; unresolved=${count('UNRESOLVED')}; failed=${count('FAILED')}; removed=${count('REMOVED')}; alreadyAbsent=${count('ALREADY_ABSENT')}; delivery evidence only`);
    const binding = pending.projection.binding;
    const check = () => {
      this.check(binding);
      if (this.pending.get(binding.characterKey) !== pending || this.options.channel.current(binding) !== cycle || cycle.challenge !== pending.challenge || !cycle.ready) throw Error('STALE_CLIENT_CYCLE');
    };
    const task = withTransaction(scopedPool(this.options.pool, this.options.schema, check), async tx => {
      await lockCharacter(tx, binding.characterKey); check();
      for (const report of reports) {
        if (['UNRESOLVED','FAILED'].includes(report.status)) continue;
        const item = pending.items.find(i => i.key === report.key)!;
        await tx.query(`INSERT INTO "${this.options.schema}".gc_perk_projections
          (character_key,stable_form_key,definition,revision,owned,active,item_status) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7)
          ON CONFLICT (character_key,stable_form_key) DO UPDATE SET definition=EXCLUDED.definition,revision=EXCLUDED.revision,
          owned=CASE WHEN gc_perk_projections.owned=false THEN false ELSE EXCLUDED.owned END,
          active=EXCLUDED.active,item_status=EXCLUDED.item_status,updated_at=CURRENT_TIMESTAMP`,
        [binding.characterKey, item.key, canonicalJson(pending.definitions.get(item.key)), canonicalJson(pending.projection.set.revision),
          item.owned || report.status === 'APPLIED', item.action === 'ensure', report.status]);
        check();
      }
    }).then(() => {
      check();
      const result = this.results.get(binding.characterKey)!;
      const priorFailures = result.items.filter(i => i.status === 'UNSUPPORTED');
      result.items = [...priorFailures, ...reports.map(r => ({ definition: pending.definitions.get(r.key)!,
        status: r.status === 'UNRESOLVED' ? 'UNSUPPORTED' as const : r.status === 'FAILED' ? 'FAILED' as const
          : r.status === 'APPLIED' ? 'APPLIED_CLIENT' as const : r.status === 'REMOVED' ? 'REMOVED_CLIENT' as const : r.status as 'ALREADY_PRESENT' | 'ALREADY_ABSENT',
        reason: 'EXACT_CLIENT_ACK' }))];
      result.state = result.items.some(i => ['UNSUPPORTED','FAILED'].includes(i.status)) ? 'PARTIAL' : 'CONFIRMED';
      this.pending.delete(binding.characterKey);
      const ack: GrantProjectionAck = { binding, revision: pending.projection.set.revision,
        status: result.state === 'CONFIRMED' ? 'applied' : 'unsupported', reason: 'PERK_ITEMS_ONLY; SPELL_DELIVERY_UNCONFIRMED; NOT_GAMEPLAY_RESULT_PROOF' };
      for (const fn of [...this.listeners]) { try { fn(ack); } catch { this.options.warn('perk ACK subscriber failed'); } }
      this.options.warn(`perks ${binding.characterKey}: ${result.state}; ${reports.length} items; delivery evidence only`);
    }).catch(() => {
      if (this.pending.get(binding.characterKey) === pending) { pending.committing = false; this.options.warn('perk ACK recording failed; delivery remains unconfirmed'); }
    });
    this.tails.add(task); void task.finally(() => this.tails.delete(task));
  }
  async shutdown(): Promise<void> { this.closed = true; for (const stop of this.stops) stop(); for (const p of this.pending.values()) clearTimeout(p.timer); this.pending.clear(); this.results.clear(); await Promise.allSettled([...this.tails]); this.listeners.clear(); }
}
