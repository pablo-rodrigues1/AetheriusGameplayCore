import { MsgType } from '../../messages';
import { logTrace } from '../../logging';
import { remoteIdToLocalId } from '../../view/worldViewMisc';
import { ClientListener, CombinedController, Sp } from './clientListener';
import { NetworkingService } from './networkingService';
import { RemoteServer } from './remoteServer';

type UnavailableReason = 'ACTOR_NOT_LOADED' | 'RESOLVED_BASE_ABSENT' |
  'RESOLVED_BASE_HAS_NO_STABLE_KEY' | 'RACE_ABSENT' | 'RACE_HAS_NO_STABLE_KEY' |
  'INVALID_ENGINE_LEVEL' | 'ENGINE_READ_FAILED';

/** DS-0g. Evidence only: no clone, base replacement or actor-value writes.
 * The host marks the eligible refs from winning records; chain length is never
 * used to infer an LVLN. Generation changes force a report even for same-base
 * respawns. Releasing a host or unloading a ref releases its deduplication. */
export class NpcObservationService extends ClientListener {
  private lastScan = 0;
  private sent = new Map<number, string>();
  private failures = new Map<number, { generation: number; reasons: Set<UnavailableReason> }>();
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    controller.on('update', () => this.update());
    const clear = () => { this.sent.clear(); this.failures.clear(); this.lastScan = 0; };
    controller.on('loadGame', clear);
    controller.emitter.on('connectionAccepted', clear);
    controller.emitter.on('connectionDisconnect', clear);
    controller.emitter.on('hostStopMessage', e => this.forget(e.message.target));
    controller.emitter.on('destroyActorMessage', () => { this.lastScan = 0; });
  }
  private forget(id: number) { this.sent.delete(id); this.failures.delete(id); }
  // HostStart uses an offset ID for placed actors (ActionListener::OnHostAttempt).
  // Only packet.actor uses the server FormID; lookups and dedup keep the hosted ID.
  private serverFormId(id: number): number {
    return id >= 0x100000000 ? id - 0x100000000 : id;
  }
  private unavailable(id: number, generation: number, reason: UnavailableReason) {
    this.sent.delete(id);
    let failure = this.failures.get(id);
    if (failure?.generation !== generation) {
      failure = { generation, reasons: new Set<UnavailableReason>() };
      this.failures.set(id, failure);
    }
    if (failure.reasons.has(reason)) return;
    logTrace(this, 'NPC observation UNSUPPORTED', id.toString(16), generation, reason);
    this.controller.emitter.emit('sendMessage', {
      message: { t: MsgType.CustomPacket, contentJsonDump: JSON.stringify({
        channel: 'aetherius.npc.observation.unavailable', v: 1, actor: this.serverFormId(id), generation, reason
      }) }, reliability: 'reliable'
    });
    failure.reasons.add(reason);
  }
  private stableBase(id: number): string | undefined {
    if (!Number.isInteger(id) || id <= 0) return;
    const fileSlot = Math.floor(id / 0x1000000);
    if (fileSlot === 0xff) return; // engine-created TESNPC has no persistent key
    const light = fileSlot === 0xfe;
    const plugin = light ? this.sp.Game.getLightModName(Math.floor(id / 0x1000) % 0x1000)
      : this.sp.Game.getModName(fileSlot);
    if (!plugin || !/^[^:/\\]+\.(esm|esp|esl)$/i.test(plugin)) return;
    const local = id % (light ? 0x1000 : 0x1000000);
    return local.toString(16).padStart(6, '0') + ':' + plugin;
  }
  private update() {
    const now = Date.now();
    if (now - this.lastScan < 500) return;
    this.lastScan = now;
    if (!this.controller.lookupListener(NetworkingService).isConnected()) return;
    const raw = this.sp.storage['hosted'];
    const hosted: number[] = Array.isArray(raw) ? raw : [];
    const current = new Set(hosted);
    for (const id of Array.from(this.sent.keys())) if (!current.has(id)) this.forget(id);
    for (const id of Array.from(this.failures.keys())) if (!current.has(id)) this.forget(id);
    const world = this.controller.lookupListener(RemoteServer).getWorldModel();
    for (const id of hosted) {
      const form = world.forms.find(f => f?.refrId === id);
      const marker = (form as unknown as { aetheriusNpcObservation?: { generation?: number } } | undefined)?.aetheriusNpcObservation;
      if (!Number.isSafeInteger(marker?.generation) || marker!.generation! < 1 || form?.isDead) { this.forget(id); continue; }
      try {
        const actor = this.sp.Actor.from(this.sp.Game.getFormEx(remoteIdToLocalId(id)));
        if (!actor || !actor.is3DLoaded()) { this.unavailable(id, marker!.generation!, 'ACTOR_NOT_LOADED'); continue; }
        const resolved = actor.getLeveledActorBase();
        if (!resolved) { this.unavailable(id, marker!.generation!, 'RESOLVED_BASE_ABSENT'); continue; }
        const base = this.stableBase(resolved.getFormID());
        let race: string | undefined;
        if (!base) {
          const effectiveRace = actor.getRace();
          if (!effectiveRace) { this.unavailable(id, marker!.generation!, 'RACE_ABSENT'); continue; }
          race = this.stableBase(effectiveRace.getFormID());
          if (!race) { this.unavailable(id, marker!.generation!, 'RACE_HAS_NO_STABLE_KEY'); continue; }
        }
        const level = actor.getLevel();
        if (!Number.isInteger(level) || level < 1 || level > 65535) { this.unavailable(id, marker!.generation!, 'INVALID_ENGINE_LEVEL'); continue; }
        const fingerprint = JSON.stringify([base ? 1 : 2, base ?? race, level, marker!.generation]);
        if (this.sent.get(id) === fingerprint) continue;
        this.controller.emitter.emit('sendMessage', {
          message: { t: MsgType.CustomPacket, contentJsonDump: JSON.stringify(base ? {
            channel: 'aetherius.npc.observation', v: 1, actor: this.serverFormId(id), base, level, generation: marker!.generation
          } : {
            channel: 'aetherius.npc.observation', v: 2, actor: this.serverFormId(id), race, level, generation: marker!.generation
          }) }, reliability: 'reliable'
        });
        this.sent.set(id, fingerprint);
      } catch { this.unavailable(id, marker!.generation!, 'ENGINE_READ_FAILED'); }
    }
  }
}
