// DS-0b: report generated from a JSONL fixture in the recorder's own line format
// (runtime/src/combat-probe.ts) carrying host rows as CombatProbe::Read() emits them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyze, parseLines, render } from '../tools/combat-probe-report.mjs';

const fixture = fileURLToPath(new URL('./fixtures/combat-probe-sample.jsonl', import.meta.url));
const tool = fileURLToPath(new URL('../tools/combat-probe-report.mjs', import.meta.url));

test('analysis: power evidence, 3000 ms health correlation with distances, integrity counters', async () => {
  const parsed = parseLines(await readFile(fixture, 'utf8'));
  assert.equal(parsed.invalid.length, 0);
  const a = analyze(parsed.rows);
  assert.deepEqual([...a.families.keys()].sort(), ['MAGIC', 'MELEE', 'RANGED', 'UNARMED']);
  assert.equal(a.families.get('RANGED').serverBlocked, 1);
  assert.deepEqual(a.power.map(p => p.found?.name ?? null), ['attackPowerStartInPlace', null]);
  assert.equal(a.power[0].found.ageMs, 400);
  // ~600 ms and ~1900 ms after a hit are suspicions; 8000 ms is outside; a rise is not a drop.
  assert.deepEqual(a.drops.map(d => d.distanceMs), [600, 1900, null]);
  assert.deepEqual(a.drops.map(d => d.hit?.sequence ?? null), [1, 2, null]);
  assert.equal(a.altered.length, 1);
  assert.equal(a.gaps.length, 2);
  assert.deepEqual(a.lostByReason, { HOST_RING_OVERWRITTEN: 2, WRITE_FAILURE_RING_OVERWRITTEN: 3 }, 'old gap lines without lost still count');
  assert.equal(a.unavailableHealth.length, 1, 'null health is unavailable, not a drop');
  assert.equal(a.writer.writeFailures, 2);
  assert.equal(a.counters.counters.overwrittenAnimations, 2);
  assert.deepEqual(a.allNames, ['attackPowerStartInPlace', 'attackStart', 'blockStart']);
});

