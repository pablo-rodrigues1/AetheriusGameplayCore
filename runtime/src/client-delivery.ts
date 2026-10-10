import { randomUUID } from 'node:crypto';
import type { SessionBinding, ActorRef } from '../../shared/contracts/src/identity.js';
import type { Actors } from './actors.js';
import type { RuntimeMp } from './host.js';
import { Scope, Hooks } from './scope.js';

export const CHANNEL = 'aetherius.gameplay.grants';
export const MAX_PACKET = 65536;
export const MAX_ITEMS = 512;
export const token = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(s);
export function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}
export interface DeliveryCycle { binding: SessionBinding; user: number; session: string; cycle?: string; challenge?: string; ready: boolean; seen: Set<string>; starts: number[] }
type Packet = Record<string, unknown>;
const bridgeKey = Symbol.for('aetherius.runtime.custom-packet-bridge.v1');
const shared = process as unknown as Record<symbol, WeakMap<RuntimeMp, Set<(user: number, raw: string) => void>>>;
const bridges = shared[bridgeKey] ??= new WeakMap();

/** Real transport: ScampServerListener.cpp emits (userId, minified JSON string).
 * One permanent native listener, disposable subscribers, no persistent nonce. */
export class ClientDelivery {
  private cycles = new Map<number, DeliveryCycle>();
  private ackListeners = new Set<(cycle: DeliveryCycle, packet: Packet) => void>();
  private resets = new Set<(binding: SessionBinding) => void>();
  private intents = new Set<(cycle: DeliveryCycle, packet: Packet) => void>();
  constructor(private mp: RuntimeMp, private actors: Actors, private scope: Scope,
    private allowed: (binding: SessionBinding) => boolean, private warn: (s: string) => void) {}
  start(hooks: Hooks): void {
    let subscribers = bridges.get(this.mp);
    if (!subscribers) {
      subscribers = new Set(); bridges.set(this.mp, subscribers);
      const targets = subscribers;
      this.mp.on!('customPacket', (user: number, raw: string) => { for (const fn of [...targets]) fn(user, raw); });
    }
    const listener = (user: number, raw: string) => this.receive(user, raw);
    subscribers.add(listener); this.scope.add(() => subscribers!.delete(listener));
    this.actors.onBound(binding => this.bind(binding));
    this.actors.onUnbound(binding => { this.cycles.delete(binding.actorRef.actorId); this.reset(binding); });
    hooks.register('onRespawn', actor => {
      const live = this.actors.lookup({ actorId: actor as ActorRef['actorId'] });
      if (live.status === 'SUPPORTED') {
        this.actors.respawn(live.value);
        const previous = this.cycles.get(actor);
        if (previous) { previous.ready = false; delete previous.cycle; delete previous.challenge; this.reset(live.value); }
      }
    });
    this.scope.add(() => { this.cycles.clear(); this.ackListeners.clear(); this.resets.clear(); this.intents.clear(); });
  }
  private bind(binding: SessionBinding): void {
    if (!this.allowed(binding)) return;
    try {
      const user = this.mp.getUserByActor!(binding.actorRef.actorId);
      if (!Number.isSafeInteger(user) || user < 0 || this.mp.getUserActor!(user) !== binding.actorRef.actorId) return;
      const cycle: DeliveryCycle = { binding, user, session: randomUUID(), ready: false, seen: new Set(), starts: [] };
      this.cycles.set(binding.actorRef.actorId, cycle);
      this.send(cycle, { type: 'hello' });
    } catch { this.warn('client delivery: HELLO_SEND_FAILED'); }
  }
  current(binding: SessionBinding): DeliveryCycle | undefined {
    const state = this.cycles.get(binding.actorRef.actorId);
    try {
      return state && state.binding.epoch === binding.epoch && this.actors.isCurrent(binding) && this.allowed(binding)
        && this.mp.getUserActor!(state.user) === binding.actorRef.actorId && this.mp.getUserByActor!(binding.actorRef.actorId) === state.user ? state : undefined;
    } catch { return undefined; }
  }
  send(state: DeliveryCycle, packet: Packet): boolean {
    if (this.current(state.binding) !== state) return false;
    const raw = JSON.stringify({ channel: CHANNEL, v: 1, session: state.session, ...packet });
    if (Buffer.byteLength(raw, 'utf8') > MAX_PACKET) return false;
    try { this.mp.sendCustomPacket!(state.user, raw); return true; }
    catch { this.warn('client delivery: PACKET_SEND_FAILED'); return false; }
  }
  private receive(user: number, raw: string): void {
    if (!Number.isSafeInteger(user) || user < 0 || typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > MAX_PACKET) return;
    let p: Packet;
    try { p = JSON.parse(raw) as Packet; } catch { return; }
    if (!p || p.channel !== CHANNEL || p.v !== 1) return;
    let actor: number;
    try { actor = this.mp.getUserActor!(user); } catch { return; }
    const state = this.cycles.get(actor);
    if (!state || state.user !== user || this.current(state.binding) !== state || p.session !== state.session) return;
    if (p.type === 'begin') {
      if (!exact(p, ['channel', 'v', 'session', 'type', 'cycle']) || !token(p.cycle) || state.seen.has(p.cycle)) return;
      const now = performance.now(); state.starts = state.starts.filter(t => now - t < 10000);
      if (state.starts.length >= 4 || state.seen.size >= 256) return;
      state.starts.push(now); state.seen.add(p.cycle); state.cycle = p.cycle; state.challenge = randomUUID(); state.ready = false;
      this.reset(state.binding); this.actors.clientLoading(state.binding);
      this.send(state, { type: 'challenge', cycle: state.cycle, challenge: state.challenge });
    } else if (p.type === 'ready') {
      if (!exact(p, ['channel', 'v', 'session', 'type', 'cycle', 'challenge']) || state.ready || !state.challenge
        || p.cycle !== state.cycle || p.challenge !== state.challenge) return;
      state.ready = true; this.actors.clientReady(state.binding);
      if (this.mp.getServerSettings().aetheriusCombat?.weaponPoison === true)
        this.send(state, { type: 'weaponPoisonCapability', cycle: state.cycle, challenge: state.challenge, enabled: true });
    } else if (p.type === 'ack') {
      if (!state.ready || !state.challenge || p.cycle !== state.cycle || p.challenge !== state.challenge) return;
      for (const fn of [...this.ackListeners]) fn(state, p);
    } else if (p.type === 'weaponPoison') {
      if (!state.ready || !state.challenge || p.cycle !== state.cycle || p.challenge !== state.challenge) return;
      for (const fn of [...this.intents]) fn(state, p);
    }
  }
  private reset(binding: SessionBinding): void { for (const fn of [...this.resets]) fn(binding); }
  onReset(fn: (binding: SessionBinding) => void): () => void { this.resets.add(fn); return this.scope.add(() => this.resets.delete(fn)); }
  onAck(fn: (cycle: DeliveryCycle, packet: Packet) => void): () => void { this.ackListeners.add(fn); return this.scope.add(() => this.ackListeners.delete(fn)); }
  onWeaponPoison(fn: (cycle: DeliveryCycle, packet: Packet) => void): () => void { this.intents.add(fn); return this.scope.add(() => this.intents.delete(fn)); }
  capability() { return { status: 'SUPPORTED', protocol: `${CHANNEL}/1`, readiness: 'CLIENT_SPAWN_TASKS_COMPLETED', legacy: 'ONLINE_DELAY_APPROXIMATION', proof: ['runtime/tests/client-delivery.test.mjs'] }; }
}
