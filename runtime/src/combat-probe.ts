import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import type { SessionBinding } from '../../shared/contracts/src/index.ts';
import type { RuntimeMp } from './host.ts';
import { requireDevelopmentOption, type CoreEnvironment } from './development.ts';
import type { Scope } from './scope.ts';

/** DS-0b: development-only combat probe recorder. It never writes to the host,
 * never runs on the hit path and only reads mp.getAetheriusCombatProbe(), which
 * the host registers only with aetheriusCombat.probe=true (server-settings.json).
 *
 * Retention (DS-0b-fix1): at most ONE append is in flight. While it is pending,
 * polls collect nothing (they are counted) and the host's fixed rings are the
 * retention for new events; the Core retains at most one collected batch. Checkpoints (sequences, counters, equipment state, writer
 * statistics) advance only after the append is confirmed; a failed, bounded batch is
 * retained unchanged and retried before any new collection. Rows the host overwrote in the
 * meantime become explicit `gap` lines whose reason says why they were lost. */
export type CombatProbeConfig = Readonly<{ file: string }>;
export const COMBAT_PROBE_INTERVAL_MS = 2000;

export function developmentCombatProbe(env: CoreEnvironment): CombatProbeConfig | undefined {
  const value = env.GAMEPLAY_CORE_DEV_COMBAT_PROBE;
  if (value === undefined) return undefined;
  requireDevelopmentOption(env, 'GAMEPLAY_CORE_DEV_COMBAT_PROBE');
  if (value !== 'true' && value !== 'false')
    throw Object.assign(Error('GAMEPLAY_CORE_DEV_COMBAT_PROBE must be true or false'), { code: 'DEV_COMBAT_PROBE_INVALID' });
  if (value !== 'true') return undefined;
  const file = env.GAMEPLAY_CORE_DEV_COMBAT_PROBE_FILE;
  if (!file || file.trim() !== file || !path.isAbsolute(file))
    throw Object.assign(Error('GAMEPLAY_CORE_DEV_COMBAT_PROBE refused: GAMEPLAY_CORE_DEV_COMBAT_PROBE_FILE must be an absolute path'),
      { code: 'DEV_COMBAT_PROBE_FILE_REQUIRED' });
  return Object.freeze({ file });
}

// No argument: the buffers snapshot. Numeric argument: read-only enchantment resolution.
type ProbeMp = RuntimeMp & { getAetheriusCombatProbe?: (request?: number | { recordType: number }) => unknown };
type Row = Record<string, unknown> & { sequence: number };
type Buffer = 'hits' | 'animations' | 'health' | 'equipment' | 'rejections';
const buffers: readonly Buffer[] = ['hits', 'animations', 'health', 'equipment', 'rejections'];
const kinds: Record<Exclude<Buffer, 'equipment'>, string> = { hits: 'hit', animations: 'animation', health: 'health', rejections: 'rejection' };
const maxDescriptors = 4096;
/** Upper bound of one batch: the host rings (1024 + 4096 + 1024 + 256 + 1024 rows),
 * one state line per tracked character and a few control lines. */
export const COMBAT_PROBE_MAX_IN_FLIGHT_BATCHES = 1;

export interface CombatProbeRecorderOptions {
  readonly mp: RuntimeMp | undefined;
  readonly file: string;
  readonly scope: Pick<Scope, 'interval' | 'add'>;
  readonly warn: (message: string) => void;
  readonly append?: (file: string, text: string) => Promise<void>;
  readonly now?: () => number;
}

interface Checkpoint {
  readonly started: boolean;
  readonly last: Readonly<Record<Buffer, number>>;
  readonly startedAtMs: unknown;
  readonly counters: string;
  readonly equipment: ReadonlyMap<string, string>;
  readonly writer: string;
}
interface PendingBatch {
  readonly text: string;
  readonly checkpoint: Checkpoint;
  readonly lostRows: Record<string, number>;
  readonly skippedAtBuild: number;
  readonly failuresAtBuild: number;
}
interface WriterStats {
  writeFailures: number; pollsSkippedWhileWriting: number; batches: number;
  lostRows: Record<string, number>; lastError: string | null;
}

