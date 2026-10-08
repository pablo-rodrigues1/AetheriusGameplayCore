import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createRequire } from 'node:module';
import { composeStandingStoneGrants, createStandingStoneSpike, planGrantProjection, standingStoneDefinitions } from './index.mjs';

const serverRequire = createRequire(new URL('../../../aetherius-server/build/dist/server/gamemode/core/pg.js', import.meta.url));
const { Pool } = serverRequire('pg');
const { createGameplayCore } = createRequire(import.meta.url)('../../dist/aetherius-gameplay-core.cjs');
const databaseUrl = process.env.AETHERIUS_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('AETHERIUS_TEST_DATABASE_URL is required');

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const logs = [];
let serviceSequence = 0;

function canonicalDescriptor(desc) {
  const match = /^([0-9a-f]+):(.+)$/iu.exec(desc);
  return match ? `${Number.parseInt(match[1], 16).toString(16)}:${match[2]}` : desc;
}

function fakeMp({ activeActor = null, profileId = 7 } = {}) {
  const ids = new Map();
  const descs = new Map();
  const referenceBases = new Map();
  const throwingBaseReferences = new Set();
  const profileIds = new Map();
  let nextId = 0x1000;
  let nextReferenceId = 0xe7bdd;
  if (activeActor !== null) profileIds.set(activeActor, profileId);
  const mp = {
    onActivate: undefined,
    calls: [],
    getIdFromDesc(desc) {
      const key = canonicalDescriptor(desc);
      if (!ids.has(key)) {
        nextId += 1;
        ids.set(key, nextId);
        descs.set(nextId, desc);
      }
      return ids.get(key);
    },
    getDescFromId(id) { return descs.get(id) ?? `000000:Skyrim.esm`; },
    get(actorId, property) {
      if (property === 'baseDesc') {
        if (throwingBaseReferences.has(actorId)) throw new Error('reference has no base');
        return referenceBases.get(actorId);
      }
      if (property === 'profileId') return profileIds.get(actorId);
      return undefined;
    },
    referenceForBase(baseDesc) {
      nextReferenceId += 1;
      referenceBases.set(nextReferenceId, baseDesc);
      return nextReferenceId;
    },
    referenceWithBaseError() {
      nextReferenceId += 1;
      throwingBaseReferences.add(nextReferenceId);
      return nextReferenceId;
    },
    setProfileId(actorId, value) { profileIds.set(actorId, value); },
    callPapyrusFunction(callType, className, functionName, self, args) {
      mp.calls.push({ callType, className, functionName, self, args });
      return true;
    },
    isConnected(userId) { return activeActor !== null && userId === 1; },
    getUserActor(userId) { return activeActor !== null && userId === 1 ? activeActor : undefined; },
  };
  return mp;
}

function newService(mp = fakeMp()) {
  serviceSequence += 1;
  return {
    mp,
    service: createStandingStoneSpike({ mp, pg: { init: () => pool }, log: { info: message => logs.push(message) } }),
    characterKey: `a6s2-test-${Date.now()}-${serviceSequence}`
  };
}

async function clearSpikeRows() {
  await pool.query(`TRUNCATE spike_standing_stone_projections,
    spike_standing_stone_commands, spike_standing_stone_choices`);
}

before(async () => {
  const { service } = newService();
  await service.initialize();
  service.shutdown();
});
beforeEach(clearSpikeRows);
after(async () => { await pool.end(); });

test('troca de pedra remove a antiga e adiciona a nova por StableFormKey', async () => {
  const { service, mp, characterKey } = newService();
  await service.initialize();
  await service.chooseStandingStone({ requestId: 'switch-a', characterKey, stone: 'skyrim.esm|0D232D', actorId: 0x201 });
  mp.calls.length = 0;
  await service.chooseStandingStone({ requestId: 'switch-b', characterKey, stone: 'skyrim.esm|0D232E', actorId: 0x201 });
  assert.deepEqual(mp.calls.map(call => [call.functionName, call.args[0].desc]), [
    ['RemoveSpell', '0E5F4C:Skyrim.esm'],
    ['AddSpell', '0E5F47:Skyrim.esm']
  ]);
  service.shutdown();
});

test('uma origem adicional mantém o feitiço compartilhado na troca', () => {
  const oldStoneGrant = composeStandingStoneGrants('skyrim.esm|0D232D');
  const otherSource = [{
    kind: 'spell', definition: oldStoneGrant[0].definition,
    source: { kind: 'CLASS', key: 'test-class' }
  }];
  const diff = planGrantProjection(oldStoneGrant, [
    ...composeStandingStoneGrants('skyrim.esm|0D232E'), ...otherSource
  ]);
  assert.equal(diff.removed.length, 0);
  assert.deepEqual(diff.added.map(grant => grant.definition.stableFormKey), ['skyrim.esm|0E5F47']);
});

