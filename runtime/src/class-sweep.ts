import { randomUUID } from 'node:crypto';
import type { SessionBinding, GrantProjectionAck } from '../../shared/contracts/src/index.ts';
import type { DomainData } from '../../shared/record-catalog/src/types.ts';
import type { SystemContext } from './index.ts';
import type { ProjectionItem } from './projection/index.ts';
import { PERK_ACK_TIMEOUT_MS } from './projection/perks.ts';
import { requireDevelopmentOption, type CoreEnvironment } from './development.ts';

export function developmentClassSweep(env: CoreEnvironment, level: number | undefined, deliveryMode: string): boolean {
  if (env.GAMEPLAY_CORE_DEV_CLASS_SWEEP === undefined) return false;
  requireDevelopmentOption(env, 'GAMEPLAY_CORE_DEV_CLASS_SWEEP');
  if (!['true', 'false'].includes(env.GAMEPLAY_CORE_DEV_CLASS_SWEEP)) throw Error('DEV_CLASS_SWEEP_INVALID');
  if (env.GAMEPLAY_CORE_DEV_CLASS_SWEEP !== 'true') return false;
  if (level === undefined) throw Error('DEV_CLASS_SWEEP_REQUIRES_DEV_CLASS_LEVEL');
  if (deliveryMode !== 'active') throw Error('DEV_CLASS_SWEEP_REQUIRES_ACTIVE_CLIENT_PERKS');
  return true;
}
interface Run { binding: SessionBinding; controller: AbortController; step: string; reason?: string }
interface Options {
  context: SystemContext; data: DomainData;
  readOriginal(binding: SessionBinding): Promise<string | undefined>;
  /** Always classes.set. Detached is exclusively for restoration after invalidation. */
  change(binding: SessionBinding, classId: string, requestId: string, detached: boolean): Promise<void>;
  timeoutMs?: number;
  attempted?: Set<string>;
}
const sameRevision = (a: GrantProjectionAck['revision'], b: GrantProjectionAck['revision']) =>
  (['facts','grants','equipment','effects','catalog'] as const).every(key => a[key] === b[key]);

