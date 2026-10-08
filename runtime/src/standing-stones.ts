import { randomUUID } from 'node:crypto';
import type { SessionBinding, StableFormKey } from '../../shared/contracts/src/index.ts';
import { decodeFormKey } from '../../shared/record-catalog/src/index.ts';
import type { DomainData } from '../../shared/record-catalog/src/types.ts';
import { createStandingStoneCommands, readStandingStone, standingStoneGrants } from '../../modules/standing-stone-system/src/index.ts';
import type { ChoiceIntent, ChoiceReceipt } from '../../modules/standing-stone-system/src/index.ts';
import type { SystemContext } from './index.ts';
import type { RuntimeMp } from './host.ts';
import type { ProjectionResult } from './projection/index.ts';
import { scopedPool } from './persistence-scope.ts';

const noticeProperty = 'gcStandingStoneNotice';
// Source: ScampServer::MakeProperty/Get/Set, CustomPropertyBinding.cpp;
// phase0-basic.js:216-238 demonstrates owner-only code executed on the client.
export const noticeOwnerCode = `
  const v = ctx.value;
  const s = ctx.state || (ctx.state = {});
  if (v && typeof v.id === 'string' && typeof v.message === 'string'
      && s.gcStandingStoneNotice !== v.id && Date.now() - v.sentAt < 15000
      && ctx.sp && ctx.sp.Debug && ctx.sp.Debug.notification) {
    s.gcStandingStoneNotice = v.id;
    ctx.sp.Debug.notification(v.message);
  }
`;
export type StandingStoneOutcome =
  | { readonly status: 'SUPPORTED'; readonly receipt: ChoiceReceipt; readonly projection: ProjectionResult }
  | { readonly status: 'UNSUPPORTED'; readonly reason: string; readonly committed: boolean | 'UNKNOWN' };