export class CombatProbeRecorder {
  private committed: Checkpoint = { started: false, last: { hits: 0, animations: 0, health: 0, equipment: 0, rejections: 0 },
    startedAtMs: undefined, counters: '', equipment: new Map(), writer: '' };
  private inFlight: Promise<void> | undefined;
  private failing = false;
  private pendingBatch: PendingBatch | undefined;
  private confirmedReadFailures = 0;
  private skippedSinceCommit = 0;
  private readonly stats: WriterStats = { writeFailures: 0, pollsSkippedWhileWriting: 0, batches: 0, lostRows: {}, lastError: null };
  private readonly tracked = new Map<number, SessionBinding>();
  private readonly enchantments = new Map<number, Record<string, unknown>>();
  private readonly recordTypes = new Map<number, string | null>();
  private readonly descriptors = new Map<number, string | null>();
  private readonly warned = new Set<string>();
  private active = false;
  private readonly append: (file: string, text: string) => Promise<void>;
  private readonly now: () => number;
  constructor(private readonly options: CombatProbeRecorderOptions) {
    this.append = options.append ?? ((file, text) => appendFile(file, text, 'utf8'));
    this.now = options.now ?? Date.now;
  }

  /** Returns false (UNSUPPORTED, logged once) when the host function is absent. */
  start(): boolean {
    const mp = this.options.mp as ProbeMp | undefined;
    if (typeof mp?.getAetheriusCombatProbe !== 'function') {
      this.warnOnce('absent', 'DEV combat probe UNSUPPORTED: mp.getAetheriusCombatProbe is absent ' +
        '(aetheriusCombat.probe=true missing in server-settings.json, or host build without DS-0b); nothing will be recorded');
      return false;
    }
    this.active = true;
    this.options.scope.interval(() => this.poll(), COMBAT_PROBE_INTERVAL_MS);
    this.poll();
    return true;
  }

