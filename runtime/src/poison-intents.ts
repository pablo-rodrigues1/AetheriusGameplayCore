import { ClientDelivery, exact, token, type DeliveryCycle } from './client-delivery.ts';
import type { RuntimeMp } from './host.ts';

const formId = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0 && (n as number) <= 0xffffffff;
/** Use path only, never hit/tick. Native host owns consumption and charges.
 * Idempotency is bounded to the authenticated session/cycle, not a new ledger.
 * Runtime ids are ephemeral evidence checked against the host's held weapon. */
export class PoisonIntents {
  private requests = new WeakMap<DeliveryCycle, Map<string, { content: string; result: number }>>();
  constructor(private mp: RuntimeMp, private channel: ClientDelivery, private warn: (s: string) => void) {
    channel.onWeaponPoison((cycle, p) => this.receive(cycle, p));
  }
  private receive(cycle: DeliveryCycle, p: Record<string, unknown>) {
    if (!exact(p, ['channel','v','session','type','cycle','challenge','id','weaponId','poisonId','hand'])
      || !token(p.id) || !formId(p.weaponId) || !formId(p.poisonId) || !['left','right'].includes(p.hand as string)
      || this.channel.current(cycle.binding) !== cycle || !this.mp.aetheriusOfficialIdentity
      || this.mp.getServerSettings().aetheriusCombat?.weaponPoison !== true || !this.mp.set) return;
    let requests = this.requests.get(cycle);
    if (!requests) { requests = new Map(); this.requests.set(cycle, requests); }
    const content = JSON.stringify([p.weaponId, p.poisonId, p.hand]);
    const old = requests.get(p.id);
    if (old) {
      // A retry reports the current native snapshot, never stale pre-hit charges.
      if (old.content === content) this.reply(cycle, p.id, old.result);
      return;
    }
    if (requests.size >= 256) {
      this.warn('weapon poison UNSUPPORTED: request limit reached for this delivery session');
      this.reply(cycle, p.id, 0); return;
    }
    // Reserve before invoking host; an exception cannot cause double consumption.
    requests.set(p.id, { content, result: 0 });
    try {
      const actor = cycle.binding.actorRef.actorId;
      this.mp.set(actor, 'aetheriusWeaponPoisonIntent', { weaponId: p.weaponId, poisonId: p.poisonId, hand: p.hand });
      const status = this.mp.get(actor, 'aetheriusPoisonStatus') as { result: number };
      if (!Number.isSafeInteger(status?.result)) throw Error('NATIVE_STATUS_UNAVAILABLE');
      requests.set(p.id, { content, result: status.result });
      this.reply(cycle, p.id, status.result);
    } catch { this.warn('weapon poison UNSUPPORTED: native intent/status unavailable'); this.reply(cycle, p.id, 0); }
  }
  private reply(cycle: DeliveryCycle, id: string, result: number) {
    if (this.channel.current(cycle.binding) !== cycle) return;
    try {
      const inventory = this.mp.get(cycle.binding.actorRef.actorId, 'inventory');
      if (!this.channel.send(cycle, { type: 'weaponPoisonResult', cycle: cycle.cycle, challenge: cycle.challenge, id, result, inventory }))
        this.warn('weapon poison UNSUPPORTED: reply unavailable or inventory exceeds packet limit');
    } catch { this.warn('weapon poison UNSUPPORTED: inventory snapshot unavailable'); }
  }
}