test('catálogo cobre 13 pedras e os 14 feitiços com vínculo legível no export', () => {
  const grants = Object.keys(standingStoneDefinitions).flatMap(stone => composeStandingStoneGrants(stone));
  const spellKeys = new Set(grants.map(grant => grant.definition.stableFormKey));
  assert.equal(Object.keys(standingStoneDefinitions).length, 13);
  assert.equal(spellKeys.size, 14);
});

test('bundle mantém o spike desligado por padrão e o liga só pela flag dedicada', async () => {
  let pgInitCalls = 0;
  const disabled = createGameplayCore({ mp: fakeMp(), pg: { init() { pgInitCalls += 1; throw new Error('should stay off'); } }, env: {},
    log: { info: message => logs.push(message) } });
  await disabled.initialize();
  assert.equal(disabled.info().features.find(feature => feature.id === 'standing-stones').mode, 'off');
  assert.equal(pgInitCalls, 0);
  await disabled.shutdown();

  const mp = fakeMp();
  const original = () => 'previous';
  mp.onActivate = original;
  const enabled = createGameplayCore({ mp, pg: { init() { pgInitCalls += 1; return pool; } },
    env: { ENABLE_STANDING_STONE_SPIKE: 'true' }, log: { info: message => logs.push(message) } });
  await enabled.initialize();
  assert.equal(enabled.info().features.find(feature => feature.id === 'standing-stones').mode, 'active');
  assert.equal(pgInitCalls, 1);
  await enabled.shutdown();
  assert.equal(mp.onActivate, original);
});

test('requestId repetido grava um comando e projeta uma única vez', async () => {
  const { service, mp, characterKey } = newService();
  await service.initialize();
  const command = { requestId: 'same-request', characterKey, stone: 'skyrim.esm|0D2339', actorId: 0x202 };
  await service.chooseStandingStone(command);
  const callsAfterFirst = mp.calls.length;
  const duplicate = await service.chooseStandingStone(command);
  const rows = await pool.query('SELECT count(*)::int AS count FROM spike_standing_stone_commands WHERE request_id = $1', [command.requestId]);
  assert.equal(duplicate.duplicate, true);
  assert.equal(rows.rows[0].count, 1);
  assert.equal(mp.calls.length, callsAfterFirst);
  service.shutdown();
});

test('dois comandos concorrentes deixam um estado final completo e projetado', async () => {
  const { service, mp, characterKey } = newService();
  await service.initialize();
  await Promise.all([
    service.chooseStandingStone({ requestId: 'race-a', characterKey, stone: 'skyrim.esm|0D232D', actorId: 0x203 }),
    service.chooseStandingStone({ requestId: 'race-b', characterKey, stone: 'skyrim.esm|0D2339', actorId: 0x203 })
  ]);
  const [fact, projection] = await Promise.all([
    pool.query('SELECT stone_key FROM spike_standing_stone_choices WHERE character_key = $1', [characterKey]),
    pool.query('SELECT grants FROM spike_standing_stone_projections WHERE character_key = $1', [characterKey])
  ]);
  const finalStone = fact.rows[0].stone_key;
  const expected = composeStandingStoneGrants(finalStone);
  assert.ok(['skyrim.esm|0D232D', 'skyrim.esm|0D2339'].includes(finalStone));
  assert.deepEqual(projection.rows[0].grants.map(grant => grant.definition.stableFormKey),
    expected.map(grant => grant.definition.stableFormKey));
  assert.equal(mp.calls.at(-1).functionName, 'AddSpell');
  assert.equal(mp.calls.at(-1).args[0].desc, finalStone === 'skyrim.esm|0D232D' ? '0E5F4C:Skyrim.esm' : '0E5F61:Skyrim.esm');
  service.shutdown();
});

