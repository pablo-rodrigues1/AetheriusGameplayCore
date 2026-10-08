import { randomUUID } from 'node:crypto';
import type { ActorRef, CharacterKey, ProfileKey, SessionBinding, SessionEpoch } from '../../shared/contracts/src/identity.js';
import type { IdentityPort } from '../../shared/contracts/src/ports.js';
import type { RuntimeMp } from './host.js';
import { Scope } from './scope.js';

export interface ActorReady { readonly binding: SessionBinding; readonly signal: 'ONLINE_DELAY_APPROXIMATION'; readonly certified: false }
// ScampServer::On exposes no removeListener. One permanent bridge per native host,
// holding only current subscribers, survives require-cache eviction without leaks.
const bridgeKey = Symbol.for('aetherius.runtime.disconnect-bridges.v1');
const shared = process as unknown as Record<symbol, WeakMap<RuntimeMp, Set<(user: number) => void>>>;
const bridges = shared[bridgeKey] ??= new WeakMap();

export class Actors implements IdentityPort {
  private bindings = new Map<number, SessionBinding>();
  private users = new Map<number, number>();
  private ready = new Set<(event: ActorReady) => void>();
  private unbound = new Set<(binding: SessionBinding) => void>();
  private pending = new Map<number, () => void>();
  readonly limitations: readonly string[];
  constructor(private mp: RuntimeMp | undefined, private scope: Scope, private allowOffline: boolean,
    private warn: (s: string) => void, private readyDelay = 3000) {
    this.limitations = Object.freeze(['ONLINE_DELAY_APPROXIMATION: no client load ACK', 'readiness is not proof of projection delivery']);
  }
  start(): void {
    const mp = this.mp;
    if (mp?.on && mp.getUserByActor) {
      let subscribers = bridges.get(mp);
      if (!subscribers) {
        subscribers = new Set(); bridges.set(mp, subscribers);
        const targets = subscribers;
        mp.on('disconnect', user => { for (const fn of [...targets]) fn(user); });
      }
      const listener = (user: number) => { for (const [actor, linkedUser] of this.users) if (linkedUser === user) this.unbind(actor); };
      subscribers.add(listener); this.scope.add(() => subscribers!.delete(listener));
    } else this.warn('disconnect bridge unavailable: session changes detected only by online snapshot');
    this.scope.add(() => { for (const actor of [...this.bindings.keys()]) this.unbind(actor); this.ready.clear(); this.unbound.clear(); });
    this.poll(); this.scope.interval(() => this.poll(), 250);
  }
  private online(): number[] {
    try { const ids = this.mp?.get(0, 'onlinePlayers'); return Array.isArray(ids) ? ids.filter(id => Number.isSafeInteger(id) && id > 0) : []; }
    catch { return []; }
  }
  private profile(actor: number): number | undefined {
    try {
      // Fail closed when authentication context is absent or explicitly offline.
      if (this.mp?.getServerSettings().offlineMode !== false && !this.allowOffline) return undefined;
      const id = this.mp?.get(actor, 'profileId');
      return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : undefined;
    } catch { return undefined; }
  }
  poll(): void {
    const online = new Set(this.online());
    for (const actor of [...this.bindings.keys()]) if (!online.has(actor) || this.profile(actor) !== Number(this.bindings.get(actor)!.profileKey.slice(8))) this.unbind(actor);
    for (const actor of online) {
      const profile = this.profile(actor);
      if (!profile || this.bindings.has(actor)) continue;
      const binding: SessionBinding = Object.freeze({ profileKey: `profile:${profile}` as ProfileKey,
        characterKey: `profile:${profile}` as CharacterKey, actorRef: Object.freeze({ actorId: actor as ActorRef['actorId'] }), epoch: randomUUID() as SessionEpoch });
      this.bindings.set(actor, binding);
      try { const user = this.mp?.getUserByActor?.(actor); if (user !== undefined) this.users.set(actor, user); } catch { /* poll remains available */ }
      this.pending.set(actor, this.scope.timeout(() => {
        this.pending.delete(actor);
        if (this.isCurrent(binding)) for (const fn of [...this.ready]) {
          try { fn(Object.freeze({ binding, signal: 'ONLINE_DELAY_APPROXIMATION', certified: false })); }
          catch { this.warn('actor-ready subscriber failed'); }
        }
      }, this.readyDelay));
    }
  }
  private unbind(actor: number): void {
    const binding = this.bindings.get(actor);
    this.pending.get(actor)?.(); this.pending.delete(actor); this.users.delete(actor); this.bindings.delete(actor);
    if (binding) for (const fn of [...this.unbound]) { try { fn(binding); } catch { this.warn('actor-unbound subscriber failed'); } }
  }
  lookup(actor: ActorRef) {
    const binding = this.bindings.get(actor.actorId);
    return binding && this.isCurrent(binding) ? { status: 'SUPPORTED' as const, value: binding }
      : { status: 'UNSUPPORTED' as const, reason: 'No live authenticated profile binding (offline requires explicit development opt-in)' };
  }
  isCurrent(binding: SessionBinding): boolean {
    return this.bindings.get(binding.actorRef.actorId) === binding && this.online().includes(binding.actorRef.actorId)
      && this.profile(binding.actorRef.actorId) === Number(binding.profileKey.slice(8));
  }
  onReady(fn: (event: ActorReady) => void): () => void { this.ready.add(fn); return this.scope.add(() => this.ready.delete(fn)); }
  onUnbound(fn: (binding: SessionBinding) => void): () => void { this.unbound.add(fn); return this.scope.add(() => this.unbound.delete(fn)); }
}
