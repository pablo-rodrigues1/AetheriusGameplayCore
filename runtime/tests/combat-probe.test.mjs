// DS-0b (+fix1): development-only combat probe recorder (Core side).
// Host shape: ScampServer.cpp registers mp.getAetheriusCombatProbe only with
// aetheriusCombat.probe=true; with no argument it returns CombatProbe::ReadString()
// (JSON string; "hits"/"animations"/"health"/"equipment" rings with per-buffer
// "sequence", "startedAtMs", "counters", "animationNames"); with a numeric argument
// it returns CombatProbe::ResolveEnchantment as a JSON string. Equipment ring rows
// are CombatProbe::RecordEquipment copies: {sequence,timeMs,actor,numChanges,
// left/right/voice/instantSpell,totalEntries,items:[{baseId,count,hand,health,
// enchantmentId,poisonId,poisonCount}]}. EquipmentBinding.cpp returns
// Equipment::ToJson() ({inv:{entries:[{baseId,count,worn,wornLeft,health,enchantmentId,poisonId,...}]}}).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fakeHost, logger, unavailablePg } from './host.mjs';
import { developmentEnv } from './development-env.mjs';

const compiled = await build({ stdin: { contents: "export {developmentCombatProbe,CombatProbeRecorder,COMBAT_PROBE_INTERVAL_MS} from './src/combat-probe.ts';",
  resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { developmentCombatProbe, CombatProbeRecorder, COMBAT_PROBE_INTERVAL_MS } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const { createGameplayCore } = createRequire(import.meta.url)('../../dist/aetherius-gameplay-core.cjs');
const file = path.join(tmpdir(), 'ds0b-never-written.jsonl');
const SUPPORTED = new Map([[77, 5], [88, 6]]);

/** Host ring model: same rows/sequence semantics as CombatProbe::Ring. */
function hostProbe(capacity = 4) {
  const rings = { hits: [], animations: [], health: [], equipment: [], rejections: [], npcReports: [], npcUnavailable: [] }, totals = { hits: 0, animations: 0, health: 0, equipment: 0, rejections: 0, npcReports: 0, npcUnavailable: 0 };
  let calls = 0; const enchantmentCalls = [];
  return {
    rings, totals, enchantmentCalls, get calls() { return calls; },
    push(buffer, row) { const sequence = ++totals[buffer]; rings[buffer].push({ sequence, timeMs: 1000 + sequence, ...row }); if (rings[buffer].length > capacity) rings[buffer].shift(); },
    fn(id) {
      if (id && typeof id === 'object') return JSON.stringify({ status: 'SUPPORTED', type: id.recordType === 200 ? 'ARMO' : 'WEAP' });
      if (id !== undefined) { enchantmentCalls.push(id);
        return JSON.stringify(SUPPORTED.has(id) ? { enchantmentId: id, status: 'SUPPORTED', effects: [{ mgef: SUPPORTED.get(id), magnitude: 10, actorValue: 24 }] }
          : { enchantmentId: id, status: 'UNSUPPORTED', reason: 'CREATED_RECORD_NOT_IN_LOAD_ORDER' }); }
      calls++;
      return JSON.stringify({ startedAtMs: 1, counters: { ...totals }, animationNames: [], ...rings });
    }
  };
}
/** append modes: 'ok' resolves, 'fail' rejects once per call, 'hold' stays pending until release(). */
function harness({ withFunction = true, equipment = { value: null } } = {}) {
  const probe = hostProbe(), lines = [], warnings = [], intervals = [];
  const writer = { mode: 'ok', calls: 0, held: [] };
  const mp = { getDescFromId: id => `desc:${id}`, get: (id, key) => key === 'equipment' ? equipment.value : undefined,
    ...(withFunction ? { getAetheriusCombatProbe: id => probe.fn(id) } : {}) };
  const scope = { interval(callback, ms) { intervals.push({ callback, ms }); }, add() { return () => {}; } };
  const recorder = new CombatProbeRecorder({ mp, file, scope, warn: m => warnings.push(m), now: () => 42,
    append: (_file, text) => {
      writer.calls++;
      const rows = text.trim().split('\n').map(line => JSON.parse(line));
      if (writer.mode === 'fail') return Promise.reject(Object.assign(Error('EIO injected'), { code: 'EIO' }));
      if (writer.mode === 'hold') return new Promise(resolve => writer.held.push(() => { lines.push(...rows); resolve(); }));
      lines.push(...rows); return Promise.resolve();
    } });
  const poll = async () => { recorder.poll(); await recorder.flush(); };
  return { probe, lines, warnings, intervals, recorder, writer, poll };
}
const binding = { characterKey: 'profile:7', epoch: 3, actorRef: { actorId: 91 } };
const transition = (enchantmentId, numChanges) => ({ actor: 91, numChanges, leftSpell: 0, rightSpell: 0, voiceSpell: 0, instantSpell: 0,
  totalEntries: 1, items: [{ baseId: 100, count: 1, hand: 'RIGHT', health: null, enchantmentId, poisonId: null, poisonCount: null }] });

test('gate: option requires the development lock; absolute file required when enabled', () => {
  assert.equal(developmentCombatProbe({ NODE_ENV: 'local' }), undefined);
  for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'local' }, { ...developmentEnv, GAME_ACCESS_CONTROL: 'true' }])
    for (const raw of ['true', 'false', ''])
      assert.throws(() => developmentCombatProbe({ ...env, GAMEPLAY_CORE_DEV_COMBAT_PROBE: raw, GAMEPLAY_CORE_DEV_COMBAT_PROBE_FILE: file }),
        /GAMEPLAY_CORE_DEV_COMBAT_PROBE refused/);
  for (const bad of [undefined, '', 'relative/probe.jsonl', ` ${file}`])
    assert.throws(() => developmentCombatProbe({ ...developmentEnv, GAMEPLAY_CORE_DEV_COMBAT_PROBE: 'true', GAMEPLAY_CORE_DEV_COMBAT_PROBE_FILE: bad }),
      error => error.code === 'DEV_COMBAT_PROBE_FILE_REQUIRED');
  assert.throws(() => developmentCombatProbe({ ...developmentEnv, GAMEPLAY_CORE_DEV_COMBAT_PROBE: 'yes', GAMEPLAY_CORE_DEV_COMBAT_PROBE_FILE: file }),
    error => error.code === 'DEV_COMBAT_PROBE_INVALID');
  assert.equal(developmentCombatProbe({ ...developmentEnv, GAMEPLAY_CORE_DEV_COMBAT_PROBE: 'false' }), undefined);
  assert.deepEqual(developmentCombatProbe({ ...developmentEnv, GAMEPLAY_CORE_DEV_COMBAT_PROBE: 'true', GAMEPLAY_CORE_DEV_COMBAT_PROBE_FILE: file }), { file });
});