test('markdown labels correlation as suspicion, keeps raw samples, reports enchantment status', async () => {
  const md = render(fixture, parseLines(await readFile(fixture, 'utf8')));
  assert.match(md, /suspeitas, não provas/);
  assert.match(md, /\*\*Suspeita\*\* de dano em dobro .*: 2\. Fora da janela: 1\./);
  assert.match(md, /\| SUSPEITA \| 1 \| 10600 .*\| 600 \|/);
  assert.match(md, /\| SUSPEITA \| 2 \| 21900 .*\| 1900 \|/);
  assert.match(md, /Lacunas .*: 2\./);
  assert.match(md, /HOST_RING_OVERWRITTEN=2, WRITE_FAILURE_RING_OVERWRITTEN=3/);
  assert.match(md, /Gravador: falhas de escrita 2; leituras puladas com escrita pendente 4; escritas simultâneas no máximo 1; último erro EIO injected/);
  assert.match(md, /valor indisponível .*: 1\./);
  assert.match(md, /\| HOST_TRANSITION \| 1 \| 30400 \| profile:108549 \| TRANSITION \|/);
  assert.match(md, /overwrittenAnimations \| 2/);
  assert.match(md, /Detecção do alvo nos golpes: UNAVAILABLE/);
  assert.match(md, /SUPPORTED \(MGEF 0x4605A mag 30 AV 24\)/);
  assert.match(md, /UNSUPPORTED: CREATED_RECORD_NOT_IN_LOAD_ORDER/);
  assert.match(md, /### Vida \(OnChangeValues\)/);
  assert.match(md, /\| 4 \| 45000 \| 0xFF000001 \| 0\.4000 \| 0\.9000 \| 0\.4100 \|/);
});

test('CLI writes the report file; bad usage exits 2', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ds0b-report-'));
  try {
    const out = path.join(dir, 'report.md');
    const ok = spawnSync(process.execPath, [tool, fixture, '--out', out], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(await readFile(out, 'utf8'), /# Relatório da sonda de combate/);
    assert.equal(spawnSync(process.execPath, [tool], { encoding: 'utf8' }).status, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('DS-0d: refusals, position age, observed vs exact maximum, creature power and old format', async () => {
  const source = new URL('./fixtures/combat-probe-rejections.jsonl', import.meta.url);
  const parsed = parseLines(await readFile(source, 'utf8'));
  const a = analyze(parsed.rows);
  assert.equal(a.rejections.length, 3);
  assert.equal(a.refusalsByReason.get('TOO_DISTANT'), 1);
  assert.equal(a.refusalsByActor.get(2), 3);
  assert.equal(a.positions.find(p => p.event.reason === 'TOO_DISTANT').ageMs, 5000);
  assert.equal(a.positions.find(p => p.state.movementMatches === false).ageMs, null);
  assert.equal(a.power[0].found.name, 'attackStart_ForwardPowerBite');
  for (const name of ['attackStart_LeftPowerBite', 'attackPowerStartInPlace', 'BFCO_PowerAttack'])
    assert(analyze([{kind:'hit',power:true,timeMs:1000,aggressor:1,aggressorAnimations:[{name,ageMs:10}]}]).power[0].found);
  assert.equal(analyze([{kind:'hit',power:true,timeMs:1000,aggressor:1,aggressorAnimations:[{name:'attackStart',ageMs:10}]}]).power[0].found, null);
  const md = render(String(source), parsed);
  for (const text of ['Recusas por motivo e por ator', 'Posição parada', 'Vida máxima por alvo', 'TOO_DISTANT', 'USADO_NO_GOLPE', 'LAST_OBSERVED', 'UNAVAILABLE', 'overwrittenRejections']) assert(md.includes(text), text);
  const old = render(fixture, parseLines(await readFile(fixture, 'utf8')));
  assert.match(old, /medição indisponível; não significa zero recusas/);
});


test('DS-0g: confirmation, actual providers and weapon/animation cadence retain refusals', () => {
  const state={actor:1,observationNeeded:true,creatureConfirmed:true,level:16,traitsProvider:'23a8b:Skyrim.esm',statsProvider:'23a8b:Skyrim.esm',templateChain:['1e7a0:Skyrim.esm','23a8b:Skyrim.esm','23a8a:Skyrim.esm']};
  const cadence={sincePreviousAttemptMs:250,sincePreviousAcceptedMs:400,weaponSpeed:0.7,limitMs:864.2857};
  const rows=[{kind:'counters',counters:{npcReports:3,npcReportReasons:{ACCEPTED:1,CONFIRMED_CREATURE_CONFLICT:2}}},
    {kind:'npc-report',sequence:1,actor:1,base:'23a8b:Skyrim.esm',level:16,generation:1,reason:'ACCEPTED'},
    {kind:'hit',sequence:1,timeMs:1000,aggressor:1,target:2,sourceDesc:'Greatsword.esp:123',targetMaximumHealth:400,aggressorState:state,targetState:{...state,actor:2,creatureConfirmed:false},cadence,aggressorAnimations:[{name:'BFCO_Attack',ageMs:10}]},
    {kind:'rejection',sequence:1,timeMs:1250,aggressor:1,target:2,sourceDesc:'Greatsword.esp:123',reason:'ATTACK_COOLDOWN',cadence,aggressorState:state,aggressorAnimations:[{name:'BFCO_Attack',ageMs:20}]},
    {kind:'rejection',sequence:2,timeMs:1260,aggressor:1,target:3,sourceDesc:'Greatsword.esp:123',reason:'SPLASH_TARGET_LIMIT',cadence,aggressorAnimations:[{name:'attackStart',ageMs:20}]}];
  const a=analyze(rows);assert.equal(a.npcReports.length,1);
  const md=render('DS-0g-fixture',{rows,invalid:[]});
  for(const value of ['CONFIRMADA','NÃO CONFIRMADA','23a8b:Skyrim.esm','BFCO','ATTACK_COOLDOWN','SPLASH_TARGET_LIMIT','864.2857'])assert(md.includes(value),value);
  assert.match(md,/Greatsword\.esp:123 \| BFCO \| 1 \| 1/);
  const old=render('old',{rows:[{kind:'hit',sequence:1,timeMs:1,aggressor:1,target:2}],invalid:[]});assert.match(old,/indisponíveis/);
});


test('DS-0g-fix1: persisted restore failures keep reasons separate from hoster reports', () => {
  const rows = [{ kind: 'counters', counters: {
    npcReports: 2, npcReportReasons: { ACCEPTED: 1, DUPLICATE: 1 },
    npcRestoreFailures: 3, npcRestoreFailureReasons: {
      BASE_NOT_REACHABLE: 1, INVALID_PERSISTED_NPC_OBSERVATION: 1, BASE_PLUGIN_ABSENT: 1
    }
  }}];
  const md = render('restore-failures', { rows, invalid: [] });
  assert.match(md, /Restauração de escolha persistida: falhas 3/);
  assert.match(md, /\| 2 \| 1 \| 1 \| 0 \|/);
  for (const reason of ['BASE_NOT_REACHABLE', 'INVALID_PERSISTED_NPC_OBSERVATION', 'BASE_PLUGIN_ABSENT'])
    assert(md.includes('| ' + reason + ' | 1 |'), reason);
  const historical = render('historical', { rows: [], invalid: [] });
  assert.match(historical, /Restauração de escolha persistida: falhas —/);
});

test('DS-0g-fix2: nested counter reasons render pairs and unavailable diagnostics stay separate',()=>{
  const rows=[{kind:'counters',counters:{npcReports:2,npcReportReasons:{ACCEPTED:1,DUPLICATE:1},
    npcRestoreFailures:1,npcRestoreFailureReasons:{BASE_NOT_REACHABLE:1},npcUnavailable:3,
    npcUnavailableReasons:{RESOLVED_BASE_HAS_NO_STABLE_KEY:2},npcUnavailableResults:{ACCEPTED:2,NOT_CURRENT_HOSTER:1}}},
    {kind:'npc-unavailable',sequence:1,actor:91,actorDesc:'creature-ref',generation:7,reason:'RESOLVED_BASE_HAS_NO_STABLE_KEY',result:'ACCEPTED',accepted:true}];
  const a=analyze(rows);assert.equal(a.npcUnavailable.length,1);assert.equal(a.npcReports.length,0);
  const md=render('diagnostic-fixture',{rows,invalid:[]});
  assert(!md.includes('[object Object]'));
  for(const text of ['ACCEPTED=1','DUPLICATE=1','BASE_NOT_REACHABLE=1','RESOLVED_BASE_HAS_NO_STABLE_KEY=2','NOT_CURRENT_HOSTER=1',
    'Diagnósticos de não envio: recebidos 3','| creature-ref | 7 | RESOLVED_BASE_HAS_NO_STABLE_KEY | ACCEPTED |','| 2 | 1 | 1 | 0 |'])assert(md.includes(text),text);
  const old=render('old',{rows:[],invalid:[]});assert.match(old,/Diagnósticos de não envio: recebidos —/);
});

test('DS-0g-fix4: v1 and v2 totals, reasons, race and candidate count remain separate',()=>{
  const rows=[{kind:'counters',counters:{npcReports:8,npcReportVersions:{
    v1:{received:3,reasons:{ACCEPTED:1,DUPLICATE:1,BASE_NOT_REACHABLE:1},reasonOverflow:0},
    v2:{received:5,reasons:{ACCEPTED:1,AMBIGUOUS_OBSERVATION:3,NO_MATCHING_OBSERVATION:1},reasonOverflow:0}}}},
    {kind:'npc-report',sequence:1,v:2,actor:91,base:null,race:'01320a:Skyrim.esm',candidates:2,level:2,generation:1,reason:'AMBIGUOUS_OBSERVATION'}];
  const md=render('v2-fixture',{rows,invalid:[]});
  for(const text of ['| v1 | 3 | 1 | 1 | 1 |','| v2 | 5 | 1 | 0 | 4 |',
    '| v2 | AMBIGUOUS_OBSERVATION | 3 |','v2.reasons.AMBIGUOUS_OBSERVATION=3',
    '| 1 | 2 | 0x5B | — | 01320a:Skyrim.esm | 2 | 2 | 1 | AMBIGUOUS_OBSERVATION |']) assert(md.includes(text),text);
  assert(!md.includes('[object Object]'));
  const old=render('historical',{rows:[],invalid:[]});assert(old.includes('| v2 | — | — | — | — |'));
});


test('DS-0i reports movement rejection reasons and last authoritative NPC correction without claiming convergence', () => {
  const rows=[{kind:'counters',counters:{npcMovementRejections:{DISTANCE:3,WORLD_OR_CELL:1,TELEPORT_FLAG:1},npcCorrectionsSent:2,npcCorrectionsSuppressed:3}},
    {kind:'rejection',sequence:1,timeMs:2000,aggressor:9,target:2,reason:'TOO_DISTANT',aggressorState:{actor:9,
      lastNpcCorrection:{timeMs:1800,idx:7,hoster:10,position:[100,200,300],rotation:[0,0,90],cellOrWorld:'abc:Location.esp',reason:'DISTANCE'}}}];
  const md=render('DS-0i',{rows,invalid:[]});
  for(const value of ['npcCorrectionsSent | 2','npcCorrectionsSuppressed | 3','DISTANCE=3','WORLD_OR_CELL=1','TELEPORT_FLAG=1',
    '0x9 | 1800 | 7 | 0xA | DISTANCE | 100, 200, 300 | 0, 0, 90 | abc:Location.esp','não comprova recebimento'])assert(md.includes(value),value);
  assert(render('old',{rows:[{kind:'hit',sequence:1,timeMs:1,aggressorState:{actor:9}}],invalid:[]}).includes('INDISPONÍVEL'));
});

test('DS-0k NPC equipment snapshots deduplicate polls, expose lost rows and restart after host reset', () => {
  const item={key:'801:Provider.esp',count:2,hand:'RIGHT'};
  const sample={sequence:3,timeMs:100,actor:42,generation:7,hoster:19,phase:'RESPAWN_REBUILT',numChanges:2,equipment:[item],inventoryWeapons:[{...item,hand:'NONE'}],equipmentOmitted:0,inventoryWeaponsOmitted:1,spells:[null,null,null,null]};
  const counter=samples=>({kind:'counters',counters:{npcEquipment:{total:3,overwritten:2,samples}}});
  const parsed={rows:[counter([sample]),counter([sample]),{kind:'rejection',sequence:4,aggressor:42,reason:'WEAPON_NOT_EQUIPPED',npcEquipmentSequence:3},{kind:'reset'},counter([{...sample,sequence:1,phase:'AFTER_RESPAWN',generation:8}])],invalid:[]};
  const result=analyze(parsed.rows);
  assert.deepEqual(result.npcEquipment.map(s=>[s.epoch,s.sequence]),[[0,3],[1,1]]);
  assert.deepEqual(result.npcEquipmentGaps,[{epoch:0,from:1,to:2,lost:2}]);
  const md=render('ds0k',parsed);
  assert.match(md,/Armas de NPC antes da morte e após respawn/);
  assert.match(md,/Lacunas próprias do anel de equipamento: 2 amostras/);
  assert.match(md,/801:Provider.esp ×2 RIGHT/);
  assert.match(md,/801:Provider.esp ×2 NONE/);
  assert.match(md,/RESPAWN_REBUILT/);assert.match(md,/AFTER_RESPAWN/);
  assert.match(md,/\| 4 \| 0x2A \| 3 \|/);
});

test('DS-0k historical and missing stable keys stay explicitly unavailable', () => {
  const md=render('old',{rows:[{kind:'rejection',sequence:1,aggressor:42,reason:'WEAPON_NOT_EQUIPPED'}],invalid:[]});
  assert.match(md,/Formato antigo = indisponível/);assert.match(md,/\| 1 \| 0x2A \| INDISPONÍVEL \|/);
  const unavailable=render('new',{rows:[{kind:'counters',counters:{npcEquipment:{samples:[{sequence:1,equipment:[{key:null,count:1,hand:'RIGHT'}]}]}}}],invalid:[]});
  assert.match(unavailable,/UNSUPPORTED ×1 RIGHT/);
});
