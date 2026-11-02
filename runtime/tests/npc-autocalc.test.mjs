// DS-5c: skills de NPC com AutoCalcStats (CLAS/RACE/GMST vencedores) e perks do NPC_ com origem NPC_RECORD.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bundled = await build({
  absWorkingDir: root,
  stdin: {
    loader: 'ts',
    resolveDir: root,
    contents: "export {composeNpcCombatProfile} from './runtime/src/combat-profile.ts';\n" +
      "export {computeAutoCalcSkills,distributeAutoCalc,createNpcAutoCalcSource,AUTOCALC_GMSTS} from './runtime/src/npc-autocalc.ts';\n",
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const api = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

const catalog = name => JSON.parse(readFileSync(resolve(root, 'catalog', name + '.json'), 'utf8'));
const entry = record => ({
  definition: { stableFormKey: record.stableFormKey, recordType: record.recordType, catalogSignature: record.signature },
  winnerPlugin: record.winnerPlugin, data: record.data,
});
function domain(records) {
  const byKey = new Map(records.map(record => [record.stableFormKey, entry(record)]));
  return { status: 'SUPPORTED', signature: 'test', records: [...byKey.values()], byKey: key => byKey.get(key) };
}
const npcCatalog = catalog('npcs'), raceCatalog = catalog('races');
const perkRecords = ['classes', 'races', 'standing-stones'].flatMap(name => catalog(name).records).filter(r => r.recordType === 'PERK');
const perkByKey = new Map(perkRecords.map(record => [record.stableFormKey, entry(record)]));
const lookupPerk = key => perkByKey.get(key);
const races = domain(raceCatalog.records);

// skyrim.esm|013261: AutoCalcStats, nível fixo 9, NordRace (013746), CLAS 013257, sem template.
const NPC = 'skyrim.esm|013261', NORD = 'skyrim.esm|013746', CLASS = 'skyrim.esm|013257';
const npcRecord = npcCatalog.records.find(record => record.stableFormKey === NPC);
const observation = { status: 'CONFIRMED', stableFormKey: NPC, generation: '1' };

// Pesos/bônus sintéticos: OneHanded 2, Block 1, HeavyArmor 1; Nord +5 OneHanded (AV 6).
const weights = Array(18).fill(0); weights[0] = 2; weights[3] = 1; weights[5] = 1;
const boosts = [[6, 5], [255, 0], [255, 0], [255, 0], [255, 0], [255, 0], [255, 0]];
const source = (certified, overrides = {}) => ({
  certified,
  classSkillWeights: key => (key === CLASS ? weights : null),
  raceSkillBoosts: key => (key === NORD ? boosts : null),
  settings: () => ({ skillStart: 10, skillsPerLevel: 8 }),
  ...overrides,
});

test('distribuição: partes inteiras por peso, sem resto', () => {
  const skills = api.computeAutoCalcSkills(weights, boosts, 11, 10, 8); // 80 pontos / peso total 4
  assert.equal(skills[0], 10 + 5 + 40);
  assert.equal(skills[3], 30);
  assert.equal(skills[5], 30);
  assert.equal(skills[6], 10);
});

test('distribuição: teto 100 redistribui o excesso e não passa do teto', () => {
  const skills = api.computeAutoCalcSkills(weights, boosts, 40, 10, 8); // 312 pontos
  assert.deepEqual([skills[0], skills[3], skills[5]], [100, 100, 100]);
  assert.equal(skills[1], 10);
});

test('distribuição: resto vai um ponto por vez, peso maior primeiro e AV maior no empate', () => {
  const values = [0, 0, 0, 0];
  api.distributeAutoCalc(values, [1, 1, 2, 0], 6, 100); // 6 % 4 = 2 sobram: índice 2 (peso 2), depois índice 1
  assert.deepEqual(values, [1, 2, 3, 0]);
});

test('RACE com ActorValue fora de 6..23 é recusada', () => {
  assert.throws(() => api.computeAutoCalcSkills(weights, [[30, 5]], 2, 10, 8), /RACE_SKILL_ACTOR_VALUE/);
});

test('perfil: AutoCalcStats sem certificação continua UNSUPPORTED', () => {
  assert.ok(npcRecord, 'catálogo precisa conter ' + NPC);
  const profile = api.composeNpcCombatProfile(observation, domain([npcRecord]), races, lookupPerk, 1, source(false));
  assert.equal(profile.skills.OneHanded.status, 'UNSUPPORTED');
  assert.equal(profile.skills.OneHanded.reason, 'NPC_AUTOCALC_FORMULA_UNCERTIFIED');
});

test('perfil: AutoCalcStats certificado usa nível, CLAS e RACE vencedores', () => {
  const profile = api.composeNpcCombatProfile(observation, domain([npcRecord]), races, lookupPerk, 1, source(true));
  assert.equal(profile.level.value, 9);
  // 10 + 5 (Nord) + 64 pontos * 2/4 = 47; Block e HeavyArmor 10 + 16 = 26; resto 10.
  assert.deepEqual(Object.fromEntries(Object.entries(profile.skills).map(([k, v]) => [k, v.value])),
    { OneHanded: 47, TwoHanded: 10, Marksman: 10, Block: 26, HeavyArmor: 26, LightArmor: 10 });
});

test('perfil: sem CLAS vencedora ou sem fonte, o motivo diz o que faltou', () => {
  const noClass = api.composeNpcCombatProfile(observation, domain([npcRecord]), races, lookupPerk, 1,
    source(true, { classSkillWeights: () => null }));
  assert.equal(noClass.skills.Block.reason, 'NPC_CLASS_WINNER_UNAVAILABLE');
  const noSource = api.composeNpcCombatProfile(observation, domain([npcRecord]), races, lookupPerk, 1);
  assert.equal(noSource.skills.Block.reason, 'NPC_AUTOCALC_GMST_CATALOG_UNAVAILABLE');
});

test('perfil: perks do NPC compilam com origem NPC_RECORD; perk fora do catálogo fica presente e UNSUPPORTED', () => {
  const known = perkRecords.find(record => record.stableFormKey === 'aetherius.esp|000805') ?? perkRecords[0];
  const missing = 'skyrim.esm|079376';
  assert.ok(!perkByKey.has(missing));
  const withPerks = { ...npcRecord, data: { ...npcRecord.data, perks: [[known.stableFormKey, 1], [missing, 1]],
    unavailable: npcRecord.data.unavailable.filter(path => path !== 'Perks') } };
  const profile = api.composeNpcCombatProfile(observation, domain([withPerks]), races, lookupPerk, 1, source(true));
  const byKey = new Map(profile.perks.value.map(item => [item.stableFormKey, item]));
  const compiled = byKey.get(known.stableFormKey);
  assert.equal(compiled.sourceKind, 'NPC_RECORD');
  assert.equal(compiled.sourceKey, NPC);
  assert.equal(compiled.compiled.origin.sourceKind, 'NPC_RECORD');
  assert.equal(byKey.get(missing).reason, 'PERK_WINNER_UNAVAILABLE');
  assert.notEqual(profile.perks.status, 'SUPPORTED');
});

test('fonte do servidor lê CLAS, RACE e GMST vencedores pelo mp', () => {
  const int = value => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, value, true); return b; };
  const clas = new Uint8Array(52); clas.set(weights, 6);
  const race = new Uint8Array(14); race.set([6, 5, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0]);
  const records = {
    [`013257:skyrim.esm`]: { type: 'CLAS', fields: [{ type: 'DATA', data: clas }] },
    [`013746:skyrim.esm`]: { type: 'RACE', fields: [{ type: 'DATA', data: race }] },
    [`000803:aetherius.esp`]: { type: 'GMST', editorId: 'iAVDSkillStart', fields: [{ type: 'DATA', data: int(10) }] },
    [`0C790F:skyrim.esm`]: { type: 'GMST', editorId: 'iAVDSkillsLevelUp', fields: [{ type: 'DATA', data: int(8) }] },
  };
  const ids = Object.keys(records);
  const mp = { get() {}, getIdFromDesc: desc => ids.indexOf(desc) + 1, lookupEspmRecordById: id => ({ record: records[ids[id - 1]] }) };
  const live = api.createNpcAutoCalcSource(mp, true);
  assert.deepEqual([...live.classSkillWeights(CLASS)], weights);
  assert.deepEqual(live.raceSkillBoosts(NORD)[0], [6, 5]);
  assert.deepEqual(live.settings(), { skillStart: 10, skillsPerLevel: 8 });
  assert.equal(live.classSkillWeights('skyrim.esm|000001'), null);
});