/** Transient DEV coordinator. Domain facts and delivery stay with their owners. */
export class DevelopmentClassSweep {
  private attempted: Set<string>;
  private runs = new Map<string, Run>();
  private tasks = new Map<string, Promise<void>>();
  private stops: (() => void)[] = [];
  constructor(private options: Options) { this.attempted = options.attempted ?? new Set(); }
  start() {
    const ctx = this.options.context;
    this.stops.push(ctx.projection.onAck(ack => {
      if (ack.status !== 'applied' || ctx.projection.perkStatus(ack.binding).state !== 'CONFIRMED'
        || !ctx.canMutate(ack.binding) || this.attempted.has(ack.binding.characterKey)) return;
      this.attempted.add(ack.binding.characterKey);
      const run: Run = {binding:ack.binding, controller:new AbortController(), step:'0'};
      this.runs.set(ack.binding.characterKey,run);
      // Let the initial ACK complete its logging before issuing another command.
      const task = Promise.resolve().then(() => this.execute(run));
      this.tasks.set(ack.binding.characterKey,task); void task.finally(() => this.tasks.delete(ack.binding.characterKey)).catch(() => {});
    }));
    const abort = (binding: SessionBinding, reason: string) => {
      const run = this.runs.get(binding.characterKey);
      if (run?.binding.epoch === binding.epoch && !run.controller.signal.aborted) {
        run.reason = reason; run.controller.abort();
      }
    };
    this.stops.push(ctx.actors.onUnbound(b => abort(b,'ACTOR_LEFT')),
      ctx.actors.onInvalidated(b => abort(b,'ACTOR_LOADING_OR_RESPAWN')));
    for (const hook of ['onDeath','onRespawn'] as const) this.stops.push(ctx.hooks.register(hook, actor => {
      for (const run of this.runs.values()) if (run.binding.actorRef.actorId === actor) abort(run.binding,hook === 'onDeath' ? 'ACTOR_DIED' : 'ACTOR_RESPAWN');
    }));
    const shutdown = () => { for (const run of this.runs.values()) abort(run.binding,'SHUTDOWN'); };
    ctx.signal.addEventListener('abort',shutdown,{once:true});
    this.stops.push(() => ctx.signal.removeEventListener('abort',shutdown));
  }
  active(key: string) { return this.runs.has(key); }
  async idle(key: string) { await this.tasks.get(key); }
  private log(message: string) { this.options.context.log.info('[classes] DEV sweep ' + message); }
  private check(run: Run) {
    if (run.controller.signal.aborted) throw Error(run.reason ?? 'ABORTED');
    if (!this.options.context.canMutate(run.binding)) throw Error('STALE_BINDING');
  }
  private async deliver(run: Run, classId: string) {
    const ctx = this.options.context, binding = run.binding;
    this.check(run);
    const received: {ack:GrantProjectionAck; items:readonly ProjectionItem[]}[] = [];
    let notify = () => {};
    const stop = ctx.projection.onAck(ack => {
      if (ack.binding.characterKey !== binding.characterKey || ack.binding.epoch !== binding.epoch) return;
      received.push({ack,items:ctx.projection.perkStatus(binding).items}); notify();
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectWait: ((error: Error) => void) | undefined;
    const cancelled = () => rejectWait?.(Error(run.reason ?? 'ABORTED'));
    try {
      const set = await ctx.composition.inspect(binding); this.check(run);
      const wanted = new Set(set.grants.filter(g => g.kind === 'perk' && g.source.kind === 'CLASS' && g.source.key === classId)
        .map(g => g.definition.stableFormKey));
      const result = await ctx.composition.recompose(binding,true); this.check(run);
      if (result.status !== 'SUPPORTED' || ['FAILED','REJECTED','PENDING'].includes(result.value.state)) throw Error('PROJECTION_UNAVAILABLE');
      const revision = result.value.revision;
      this.check(run);
      const report = await new Promise<typeof received[number]>((resolve,reject) => {
        rejectWait = reject;
        notify = () => { const match = received.find(r => sameRevision(r.ack.revision,revision)); if (match) resolve(match); };
        run.controller.signal.addEventListener('abort',cancelled,{once:true});
        timer = setTimeout(() => reject(Error('ACK_TIMEOUT')),this.options.timeoutMs ?? PERK_ACK_TIMEOUT_MS);
        notify(); if (run.controller.signal.aborted) cancelled();
      });
      this.check(run);
      const items = report.items, count = (status: string) => items.filter(i => i.status === status).length;
      const ensure = items.filter(i => wanted.has(i.definition.stableFormKey) && ['APPLIED_CLIENT','ALREADY_PRESENT'].includes(i.status));
      const applied = ensure.filter(i => i.status === 'APPLIED_CLIENT').length, alreadyPresent = ensure.filter(i => i.status === 'ALREADY_PRESENT').length;
      const unresolved = count('UNSUPPORTED'), failed = count('FAILED'), removed = count('REMOVED_CLIENT'), alreadyAbsent = count('ALREADY_ABSENT');
      const ok = report.ack.status === 'applied' && unresolved === 0 && failed === 0 && applied + alreadyPresent === wanted.size;
      const reason = unresolved ? 'UNRESOLVED' : failed ? 'FAILED_ITEMS' : applied + alreadyPresent !== wanted.size ? 'EXPECTED_COUNT_MISMATCH' : 'DELIVERY_PARTIAL';
      this.log(run.step + ' ' + classId + ': expected=' + wanted.size + '; applied=' + applied + '; alreadyPresent=' + alreadyPresent
        + '; unresolved=' + unresolved + '; failed=' + failed + '; removed=' + removed + '; alreadyAbsent=' + alreadyAbsent + '; result=' + (ok ? 'OK' : 'FAIL(' + reason + ')'));
      return ok;
    } finally { stop(); clearTimeout(timer); run.controller.signal.removeEventListener('abort',cancelled); }
  }
  private async execute(run: Run) {
    const {binding} = run;
    let original: string | undefined, changed = false, ok = 0, fail = 0, restored = 'NONE', restorationDelivery = 'NOT_SENT';
    try {
      this.check(run); original = await this.options.readOriginal(binding); this.check(run);
      // No classes.unset command exists. Never invent one or write domain SQL.
      if (!original) throw Error('ORIGINAL_CLASS_REQUIRED');
      const ids = [...this.options.data.classes ?? []].map(c => c.id).sort();
      for (let i = 0; i < ids.length; i++) {
        run.step = (i+1) + '/' + ids.length;
        this.check(run); changed = true;
        await this.options.change(binding,ids[i]!,randomUUID(),false); this.check(run);
        if (await this.deliver(run,ids[i]!)) ok++; else fail++;
      }
    } catch (error) {
      run.reason ??= (error as Error).message;
      this.log('ABORTED step=' + run.step + '; reason=' + run.reason);
    } finally {
      if (original && changed) {
        try {
          // Restoration deliberately does not require a live actor/epoch.
          await this.options.change(binding,original,randomUUID(),true); restored = original;
          if ((!run.reason || run.reason === 'ACK_TIMEOUT') && this.options.context.canMutate(binding)) {
            const restoration: Run = {binding,step:'restore',controller:new AbortController()};
            // The live run now points at the restoration wait, so disconnects
            // during its ACK cannot leave a hanging wait or start a new sweep.
            this.runs.set(binding.characterKey,restoration);
            try { restorationDelivery = await this.deliver(restoration,original) ? 'CONFIRMED' : 'FAIL'; }
            catch (error) { restorationDelivery = (error as Error).message; this.log('ABORTED step=restore; reason=' + restorationDelivery); }
          }
        } catch { restored = 'FAILED'; this.log('ERROR RESTORE_FAILED; original=' + original + '; staff must retry classes.set'); }
      } else if (original) restored = original;
      this.runs.delete(binding.characterKey);
      this.log('done: ok=' + ok + ' fail=' + fail + '; restored=' + restored + '; delivery=' + restorationDelivery);
    }
  }
  async shutdown() {
    for (const stop of this.stops.splice(0)) stop();
    for (const run of this.runs.values()) { run.reason ??= 'SHUTDOWN'; run.controller.abort(); }
    await Promise.allSettled([...this.tasks.values()]);
  }
}