  /** Builds one batch from the committed checkpoint and starts its append.
   * Never runs while another append is pending (bounded retention). */
  poll(): void {
    if (!this.active) return;
    if (this.inFlight) { this.stats.pollsSkippedWhileWriting++; this.skippedSinceCommit++; return; }
    if (this.pendingBatch) { this.writeBatch(this.pendingBatch); return; }
    let snapshot: Record<string, unknown>;
    try {
      snapshot = JSON.parse(String((this.options.mp as ProbeMp).getAetheriusCombatProbe!())) as Record<string, unknown>;
      if (!snapshot || typeof snapshot !== 'object') throw Error('not an object');
    } catch (error) {
      this.warnOnce('read', `DEV combat probe read failed: ${(error as Error).message}`);
      return;
    }
    const base = this.committed, lines: Record<string, unknown>[] = [];
    const last = { ...base.last };
    const lostThisBatch: Record<string, number> = {};
    if (!base.started) lines.push({ kind: 'start', timeMs: this.now(), intervalMs: COMBAT_PROBE_INTERVAL_MS, note: 'DEVELOPMENT ONLY' });
    if (base.startedAtMs !== undefined && snapshot.startedAtMs !== base.startedAtMs) {
      lines.push({ kind: 'reset', timeMs: this.now(), previousStartedAtMs: base.startedAtMs, startedAtMs: snapshot.startedAtMs });
      for (const buffer of buffers) last[buffer] = 0;
    }
    const reason = this.stats.writeFailures > this.confirmedReadFailures ? 'WRITE_FAILURE_RING_OVERWRITTEN'
      : this.skippedSinceCommit ? 'WRITE_BACKPRESSURE_RING_OVERWRITTEN' : 'HOST_RING_OVERWRITTEN';
    for (const buffer of buffers) {
      const rows = Array.isArray(snapshot[buffer]) ? snapshot[buffer] as Row[] : [];
      const fresh = rows.filter(row => Number.isSafeInteger(row?.sequence) && row.sequence > last[buffer])
        .sort((a, b) => a.sequence - b.sequence);
      if (!fresh.length) continue;
      if (fresh[0]!.sequence > last[buffer] + 1) {
        const lost = fresh[0]!.sequence - last[buffer] - 1;
        lostThisBatch[reason] = (lostThisBatch[reason] ?? 0) + lost;
        lines.push({ kind: 'gap', buffer, from: last[buffer] + 1, to: fresh[0]!.sequence - 1, lost, reason });
      }
      for (const row of fresh) lines.push(buffer === 'equipment' ? this.transition(row) : { kind: kinds[buffer], ...row, ...this.describe(buffer, row) });
      last[buffer] = fresh.at(-1)!.sequence;
    }
    let counters = base.counters;
    const currentCounters = JSON.stringify(snapshot.counters ?? null);
    if (currentCounters !== base.counters) {
      counters = currentCounters;
      lines.push({ kind: 'counters', timeMs: this.now(), counters: snapshot.counters ?? null, animationNames: snapshot.animationNames ?? [] });
    }
    const equipment = new Map<string, string>();
    for (const binding of this.tracked.values()) {
      const key = `${binding.characterKey}|${binding.epoch}|${binding.actorRef.actorId}`;
      const captured = this.captureState(binding, base.equipment.get(key));
      equipment.set(key, captured.state);
      if (captured.line) lines.push(captured.line);
    }
    const lostRows = { ...this.stats.lostRows };
    for (const [k, v] of Object.entries(lostThisBatch)) lostRows[k] = (lostRows[k] ?? 0) + v;
    const writerView = { writeFailures: this.stats.writeFailures, pollsSkippedWhileWriting: this.stats.pollsSkippedWhileWriting, lostRows,
      lastError: this.stats.lastError, maxInFlightBatches: COMBAT_PROBE_MAX_IN_FLIGHT_BATCHES };
    const writer = JSON.stringify(writerView);
    if (writer !== base.writer) lines.push({ kind: 'writer', timeMs: this.now(), recovered: this.stats.writeFailures > this.confirmedReadFailures, ...writerView });
    if (!lines.length) return;
    const next: Checkpoint = { started: true, last, startedAtMs: snapshot.startedAtMs, counters, equipment, writer };
    // Polls skipped while THIS batch is in flight stay attributed to the next read.
    const skippedAtBuild = this.skippedSinceCommit;
    const text = lines.map(line => JSON.stringify(line)).join('\n') + '\n';
    this.pendingBatch = { text, checkpoint: next, lostRows, skippedAtBuild, failuresAtBuild: this.stats.writeFailures };
    this.writeBatch(this.pendingBatch);
  }

  /** One bounded batch, including state polls, survives any failed append.
   * The async wrapper also captures synchronous writer errors. */
  private writeBatch(batch: PendingBatch): void {
    const append = async () => this.append(this.options.file, batch.text);
    this.inFlight = append().then(() => {
      this.committed = batch.checkpoint; this.stats.lostRows = batch.lostRows; this.stats.batches++;
      this.confirmedReadFailures = batch.failuresAtBuild;
      if (this.failing) this.options.warn(`DEV combat probe write recovered after ${this.stats.writeFailures} failure(s); retained batch confirmed, subsequent losses recorded as gap lines`);
      this.failing = false; this.skippedSinceCommit -= batch.skippedAtBuild;
      this.pendingBatch = undefined;
    }, error => {
      this.stats.writeFailures++; this.stats.lastError = String((error as Error)?.message ?? error);
      if (!this.failing) this.options.warn(`DEV combat probe write failed: ${this.stats.lastError}; bounded batch retained for retry`);
      this.failing = true;
    }).finally(() => { this.inFlight = undefined; });
  }