test('processo novo reidrata o fato e reenvia após o reset de feitiços do spawn', async () => {
  const first = { ...newService(), characterKey: 'profile:108549' };
  await first.service.initialize();
  await first.service.chooseStandingStone({ requestId: 'restart-choice', characterKey: first.characterKey,
    stone: 'skyrim.esm|0D2333', actorId: 0x204 });
  first.service.shutdown();

  const secondMp = fakeMp({ activeActor: 0x205, profileId: 108549 });
  const second = { ...newService(secondMp), characterKey: first.characterKey };
  await second.service.initialize();
  assert.ok(logs.some(message => message === '[standing-stone] active actor associated: character=profile:108549'));
  const rehydrated = await second.service.rehydrate(second.characterKey, 0x205);
  assert.equal(rehydrated.stone, 'skyrim.esm|0D2333');
  await new Promise(resolve => setTimeout(resolve, 3150));
  assert.deepEqual(secondMp.calls.map(call => call.functionName), ['RemoveSpell', 'AddSpell']);
  assert.deepEqual(secondMp.calls.map(call => call.args[0].desc), ['0E5F5E:Skyrim.esm', '0E5F5E:Skyrim.esm']);
  second.service.shutdown();
});

test('onActivate veta sincronamente, persiste em segundo plano e shutdown restaura o handler', async () => {
  const oldHandler = () => 'previous-handler';
  const mp = fakeMp();
  mp.onActivate = oldHandler;
  const { service, characterKey } = newService(mp);
  await service.initialize();
  const target = mp.referenceForBase('d232f:Skyrim.esm');
  assert.notEqual(target, mp.getIdFromDesc('0D232F:Skyrim.esm'));
  const actor = 0x206;
  mp.setProfileId(actor, 108549);
  const result = mp.onActivate(target, actor);
  assert.equal(result, false);
  assert.equal(typeof result?.then, 'undefined');
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const persisted = await pool.query('SELECT stone_key FROM spike_standing_stone_choices WHERE character_key = $1', ['profile:108549']);
    if (persisted.rows.length) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const persisted = await pool.query('SELECT stone_key FROM spike_standing_stone_choices WHERE character_key = $1', ['profile:108549']);
  assert.equal(persisted.rows[0].stone_key, 'skyrim.esm|0D232F');
  assert.ok(logs.some(message => message === '[standing-stone] activation recognized: stone=skyrim.esm|0D232F character=profile:108549'));
  assert.ok(logs.some(message => message === '[standing-stone] command recorded and projection sent: stone=skyrim.esm|0D232F character=profile:108549'));
  service.shutdown();
  assert.equal(mp.onActivate, oldHandler);
  assert.equal(characterKey.startsWith('a6s2-test-'), true);
});

test('ativacao ignorada que nao e pedra nao gera log', async () => {
  const mp = fakeMp();
  const { service } = newService(mp);
  await service.initialize();
  const logsBefore = logs.length;
  const target = mp.referenceForBase('7ffe:Skyrim.esm');
  assert.equal(mp.onActivate(target, 0x206), undefined);
  assert.equal(logs.length, logsBefore);
  service.shutdown();
});

test('referencia cuja base nao e pedra e delegada sem log', async () => {
  const calls = [];
  const mp = fakeMp();
  mp.onActivate = (...args) => { calls.push(args); return 'delegated'; };
  const { service } = newService(mp);
  await service.initialize();
  const nonStoneTarget = mp.referenceForBase('123456:Skyrim.esm');
  const logsBefore = logs.length;
  assert.equal(mp.onActivate(nonStoneTarget, 0x206), 'delegated');
  assert.deepEqual(calls, [[nonStoneTarget, 0x206]]);
  assert.equal(logs.length, logsBefore);
  service.shutdown();
});

test('erro ao ler baseDesc delega sem log', async () => {
  const calls = [];
  const mp = fakeMp();
  mp.onActivate = (...args) => { calls.push(args); return 'delegated'; };
  const { service } = newService(mp);
  await service.initialize();
  const target = mp.referenceWithBaseError();
  const logsBefore = logs.length;
  assert.equal(mp.onActivate(target, 0x206), 'delegated');
  assert.deepEqual(calls, [[target, 0x206]]);
  assert.equal(logs.length, logsBefore);
  service.shutdown();
});

test('ator sem perfil recebe veto e nao grava a ativacao', async () => {
  const mp = fakeMp();
  const { service } = newService(mp);
  await service.initialize();
  const cases = [[0x207, undefined], [0x208, 0], [0x209, -1]];
  for (const [actor, profileId] of cases) {
    mp.setProfileId(actor, profileId);
    const target = mp.referenceForBase('d232f:Skyrim.esm');
    assert.equal(mp.onActivate(target, actor), false);
    assert.equal(profileId === undefined || profileId <= 0, true);
  }
  await new Promise(resolve => setTimeout(resolve, 50));
  const rows = await pool.query('SELECT count(*)::int AS count FROM spike_standing_stone_choices');
  assert.equal(rows.rows[0].count, 0);
  assert.equal(logs.filter(message => message.includes('activation vetoed: no provisional active-character key')).length, 3);
  service.shutdown();
});