export class StandingStoneSystem {
  private commands;
  private pending = new Set<Promise<unknown>>();
  private stops: (() => void)[] = [];
  constructor(private context: SystemContext, private mp: RuntimeMp | undefined,
    private data: DomainData, private schema: string) {
    this.commands = createStandingStoneCommands({ pool: context.persistence?.pool, catalog: context.catalog,
      canMutate: binding => !context.signal.aborted && context.canMutate(binding),
      transactionPool: binding => scopedPool(context.persistence!.pool, schema, () => {
        if (context.signal.aborted || !context.canMutate(binding)) throw Object.assign(Error('MODE_OR_STALE_BINDING'), { code: 'MODE_OR_STALE_BINDING' });
      }) });
  }
  start(): void {
    // Observe modes never register a writer/provider or publish a projection.
    if (['canary', 'active'].includes(this.context.mode) && this.context.catalog?.status === 'SUPPORTED' && this.context.persistence) {
      this.stops.push(this.context.composition.register({ id: 'standing-stones', read: async (tx, key) => {
        const fact = await readStandingStone(tx, key);
        return { grants: standingStoneGrants(this.context.catalog, fact), revision: fact?.revision ?? 0 };
      } }));
      this.stops.push(this.context.actors.onReady(({ binding }) => {
        if (this.context.canMutate(binding)) this.track(this.context.composition.recompose(binding).then(result => {
          if (result.status === 'UNSUPPORTED') this.log(result.reason);
        }).catch(() => this.log('REHYDRATION_FAILED')));
      }));
    }
    this.stops.push(this.context.hooks.register('onActivate', (target, caster) => this.activate(target!, caster!)));
  }
  private log(message: string): void { this.context.log.info(`[standing-stones] ${message}`); }
  private track(task: Promise<unknown>): void {
    this.pending.add(task); void task.finally(() => this.pending.delete(task)).catch(() => {});
  }
  /** Unreconciled root IDs are used only to recognize/refuse an unavailable
   * domain. Grants/commands always require the reconciled catalog. */
  private recognize(target: number): StableFormKey | undefined {
    try {
      const desc = this.mp?.get(target, 'baseDesc');
      if (typeof desc !== 'string') return undefined;
      for (const root of this.data.records.filter(r => this.data.roots.includes(r.stableFormKey))) {
        try { if (decodeFormKey(desc, 'skymp', root.pluginKind) === root.stableFormKey) return root.stableFormKey; } catch { /* another plugin kind */ }
      }
    } catch { /* Missing reference context cannot be inferred from targetId. */ }
    return undefined;
  }
  private notify(binding: SessionBinding, message: string): void {
    if (this.context.signal.aborted || !this.context.identity.isCurrent(binding)) return;
    try {
      if (!this.mp?.makeProperty || !this.mp.set) throw Error('NOTICE_API_UNAVAILABLE');
      // A read checks registration in the real host, including after mp.clear.
      // Define lazily so audit/shadow/off create no properties or UI state.
      try { this.mp.get(binding.actorRef.actorId, noticeProperty); }
      catch { this.mp.makeProperty(noticeProperty, { isVisibleByOwner: true, isVisibleByNeighbors: false,
        updateOwner: noticeOwnerCode, updateNeighbor: '' }); }
      this.mp.set(binding.actorRef.actorId, noticeProperty, { id: randomUUID(), sentAt: Date.now(), message });
    } catch { this.log('PLAYER_NOTICE_UNSUPPORTED'); }
  }
  private activate(target: number, caster: number): unknown {
    const stoneKey = this.recognize(target); if (!stoneKey) return undefined;
    const live = this.context.identity.lookup({ actorId: caster as SessionBinding['actorRef']['actorId'] });
    if (['audit', 'shadow'].includes(this.context.mode)) {
      this.log(`${this.context.mode}: WOULD_CHOOSE stone=${stoneKey}; native allowed; no durable mutation`); return undefined;
    }
    // An unbound character cannot be selected for canary. Active fails closed.
    if (this.context.mode === 'canary' && (live.status !== 'SUPPORTED' || !this.context.canMutate(live.value))) return undefined;
    if (live.status !== 'SUPPORTED') { this.log('ACTIVATION_REFUSED_NO_CURRENT_BINDING'); return false; }
    const binding = live.value;
    this.track(this.choose({ binding, stoneKey, requestId: randomUUID() }).then(result => {
      if (result.status === 'UNSUPPORTED') {
        this.notify(binding, result.committed === 'UNKNOWN'
          ? 'Não foi possível confirmar a escolha da pedra guardiã. Tente novamente ou reconecte.'
          : result.committed
          ? 'Pedra guardiã salva. O efeito ainda não pôde ser aplicado; tente novamente ou reconecte.'
          : 'Não foi possível escolher a pedra guardiã. Tente novamente.');
      } else if (result.receipt.status === 'conflict') this.notify(binding, 'Não foi possível escolher a pedra guardiã. Tente novamente.');
      else if (result.projection.status !== 'SUPPORTED' || ['PENDING', 'PARTIAL'].includes(result.projection.value.state)) {
        this.notify(binding, 'Pedra guardiã salva. A aplicação do efeito está pendente.');
      } else this.notify(binding, result.receipt.result.changed ? 'Pedra guardiã escolhida.' : 'Você já escolheu esta pedra guardiã.');
    }).catch(() => { this.log('ACTIVATION_FAILED'); this.notify(binding, 'Não foi possível escolher a pedra guardiã. Tente novamente.'); }));
    // The veto is synchronous. Database failure must never enable a second writer.
    return false;
  }
  async choose(input: ChoiceIntent): Promise<StandingStoneOutcome> {
    let committed = false;
    try {
      const receipt = await this.commands.choose(input); committed = receipt.status === 'accepted';
      if (receipt.status === 'conflict') return { status: 'UNSUPPORTED', reason: receipt.reason, committed: false };
      const projection = await this.context.composition.recompose(input.binding);
      if (projection.status === 'UNSUPPORTED') return { status: 'UNSUPPORTED', reason: projection.reason, committed };
      return { status: 'SUPPORTED', receipt, projection };
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      const reason = typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : 'STANDING_STONE_FAILED';
      this.log(reason); return { status: 'UNSUPPORTED', reason, committed: reason === 'COMMIT_UNCONFIRMED' ? 'UNKNOWN' : committed };
    }
  }
  async shutdown(): Promise<void> { await Promise.allSettled([...this.pending]); for (const stop of this.stops.splice(0).reverse()) stop(); }
}