  /** Connected character: its equipment state is captured on the next poll and
   * whenever the polled state differs (covers changes the host makes outside
   * OnUpdateEquipment). Every accepted OnUpdateEquipment transition also arrives
   * through the host's equipment ring, independently of polling. */
  track(binding: SessionBinding): void {
    if (!this.active) return;
    this.tracked.set(binding.actorRef.actorId, binding);
  }

  untrack(binding: SessionBinding): void {
    if (this.tracked.get(binding.actorRef.actorId)?.epoch !== binding.epoch) return;
    this.tracked.delete(binding.actorRef.actorId);
  }

  /** Shutdown retries a retained failed batch once, then collects once more if it succeeded. */
  async shutdown(): Promise<void> {
    if (!this.active) { await this.inFlight; return; }
    await this.inFlight;
    this.poll();
    await this.inFlight;
    if (!this.pendingBatch) { this.poll(); await this.inFlight; }
    this.active = false;
  }

  /** Resolves when the current append (if any) has settled. */
  async flush(): Promise<void> { await this.inFlight; }

  /** Diagnostics for tests: never more than one pending append. */
  get pendingWrites(): number { return this.inFlight ? 1 : 0; }

  private characterOf(actorId: unknown): string | null {
    return typeof actorId === 'number' ? this.tracked.get(actorId)?.characterKey ?? null : null;
  }

  /** Type lookup is requested only here, outside the hit, with bounded cache. */
  private hand(id: unknown, wornHand: string): string {
    if (typeof id !== 'number') return 'UNAVAILABLE';
    if (!this.recordTypes.has(id)) {
      let type: string | null = null;
      try {
        const answer = JSON.parse(String((this.options.mp as ProbeMp).getAetheriusCombatProbe!({ recordType: id })));
        if (answer.status === 'SUPPORTED' && typeof answer.type === 'string') type = answer.type;
      } catch { /* unsupported is explicit; never guess a hand */ }
      if (this.recordTypes.size < maxDescriptors) this.recordTypes.set(id, type);
      else return 'UNAVAILABLE';
    }
    const type = this.recordTypes.get(id);
    return type === 'WEAP' || type === 'SPEL' ? wornHand : type ? 'NONE' : 'UNAVAILABLE';
  }

  private actorState(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value ?? null;
    const state = value as Record<string, unknown>;
    const chain = Array.isArray(state.templateChain) ? state.templateChain : [];
    return { ...state, lastAttemptCellDesc: this.descriptor(state.lastAttemptCellOrWorld), baseDesc: this.descriptor(state.base), hosterDesc: this.descriptor(state.hoster),
      resolvedNpcDesc: state.truncatedTemplates || chain.some(key => typeof key !== 'string') ? null : chain.length ? chain.at(-1) : this.descriptor(state.base) };
  }

  private item(entry: Record<string, unknown>, hand: string) {
    const enchantmentId = entry.enchantmentId ?? null;
    return { baseId: entry.baseId, baseDesc: this.descriptor(entry.baseId), count: entry.count, hand: this.hand(entry.baseId, hand), worn: true,
      health: entry.health ?? null,
      enchantmentId, enchantmentDesc: this.descriptor(enchantmentId),
      enchantment: enchantmentId === null ? null : this.enchantment(enchantmentId),
      poisonId: entry.poisonId ?? null, poisonDesc: this.descriptor(entry.poisonId), poisonCount: entry.poisonCount ?? null };
  }

  /** One accepted host transition (C++ equipment ring), ENCH resolved here, off the hit. */
  private transition(row: Row): Record<string, unknown> {
    const items = Array.isArray(row.items) ? row.items as Record<string, unknown>[] : [];
    return { kind: 'equipment', source: 'HOST_TRANSITION', change: 'TRANSITION', sequence: row.sequence, timeMs: row.timeMs,
      characterKey: this.characterOf(row.actor), actorId: row.actor, actorDesc: this.descriptor(row.actor), numChanges: row.numChanges,
      totalEntries: row.totalEntries, truncatedEntries: Math.max(0, Number(row.totalEntries ?? 0) - items.length),
      spells: { left: row.leftSpell, right: row.rightSpell, voice: row.voiceSpell, instant: row.instantSpell },
      equipped: items.filter(i => i.worn === true || i.hand === 'RIGHT' || i.hand === 'LEFT').map(i => this.item(i, String(i.wornSlot ?? i.hand))) };
  }