for (const nodeEnv of [undefined, 'production', 'local']) for (const access of [undefined, 'true']) for (const confirmation of [undefined, 'true'])
  for (const withFile of [true, false]) {
    const locked = nodeEnv === 'local' && access !== 'true' && confirmation === 'true', allowed = locked && withFile;
    test(`boot: NODE_ENV=${nodeEnv} access=${access} opt-in=${confirmation} file=${withFile} => ${allowed ? 'poll' : 'refuse'}`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
      const dir = await mkdtemp(path.join(tmpdir(), 'ds0b-'));
      const target = path.join(dir, 'probe.jsonl');
      const mp = fakeHost(), probe = hostProbe(), log = logger(); let independent = false;
      mp.getAetheriusCombatProbe = id => probe.fn(id);
      const writes = []; mp.set = (...args) => writes.push(args);
      const core = createGameplayCore({ mp, pg: unavailablePg, log, env: { NODE_ENV: nodeEnv, GAME_ACCESS_CONTROL: access,
        GAMEPLAY_CORE_ALLOW_DEV_OPTIONS: confirmation, GAMEPLAY_CORE_DEV_COMBAT_PROBE: 'true', GAMEPLAY_CORE_MODE_PROBE: 'active',
        ...(withFile ? { GAMEPLAY_CORE_DEV_COMBAT_PROBE_FILE: target } : {}) } });
      core.register({ id: 'probe', requiresDatabase: false, start() { independent = true; } });
      try {
        await core.initialize(); assert(independent, 'independent system still starts'); assert(core.healthCheck());
        const refusal = log.messages.filter(m => m.includes('ERROR') && m.includes('GAMEPLAY_CORE_DEV_COMBAT_PROBE'));
        assert.equal(refusal.length > 0, !allowed);
        assert.equal(log.messages.some(m => m.includes('DEV COMBAT PROBE ENABLED') && m.includes('NEVER ON THE OFFICIAL SERVER')), allowed);
        probe.push('hits', { aggressor: 1, target: 2, source: 3 });
        t.mock.timers.tick(COMBAT_PROBE_INTERVAL_MS + 10);
        assert.equal(probe.calls > 0, allowed, 'host read only when accepted');
        assert.equal(writes.length, 0, 'probe never writes to the host');
      } finally { await core.shutdown(); }
      if (allowed) {
        const rows = (await readFile(target, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        assert.equal(rows[0].kind, 'start'); assert.equal(rows.filter(r => r.kind === 'hit').length, 1);
      }
      await rm(dir, { recursive: true, force: true });
    });
  }

test('polling appends each sequence once, in order; ring overwrite becomes an explicit gap', async () => {
  const h = harness();
  assert.equal(h.recorder.start(), true); await h.recorder.flush();
  assert.equal(h.intervals.length, 1); assert.equal(h.intervals[0].ms, 2000);
  h.probe.push('hits', { source: 10 }); h.probe.push('animations', { actor: 1, name: 'attackStart' });
  await h.poll(); await h.poll();
  h.probe.push('hits', { source: 11 }); h.probe.push('health', { actor: 1, before: 1, after: 0.5 });
  h.intervals[0].callback(); await h.recorder.flush(); await h.poll();
  for (let i = 0; i < 6; i++) h.probe.push('hits', { source: 20 + i }); // capacity 4 -> 2 overwritten
  await h.poll();
  assert.deepEqual(h.lines.filter(l => l.kind === 'hit').map(l => l.sequence), [1, 2, 5, 6, 7, 8]);
  assert.deepEqual(h.lines.filter(l => l.kind === 'gap').map(({ buffer, from, to, lost, reason }) => ({ buffer, from, to, lost, reason })),
    [{ buffer: 'hits', from: 3, to: 4, lost: 2, reason: 'HOST_RING_OVERWRITTEN' }]);
  assert.equal(h.lines.filter(l => l.kind === 'start').length, 1);
  assert.equal(h.lines.filter(l => l.kind === 'animation').length, 1);
  assert.equal(h.lines.filter(l => l.kind === 'health').length, 1);
  assert.equal(h.lines.find(l => l.kind === 'hit').sourceDesc, 'desc:10');
  assert(h.lines.some(l => l.kind === 'counters'));
});

test('absent host function: UNSUPPORTED logged once, nothing polled or written', async () => {
  const h = harness({ withFunction: false });
  assert.equal(h.recorder.start(), false); assert.equal(h.recorder.start(), false);
  h.recorder.poll(); h.recorder.track(binding);
  await h.recorder.shutdown();
  assert.equal(h.intervals.length, 0); assert.equal(h.lines.length, 0); assert.equal(h.writer.calls, 0);
  assert.equal(h.warnings.length, 1); assert.match(h.warnings[0], /UNSUPPORTED: mp\.getAetheriusCombatProbe is absent/);
});

test('fix1 #1: A -> B -> A accepted between two reads: every transition recorded, B enchantment resolved off the hit', async () => {
  const h = harness();
  h.recorder.start(); await h.recorder.flush(); h.recorder.track(binding);
  await h.poll(); // first read
  h.probe.push('equipment', transition(77, 1)); h.probe.push('equipment', transition(88, 2)); h.probe.push('equipment', transition(77, 3));
  await h.poll(); // second read
  const rows = h.lines.filter(l => l.kind === 'equipment' && l.source === 'HOST_TRANSITION');
  assert.deepEqual(rows.map(r => [r.sequence, r.numChanges, r.equipped[0].enchantmentId]), [[1, 1, 77], [2, 2, 88], [3, 3, 77]]);
  assert.equal(rows[1].characterKey, 'profile:7');
  assert.equal(rows[1].equipped[0].enchantment.status, 'SUPPORTED');
  assert.equal(rows[1].equipped[0].enchantment.effects[0].mgef, 6);
  assert.deepEqual(h.probe.enchantmentCalls, [77, 88], 'each enchantment resolved once (cached)');
  // Host ring overflow of transitions is explicit.
  for (let i = 0; i < 7; i++) h.probe.push('equipment', transition(0xff000010, 10 + i));
  await h.poll();
  const gap = h.lines.find(l => l.kind === 'gap' && l.buffer === 'equipment');
  assert.deepEqual([gap.from, gap.to, gap.lost], [4, 6, 3]);
  const created = h.lines.filter(l => l.source === 'HOST_TRANSITION').at(-1).equipped[0].enchantment;
  assert.deepEqual([created.status, created.reason], ['UNSUPPORTED', 'CREATED_RECORD_NOT_IN_LOAD_ORDER']);
});

test('polled equipment state (changes made outside OnUpdateEquipment): INITIAL, then only when it differs', async () => {
  const entry = { baseId: 100, count: 1, worn: true, health: 1.5, enchantmentId: 77 };
  const equipment = { value: { inv: { entries: [entry, { baseId: 200, count: 3 }] }, numChanges: 1 } };
  const h = harness({ equipment });
  h.recorder.start(); await h.recorder.flush();
  h.recorder.track(binding); await h.poll(); await h.poll();
  equipment.value = { inv: { entries: [{ ...entry, enchantmentId: 0xff000010, wornLeft: true, worn: false, poisonId: 55 }] }, numChanges: 2 };
  await h.poll(); await h.poll();
  h.recorder.untrack({ ...binding, epoch: 2 }); equipment.value = { inv: { entries: [] }, numChanges: 3 }; await h.poll();
  h.recorder.untrack(binding); equipment.value = { inv: { entries: [entry] }, numChanges: 4 }; await h.poll();
  const rows = h.lines.filter(l => l.kind === 'equipment' && l.source === 'STATE_POLL');
  assert.deepEqual(rows.map(r => r.change), ['INITIAL', 'CHANGED', 'CHANGED']);
  assert.equal(rows[0].equipped.length, 1, 'only worn entries are listed as equipped');
  assert.equal(rows[0].equipped[0].health, 1.5);
  assert.equal(rows[0].equipped[0].enchantment.status, 'SUPPORTED');
  assert.equal(rows[1].equipped[0].hand, 'LEFT'); assert.equal(rows[1].equipped[0].poisonId, 55);
  assert.equal(rows[1].equipped[0].enchantment.reason, 'CREATED_RECORD_NOT_IN_LOAD_ORDER');
});

test('fix1 #2: transient append failure does not advance checkpoints; recovery writes the kept rows, counters and equipment', async () => {
  const equipment = { value: { inv: { entries: [{ baseId: 100, count: 1, worn: true, enchantmentId: 77 }] }, numChanges: 1 } };
  const h = harness({ equipment });
  h.recorder.start(); await h.recorder.flush(); h.recorder.track(binding);
  h.probe.push('hits', { source: 10 }); h.probe.push('equipment', transition(77, 1));
  h.writer.mode = 'fail'; await h.poll(); await h.poll(); // two failed batches
  assert.equal(h.lines.filter(l => !['start', 'counters', 'writer'].includes(l.kind)).length, 0, 'nothing of the failed batches was confirmed');
  assert.equal(h.warnings.filter(w => w.includes('write failed')).length, 1);
  h.probe.push('hits', { source: 11 });
  equipment.value = { inv: { entries: [] }, numChanges: 2 }; // state changes while the failed batch is retained
  h.writer.mode = 'ok'; await h.poll(); await h.poll();
  assert.deepEqual(h.lines.filter(l => l.kind === 'hit').map(l => l.sequence), [1, 2], 'failed rows retried from the host ring');
  assert.equal(h.lines.filter(l => l.kind === 'equipment' && l.source === 'HOST_TRANSITION').length, 1);
  assert.deepEqual(h.lines.filter(l => l.kind === 'equipment' && l.source === 'STATE_POLL').map(l => l.equipment.numChanges), [1, 2], 'failed state poll retained even when current state changes');
  assert.equal(h.lines.filter(l => l.kind === 'counters').at(-1).counters.hits, 2, 'counters checkpoint advanced only with the confirmed batch');
  const writer = h.lines.filter(l => l.kind === 'writer').at(-1);
  assert.equal(writer.recovered, true); assert.equal(writer.writeFailures, 2); assert.equal(writer.lastError, 'EIO injected');
  assert(h.warnings.some(w => w.includes('write recovered after 2 failure(s)')));
  // Failure long enough for the host ring to overwrite: explicit write-loss gap.
  h.writer.mode = 'fail'; h.probe.push('hits', { source: 30 }); await h.poll();
  const readsBeforeRetry = h.probe.calls;
  for (let i = 0; i < 5; i++) h.probe.push('hits', { source: 31 + i });
  await h.poll(); assert.equal(h.probe.calls, readsBeforeRetry, 'retry keeps one batch and does not collect again');
  h.writer.mode = 'ok'; await h.poll(); await h.poll();
  const gap = h.lines.find(l => l.kind === 'gap');
  assert.deepEqual([gap.from, gap.to, gap.lost, gap.reason], [4, 4, 1, 'WRITE_FAILURE_RING_OVERWRITTEN']);
  assert.deepEqual(h.lines.filter(l => l.kind === 'writer').at(-1).lostRows, { WRITE_FAILURE_RING_OVERWRITTEN: 1 });
  await h.poll(); assert.equal(h.lines.filter(l => l.kind === 'hit').length, 7, 'no duplicate after recovery');
});

test('fix1 #3: one append in flight at most; polls while pending collect nothing; backlog bounded by the host rings', async () => {
  const h = harness();
  h.recorder.start(); await h.recorder.flush();
  h.writer.mode = 'hold';
  h.probe.push('hits', { source: 1 }); h.recorder.poll();
  assert.equal(h.recorder.pendingWrites, 1);
  for (let i = 0; i < 1000; i++) { h.probe.push('hits', { source: 2 + i }); h.recorder.poll(); assert(h.recorder.pendingWrites <= 1); }
  assert.equal(h.writer.calls, 2, 'start + one pending batch; nothing queued behind it');
  assert.equal(h.probe.calls, 2, 'no snapshot read during 1000 polls with pending append');
  h.writer.mode = 'ok'; h.writer.held.shift()(); await h.recorder.flush();
  await h.poll();
  const hits = h.lines.filter(l => l.kind === 'hit').map(l => l.sequence);
  assert.deepEqual(hits, [1, 998, 999, 1000, 1001], 'after release only the host ring (capacity 4) remained');
  const gap = h.lines.find(l => l.kind === 'gap');
  assert.deepEqual([gap.from, gap.to, gap.lost, gap.reason], [2, 997, 996, 'WRITE_BACKPRESSURE_RING_OVERWRITTEN']);
  const writer = h.lines.filter(l => l.kind === 'writer').at(-1);
  assert.equal(writer.pollsSkippedWhileWriting, 1000); assert.equal(writer.maxInFlightBatches, 1);
  assert.deepEqual(writer.lostRows, { WRITE_BACKPRESSURE_RING_OVERWRITTEN: 996 });
});

test('shutdown waits for the pending append, then reads once more', async () => {
  const h = harness();
  h.recorder.start(); await h.recorder.flush();
  h.writer.mode = 'hold'; h.probe.push('hits', { source: 1 }); h.recorder.poll();
  h.probe.push('hits', { source: 2 });
  const done = h.recorder.shutdown();
  h.writer.mode = 'ok'; h.writer.held.shift()(); await done;
  assert.deepEqual(h.lines.filter(l => l.kind === 'hit').map(l => l.sequence), [1, 2]);
});

test('host read failure is logged once and never thrown into the gamemode', async () => {
  const h = harness();
  h.recorder.start(); await h.recorder.flush(); h.probe.fn = () => '{not json'; // mp delegates to probe.fn at call time
  assert.doesNotThrow(() => { h.recorder.poll(); h.recorder.poll(); });
  await h.recorder.flush();
  assert.equal(h.warnings.filter(w => w.includes('read failed')).length, 1);
  assert.equal(h.lines.filter(l => l.kind !== 'start' && l.kind !== 'writer' && l.kind !== 'counters').length, 0);
});


test('DS-0d: rejection checkpoints retry unchanged and overflow is explicit; armor has no hand', async () => {
  const h = harness(); h.recorder.start(); await h.recorder.flush();
  h.probe.push('rejections', {reason:'TOO_DISTANT',aggressor:1,target:2,source:3,targetState:{base:20,templateChain:['npc:plugin']}});
  h.writer.mode = 'fail'; await h.poll();
  for(let i=0;i<7;i++) h.probe.push('rejections', {reason:'DIFFERENT_CELL',aggressor:1,target:2,source:3});
  h.writer.mode = 'ok'; await h.poll(); await h.poll();
  const rows = h.lines.filter(r=>r.kind==='rejection');
  assert.equal(rows[0].sequence, 1);
  assert.equal(rows[0].targetState.resolvedNpcDesc, 'npc:plugin');
  assert.equal(rows[0].targetState.baseDesc, 'desc:20');
  assert.equal(rows[0].sourceDesc, 'desc:3');
  assert(h.lines.some(r=>r.kind==='gap' && r.buffer==='rejections' && r.reason==='WRITE_FAILURE_RING_OVERWRITTEN' && r.lost===3));
  h.probe.push('equipment', {actor:91,totalEntries:2,items:[{baseId:200,wornSlot:'RIGHT',worn:true},{baseId:100,wornSlot:'LEFT',worn:true}]});
  await h.poll();
  const items = h.lines.filter(r=>r.source==='HOST_TRANSITION').at(-1).equipped;
  assert.deepEqual(items.map(i=>i.hand), ['NONE','LEFT']);
  assert(items.every(i=>i.worn));
});


test('DS-0g: NPC report checkpoint survives retry, records overflow and enriches providers', async () => {
  const h=harness();h.recorder.start();await h.recorder.flush();
  h.probe.push('npcReports',{actor:91,base:'23abe:Skyrim.esm',level:2,generation:1,reason:'ACCEPTED'});
  h.probe.push('hits',{aggressor:91,target:92,source:100,aggressorState:{actor:91,base:1,traitsProvider:'23a8b:Skyrim.esm',statsProvider:'23a8b:Skyrim.esm',templateChain:['1e7a0:Skyrim.esm','23a8b:Skyrim.esm','23a8a:Skyrim.esm'],creatureConfirmed:true,level:16}});
  h.writer.mode='fail';await h.poll();assert.equal(h.lines.filter(l=>l.kind==='npc-report').length,0);
  h.writer.mode='ok';await h.poll();await h.poll();
  const reports=h.lines.filter(l=>l.kind==='npc-report');assert.equal(reports.length,1);assert.equal(reports[0].actorDesc,'desc:91');
  const state=h.lines.find(l=>l.kind==='hit').aggressorState;
  assert.equal(state.creatureTraitsDesc,'23a8b:Skyrim.esm');assert.equal(state.creatureStatsDesc,'23a8b:Skyrim.esm');assert.equal(state.resolvedNpcDesc,'23a8a:Skyrim.esm');
  for(let i=0;i<6;i++)h.probe.push('npcReports',{actor:91,reason:'CONFIRMED_CREATURE_CONFLICT'});
  await h.poll();const gap=h.lines.find(l=>l.kind==='gap'&&l.buffer==='npcReports');assert.equal(gap.lost,2);
  assert.deepEqual(h.lines.filter(l=>l.kind==='npc-report').map(r=>r.sequence),[1,4,5,6,7]);
});

test('DS-0g-fix2: unavailable diagnostics retry, deduplicate checkpoints and expose ring loss separately',async()=>{
  const h=harness();h.recorder.start();await h.recorder.flush();
  h.probe.push('npcUnavailable',{actor:91,generation:1,reason:'RESOLVED_BASE_HAS_NO_STABLE_KEY',result:'ACCEPTED',accepted:true});
  h.writer.mode='fail';await h.poll();assert.equal(h.lines.filter(r=>r.kind==='npc-unavailable').length,0);
  h.writer.mode='ok';await h.poll();await h.poll();
  const row=h.lines.find(r=>r.kind==='npc-unavailable');
  assert.equal(row.actorDesc,'desc:91');assert.equal(row.generation,1);assert.equal(row.reason,'RESOLVED_BASE_HAS_NO_STABLE_KEY');
  assert.equal(h.lines.filter(r=>r.kind==='npc-report').length,0);
  for(let i=0;i<6;i++)h.probe.push('npcUnavailable',{actor:91,generation:2,reason:'ACTOR_NOT_LOADED',result:'ACCEPTED',accepted:true});
  await h.poll();await h.poll();
  assert.deepEqual(h.lines.filter(r=>r.kind==='npc-unavailable').map(r=>r.sequence),[1,4,5,6,7]);
  const gap=h.lines.find(r=>r.kind==='gap'&&r.buffer==='npcUnavailable');assert.equal(gap.lost,2);
});

test('DS-0g-fix4: v2 race, candidates and nested version counters survive retry unchanged',async()=>{
  const h=harness();h.recorder.start();await h.recorder.flush();
  const counts={v1:{received:0,reasons:{},reasonOverflow:0},v2:{received:1,reasons:{AMBIGUOUS_OBSERVATION:1},reasonOverflow:0}};
  const original=h.probe.fn;h.probe.fn=id=>{const answer=original(id);if(id!==undefined)return answer;
    const snapshot=JSON.parse(answer);snapshot.counters.npcReportVersions=counts;return JSON.stringify(snapshot);};
  h.probe.push('npcReports',{v:2,actor:91,base:null,race:'01320a:Skyrim.esm',candidates:2,level:2,generation:1,reason:'AMBIGUOUS_OBSERVATION'});
  h.writer.mode='fail';await h.poll();h.writer.mode='ok';await h.poll();await h.poll();
  const rows=h.lines.filter(r=>r.kind==='npc-report');assert.equal(rows.length,1);
  assert.deepEqual([rows[0].v,rows[0].race,rows[0].candidates,rows[0].base],[2,'01320a:Skyrim.esm',2,null]);
  assert.equal(rows[0].actorDesc,'desc:91');
  assert.deepEqual(h.lines.filter(r=>r.kind==='counters').at(-1).counters.npcReportVersions,counts);
});