  /** Polled state; returns the line only when it differs from the committed state. */
  private captureState(binding: SessionBinding, previous: string | undefined): { state: string; line?: Record<string, unknown> } {
    const actorId = binding.actorRef.actorId;
    let equipment: unknown, state: string;
    try { equipment = this.options.mp!.get(actorId, 'equipment'); state = JSON.stringify(equipment ?? null); }
    catch (error) {
      const reason = (error as Error).message; state = `error:${reason}`;
      return state === previous ? { state } : { state, line: { kind: 'equipment', source: 'STATE_POLL', timeMs: this.now(),
        characterKey: binding.characterKey, actorId, status: 'UNSUPPORTED', reason } };
    }
    if (state === previous) return { state };
    const entries = ((equipment as { inv?: { entries?: unknown[] } } | null)?.inv?.entries ?? []) as Record<string, unknown>[];
    const worn = entries.filter(entry => entry.worn === true || entry.wornLeft === true)
      .map(entry => this.item(entry, entry.wornLeft === true ? 'LEFT' : 'RIGHT'));
    return { state, line: { kind: 'equipment', source: 'STATE_POLL', timeMs: this.now(), change: previous === undefined ? 'INITIAL' : 'CHANGED',
      characterKey: binding.characterKey, actorId, equipped: worn, equipment } };
  }

  /** Read-only resolution by the host probe (load-order winners). The ID being
   * present is not support: SUPPORTED only with the resolved MGEF list. */
  private enchantment(id: unknown): Record<string, unknown> {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)
      return { status: 'UNSUPPORTED', reason: 'INVALID_ENCHANTMENT_ID', enchantmentId: id ?? null };
    const cached = this.enchantments.get(id);
    if (cached) return cached;
    let result: Record<string, unknown>;
    try {
      const parsed = JSON.parse(String((this.options.mp as ProbeMp).getAetheriusCombatProbe!(id))) as Record<string, unknown>;
      result = parsed && (parsed.status === 'SUPPORTED' || parsed.status === 'UNSUPPORTED') ? parsed
        : { status: 'UNSUPPORTED', reason: 'HOST_RESOLUTION_UNRECOGNIZED', enchantmentId: id };
    } catch (error) {
      result = { status: 'UNSUPPORTED', reason: `HOST_RESOLUTION_FAILED: ${(error as Error).message}`, enchantmentId: id };
    }
    if (this.enchantments.size < maxDescriptors) this.enchantments.set(id, result);
    return result;
  }

  private describe(buffer: Buffer, row: Row): Record<string, unknown> {
    if (buffer === 'hits' || buffer === 'rejections') return { sourceDesc: this.descriptor(row.source), aggressorDesc: this.descriptor(row.aggressor),
      targetDesc: this.descriptor(row.target), aggressorState: this.actorState(row.aggressorState), targetState: this.actorState(row.targetState) };
    return { actorDesc: this.descriptor(row.actor) };
  }

  /** Stable descriptor for the evidence file; never persisted as identity. */
  private descriptor(id: unknown): string | null {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
    if (this.descriptors.has(id)) return this.descriptors.get(id)!;
    let desc: string | null = null;
    try { const value = this.options.mp!.getDescFromId(id); desc = typeof value === 'string' && value ? value : null; }
    catch { desc = null; }
    if (this.descriptors.size < maxDescriptors) this.descriptors.set(id, desc);
    return desc;
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key); this.options.warn(message);
  }
}
