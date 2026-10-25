import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { fakeHost, unavailablePg, logger } from './host.mjs';

const core = fileURLToPath(new URL('../../', import.meta.url));
const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const exportsDir = workspace + '_work/exports/combat-20261024';
const dataDir = workspace + 'aetherius-server/build/dist/server/data';
const { plugins } = JSON.parse(await readFile(dataDir + '/aetherius-loadorder.json', 'utf8'));
const compiled = await build({ stdin: { contents: [
  "export { buildCombatDomain } from './tools/catalog/combat.ts';",
  "export { buildEffectsDomain, physicalEffectRule } from './tools/catalog/effects.ts';",
  "export { WEAPON_COMBAT_FIELDS, ARMOR_COMBAT_FIELDS } from './shared/record-catalog/src/combat.ts';",
  "export { EFFECT_FIELDS } from './shared/record-catalog/src/effects.ts';",
  "export { buildNpcsDomain } from './tools/catalog/npcs.ts';",
  "export { NPC_FIELDS, NPC_TEMPLATE_CATEGORIES, npcField, npcTemplateProvider } from './shared/record-catalog/src/npcs.ts';",
  "export { loadDomain, canonicalJson, contentSignature, encodeFormKey, recordSignature } from './shared/record-catalog/src/index.ts';",
  "export { createFileHost } from './tools/catalog/host.ts';"
].join('\n'), resolveDir: core }, bundle: true, platform: 'node', format: 'esm', write: false });
const { buildCombatDomain, buildEffectsDomain, physicalEffectRule, WEAPON_COMBAT_FIELDS, ARMOR_COMBAT_FIELDS, EFFECT_FIELDS, buildNpcsDomain, NPC_FIELDS, NPC_TEMPLATE_CATEGORIES, npcField, npcTemplateProvider, loadDomain, canonicalJson, contentSignature, encodeFormKey, recordSignature, createFileHost } =
  await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const domain = JSON.parse(await readFile(core + 'catalog/combat.json', 'utf8'));
const npcDomain = JSON.parse(await readFile(core + 'catalog/npcs.json', 'utf8'));
const effectsDomain = JSON.parse(await readFile(core + 'catalog/effects.json', 'utf8'));
const families = ['WEAP', 'ARMO', 'AMMO', 'RACE', 'KYWD', 'NPC_', 'CLAS'];
const sources = new Map(await Promise.all([...families,'MGEF','ENCH','ALCH','PERK'].map(async name => {
  const lines = (await readFile(exportsDir + '/' + name + '.jsonl', 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  return [name, { manifest: lines.shift(), records: new Map(lines.map(row => [row.formid.toLowerCase(), row])) }];
})));
const row = (type, address) => {
  const result = sources.get(type).records.get(address.toLowerCase());
  assert.ok(result, 'Required source FormID: ' + address); return result;
};
const byAddress = new Map([...domain.records, ...npcDomain.records, ...effectsDomain.records].map(r => [encodeFormKey(r.stableFormKey, 'housecarl', r.pluginKind).toLowerCase(), r]));
const find = address => byAddress.get(address.toLowerCase());

// Contract double only: ScampServer GetEspmLoadOrder/GetIdFromDesc and LookupEspmRecordById,
// tools/catalog/host.ts extracts result.record?.type. It proves no native host behavior.
function catalogApi(domains, reversed = false) {
  const dependencies = [...new Map(domains.flatMap(d => d.dependencies).map(p => [p.filename.toLowerCase(), p])).values()];
  const ordered = reversed ? [...dependencies].reverse() : dependencies;
  let fullSlot = 1, lightSlot = 0;
  const bases = new Map(ordered.map(p => [p.filename.toLowerCase(), p.isLight
    ? 254 * 2 ** 24 + lightSlot++ * 2 ** 12 : fullSlot++ * 2 ** 24]));
  const ids = new Map(), types = new Map();
  for (const record of domains.flatMap(d => d.records)) {
    const descriptor = encodeFormKey(record.stableFormKey, 'skymp', record.pluginKind).toLowerCase();
    const id = bases.get(record.definingPlugin.toLowerCase()) + Number.parseInt(descriptor.split(':')[0], 16);
    ids.set(descriptor, id); types.set(id, record.recordType);
  }
  return { getEspmLoadOrder: () => ordered.map(p => p.filename),
    getIdFromDesc: descriptor => ids.get(descriptor.toLowerCase()),
    lookupEspmRecordById: id => types.has(id) ? { record: { type: types.get(id) } } : {} };
}

test('combat reproduction is canonical and independent of plugin manifest order', async () => {
  const rebuilt = await buildCombatDomain(exportsDir, [...plugins].reverse());
  assert.equal(canonicalJson(rebuilt) + '\n', await readFile(core + 'catalog/combat.json', 'utf8'));
  assert.equal(rebuilt.exportEpoch, sources.get('WEAP').manifest.epoch);
  for (const sig of ['WEAP', 'ARMO', 'AMMO', 'RACE']) {
    assert.equal(rebuilt.records.filter(r => r.recordType === sig).length, sources.get(sig).manifest.row_count);
  }
  const reached = new Set(domain.records.flatMap(r => Array.isArray(r.data.keywords) ? r.data.keywords : Object.entries(r.data.fields)
    .filter(([p]) => /^Keywords\[/.test(p)).map(([, k]) => k)));
  assert.deepEqual(new Set(domain.records.filter(r => r.recordType === 'KYWD').map(r => r.stableFormKey)), reached);
  console.log('combat deterministic:', domain.roots.length, 'roots;', domain.records.length, 'records;', domain.signature);
});

test('physical values and nullable references agree with winners looked up by FormID', () => {
  for (const [sig, address, paths] of [
    ['WEAP', '01397E:Skyrim.esm', ['BasicStats.Damage', 'Data.Speed', 'Data.Reach', 'Critical.Damage', 'Critical.PercentMult']],
    ['ARMO', '012E46:Skyrim.esm', ['ArmorRating']],
    ['AMMO', '01397D:Skyrim.esm', ['Damage']],
    ['RACE', '01320A:Skyrim.esm', ['UnarmedDamage', 'UnarmedReach']]
  ]) {
    const source = row(sig, address), actual = find(address); assert.ok(actual);
    assert.equal(actual.winnerPlugin, source.winner);
    for (const p of paths) assert.equal(actual.data.fields[p], Number(source.fields.find(f => f.path === p).value));
  }
  assert.equal(find('01397E:Skyrim.esm').data.fields.ObjectEffect, null);
  assert(domain.unsupported.some(u => u.reason.includes('AttackData') && u.count > 0));
});

test('reordered FULL/LIGHT, NPC_ and CLAS retain signatures and data with changed runtime IDs', () => {
  for (const data of [domain, npcDomain, effectsDomain]) {
    const a = loadDomain(data, createFileHost(catalogApi([data]), dataDir, [data]));
    const b = loadDomain(data, createFileHost(catalogApi([data], true), dataDir, [data]));
    assert.equal(a.status, 'SUPPORTED', a.issues.join('; ')); assert.equal(b.status, 'SUPPORTED', b.issues.join('; '));
    assert.equal(a.signature, b.signature);
    for (const r of a.records) {
      const moved = b.byKey(r.definition.stableFormKey); assert.ok(moved);
      assert.equal(moved.definition.catalogSignature, r.definition.catalogSignature);
      assert.deepEqual(moved.data, r.data);
      assert.equal(a.lookup(r.definition).status, 'SUPPORTED');
    }
    assert(a.records.some(r => r.pluginKind === 'FULL' && r.runtimeFormId !== b.byKey(r.definition.stableFormKey).runtimeFormId));
    if (data.records.some(r => r.pluginKind === 'LIGHT')) assert(a.records.some(r => r.pluginKind === 'LIGHT' && r.runtimeFormId !== b.byKey(r.definition.stableFormKey).runtimeFormId));
    for (const type of data === npcDomain ? ['NPC_', 'CLAS'] : data === effectsDomain ? ['MGEF','ENCH','ALCH'] : ['WEAP', 'ARMO']) {
      assert(a.records.some(r => r.definition.recordType === type && r.runtimeFormId !== b.byKey(r.definition.stableFormKey).runtimeFormId));
    }
    if (data === domain) assert(a.records.some(r => ['WEAP', 'ARMO'].includes(r.definition.recordType)
      && typeof (r.data.fields.Template ?? r.data.fields.TemplateArmor) === 'string'
      && r.runtimeFormId !== b.byKey(r.definition.stableFormKey).runtimeFormId));
    const record = data.records.find(r => r.pluginKind === 'LIGHT') ?? data.records[0];
    const absent = catalogApi([data]); const lookup = absent.lookupEspmRecordById;
    const missingId = absent.getIdFromDesc(encodeFormKey(record.stableFormKey, 'skymp', record.pluginKind));
    absent.lookupEspmRecordById = id => id === missingId ? {} : lookup(id);
    const refused = loadDomain(data, createFileHost(absent, dataDir, [data]));
    assert.equal(refused.status, 'UNSUPPORTED'); assert.equal(refused.records.length, 0);
  }
});

test('boot loads combat with createFileHost; damage declares DS-4/DS-5 rather than a missing catalog', async () => {
  const domains = await Promise.all(['standing-stones', 'races', 'classes', 'combat', 'npcs', 'effects'].map(async n => JSON.parse(await readFile(core + 'catalog/' + n + '.json', 'utf8'))));
  const mp = Object.assign(fakeHost(), catalogApi(domains));
  mp.getServerSettings = () => ({ dataDir });
  const require = createRequire(import.meta.url);
  const runtime = require('../../dist/aetherius-gameplay-core.cjs').createGameplayCore({ mp, pg: unavailablePg, log: logger(), env: { GAMEPLAY_CORE_MODE_COMBAT_PROBE: 'audit', GAMEPLAY_CORE_MODE_NPC_PROBE: 'audit' } });
  let started = false;
  runtime.register({ id: 'combat-probe', domain: 'combat', requiresDatabase: false, start(context) {
    started = true; assert.equal(context.catalog.records.length, domain.records.length);
  } });
  let npcsStarted = false;
  runtime.register({ id: 'npc-probe', domain: 'npcs', requiresDatabase: false, start(context) {
    npcsStarted = true; assert.equal(context.catalog.status, 'SUPPORTED');
    assert.equal(context.catalog.records.length, npcDomain.records.length);
  } });
  await runtime.initialize();
  try {
    assert.equal(started, true); assert.equal(npcsStarted, true);
    const damage = runtime.capabilityReport().systems.find(s => s.id === 'damage');
    assert.equal(damage.catalog.domain, 'combat'); assert.equal(damage.catalog.status, 'SUPPORTED');
    assert.equal(damage.status, 'UNSUPPORTED');
    // DS-4 owns profile availability; this catalog slice requires the native bridge to stay unavailable.
    assert(damage.missing.some(s => s.includes('NATIVE_COMBAT_CATALOG_BRIDGE_NOT_DELIVERED')));
    assert(!damage.missing.some(s => s.includes('Catalog domain damage not delivered')));
  } finally { await runtime.shutdown(); }
});

test('missing fields, invalid numbers, missing keywords, epochs and metadata never gain defaults', async () => {
  const fixture = workspace + '_work/evidence/DS-2d/generator-fixture'; await mkdir(fixture, { recursive: true });
  const fixtureRows = {
    WEAP: [row('WEAP', '01397E:Skyrim.esm')], ARMO: [row('ARMO', '012E46:Skyrim.esm')],
    NPC_: [row('NPC_', '023ABE:Skyrim.esm')], CLAS: [],
    AMMO: [row('AMMO', '01397D:Skyrim.esm')], RACE: [row('RACE', '01320A:Skyrim.esm')],
    KYWD: [...sources.get('KYWD').records.values()].filter(r => [row('WEAP', '01397E:Skyrim.esm'), row('ARMO', '012E46:Skyrim.esm'), row('AMMO', '01397D:Skyrim.esm'), row('RACE', '01320A:Skyrim.esm')]
      .some(source => source.fields.some(f => /^Keywords\[/.test(f.path) && f.value?.toLowerCase() === r.formid.toLowerCase())))
  };
  async function write(type, records, epoch = domain.exportEpoch) {
    await writeFile(fixture + '/' + type + '.jsonl', [JSON.stringify({ housecarl_artifact: 1, row_count: records.length, epoch }), ...records.map(r => JSON.stringify(r))].join('\n') + '\n');
  }
  for (const type of families) await write(type, fixtureRows[type]);
  const edited = structuredClone(fixtureRows.WEAP[0]);
  edited.fields = edited.fields.filter(f => f.path !== 'BasicStats.Damage');
  edited.fields.find(f => f.path === 'Data.Speed').value = 'NaN'; await write('WEAP', [edited]);
  await write('KYWD', []);
  const partial = await buildCombatDomain(fixture, plugins);
  const weapon = partial.records.find(r => r.recordType === 'WEAP');
  assert.equal(weapon.data.fields['BasicStats.Damage'], null); assert.equal(weapon.data.fields['Data.Speed'], null);
  assert(partial.unsupported.some(u => u.reason.includes('BasicStats.Damage: field not exported')));
  assert(partial.unsupported.some(u => u.reason.includes('Data.Speed: invalid number')));
  assert(partial.unsupported.some(u => u.reason === 'Reached KYWD absent from exports'));
  await write('AMMO', fixtureRows.AMMO, 'different-epoch');
  await assert.rejects(buildCombatDomain(fixture, plugins), /different epochs/);
  await write('AMMO', fixtureRows.AMMO);
  await assert.rejects(buildCombatDomain(fixture, plugins.filter(p => p.filename.toLowerCase() !== 'skyrim.esm')), /metadata absent/);
  await write('WEAP', [edited, edited]);
  await assert.rejects(buildCombatDomain(fixture, plugins), /Duplicate record/);
});


test('NPC winner leaves, levels, perks and item references match exports by FormID', () => {
  const fixed = find('023ABE:Skyrim.esm');
  assert.deepEqual(fixed.data.level, { kind: 'FIXED', value: 2 });
  assert.equal(fixed.data.autoCalcStats, true);
  assert(npcDomain.unsupported.some(u => u.reason.includes('auto-calculation semantics')));
  const scaled = find('0173C2:Skyrim.esm');
  assert.deepEqual(scaled.data.level, { kind: 'PC_LEVEL_MULT', multiplier: 1.5, min: 3, max: 20 });
  assert.equal(npcField(scaled.data, 'Configuration.HealthOffset'), -50);
  assert.deepEqual(scaled.data.perks, [['skyrim.esm|0E997B', 1]]);
  assert.deepEqual(scaled.data.items, [['skyrim.esm|0A6E7A', null]]);
  assert(npcDomain.unsupported.some(u => u.reason.includes('Item.Count: field not exported') && u.count > 1));
  // Exhaustive comparison of selected raw numeric/enum leaves for every NPC winner.
  for (const actual of npcDomain.records.filter(r => r.recordType === 'NPC_')) {
    const address = encodeFormKey(actual.stableFormKey, 'housecarl', actual.pluginKind);
    const source = row('NPC_', address);
    assert.equal(actual.winnerPlugin, source.winner);
    const fields = new Map(source.fields.map(f => [f.path, f]));
    for (const [path, value] of NPC_FIELDS.map(path => [path, npcField(actual.data, path)])) {
      if (typeof value === 'number') assert.equal(value, Number(fields.get(path)?.value), address + ':' + path);
      if (path.startsWith('Configuration.') && typeof value === 'string') assert.equal(value, fields.get(path)?.value);
    }
    for (const perk of actual.data.perks ?? []) assert(perk[0] === null || typeof perk[0] === 'string');
  }
});

test('NPC chained templates resolve each category to its own exported winner', () => {
  const head = find('003D7B:Dawnguard.esm');
  const chain = ['003D7B:Dawnguard.esm', '003D05:Dawnguard.esm', '003372:Dawnguard.esm'];
  for (const [i, address] of chain.entries()) {
    const source = row('NPC_', address), actual = find(address);
    const target = source.fields.find(f => f.path === 'Template');
    if (i < chain.length - 1) assert.equal(target.value.toLowerCase(), chain[i + 1].toLowerCase());
    assert.equal(actual.winnerPlugin, source.winner);
  }
  assert.deepEqual(npcTemplateProvider(head.data, 'Stats'), { status: 'SUPPORTED',
    provider: 'dawnguard.esm|003372', chain: ['dawnguard.esm|003D7B', 'dawnguard.esm|003D05', 'dawnguard.esm|003372'] });
  const split = Object.fromEntries(NPC_TEMPLATE_CATEGORIES.map(c => [c, npcTemplateProvider(find('0173C2:Skyrim.esm').data, c)]));
  assert.equal(split.Stats.provider, 'skyrim.esm|0173C2');
  assert.equal(split.Traits.provider, 'skyrim.esm|01716B');
  assert.equal(split.AttackData.provider, 'skyrim.esm|027498');
  // This is graph/provider resolution only. No mutable actor, LVLN draw or profile is created.
});

test('NPC missing/cyclic templates and unavailable fields remain explicitly unsupported', async () => {
  const fixture = workspace + '_work/evidence/DS-2d/npc-fixture'; await mkdir(fixture, { recursive: true });
  async function write(type, records) {
    await writeFile(fixture + '/' + type + '.jsonl', [JSON.stringify({ housecarl_artifact: 1, row_count: records.length,
      epoch: domain.exportEpoch }), ...records.map(r => JSON.stringify(r))].join('\n') + '\n');
  }
  for (const type of families) await write(type, []);
  const head = structuredClone(row('NPC_', '003D7B:Dawnguard.esm'));
  const middle = structuredClone(row('NPC_', '003D05:Dawnguard.esm'));
  const npcRecord = d => d.records.find(r => r.stableFormKey === 'dawnguard.esm|003D7B');
  await write('NPC_', [head]);
  let result = await buildNpcsDomain(fixture, plugins);
  assert.equal(npcTemplateProvider(npcRecord(result).data, 'Stats').status, 'UNSUPPORTED');
  assert(npcTemplateProvider(npcRecord(result).data, 'Stats').reason.includes('absent'));
  middle.fields.find(f => f.path === 'Template').value = head.formid;
  await write('NPC_', [head, middle]);
  result = await buildNpcsDomain(fixture, plugins);
  assert.equal(npcTemplateProvider(npcRecord(result).data, 'Stats').status, 'UNSUPPORTED');
  assert.match(npcTemplateProvider(npcRecord(result).data, 'Stats').reason, /cycle/);
  const partial = structuredClone(row('NPC_', '0173C2:Skyrim.esm'));
  partial.fields = partial.fields.filter(f => f.path !== 'PlayerSkills.SkillValues[Block]');
  partial.fields.find(f => f.path === 'Perks[0].Rank').value = 'NaN';
  partial.fields.find(f => f.path === 'Configuration.TemplateFlags').value = 'UnknownFlag';
  partial.fields.find(f => f.path === 'Configuration.Flags').value = 'UnknownFlag';
  await write('NPC_', [partial]);
  result = await buildNpcsDomain(fixture, plugins);
  const actual = result.records.find(r => r.recordType === 'NPC_');
  assert.equal(npcField(actual.data, 'PlayerSkills.SkillValues[Block]'), null);
  assert.equal(actual.data.perks[0][1], null);
  assert.equal(actual.data.templateFlags, null);
  assert.equal(actual.data.autoCalcStats, null);
  assert(result.unsupported.some(u => u.reason.includes('AutoCalcStats flag cannot be decoded')));
  assert.equal(npcTemplateProvider(actual.data, 'Stats').status, 'UNSUPPORTED');
  assert(result.unsupported.some(u => u.reason.includes('SkillValues[Block]')));
  assert(result.unsupported.some(u => u.reason.includes('Rank: invalid number')));
  // A known null link terminates inheritance even when template flag bits are set (host rule).
  const noTemplate = structuredClone(head);
  noTemplate.fields.find(f => f.path === 'Template').value = undefined;
  noTemplate.fields.find(f => f.path === 'Template').note = '(null link)';
  await write('NPC_', [noTemplate]);
  result = await buildNpcsDomain(fixture, plugins);
  assert.equal(npcTemplateProvider(npcRecord(result).data, 'Stats').provider, 'dawnguard.esm|003D7B');
  // LVLN has no deterministic catalog provider: no list is selected here, per Q13.
  head.fields.find(f => f.path === 'Template').value = '01E7A0:Skyrim.esm';
  await write('NPC_', [head]);
  result = await buildNpcsDomain(fixture, plugins);
  assert.match(npcTemplateProvider(npcRecord(result).data, 'Stats').reason, /no spawn selection/);
});

test('NPC/CLAS reproduction, complete report counts and compact layout are deterministic', async () => {
  const report = [];
  const rebuilt = await buildNpcsDomain(exportsDir, [...plugins].reverse(), report);
  assert.equal(canonicalJson(rebuilt) + '\n', await readFile(core + 'catalog/npcs.json', 'utf8'));
  for (const sig of ['NPC_', 'CLAS']) assert.equal(rebuilt.records.filter(r => r.recordType === sig).length, sources.get(sig).manifest.row_count);
  assert.equal(rebuilt.exportEpoch, domain.exportEpoch);
  assert.equal(report.length, rebuilt.unsupported.reduce((sum, u) => sum + u.count, 0));
  assert(report.every(u => typeof u.stableFormKey === 'string'));
  assert(rebuilt.unsupported.every(u => u.stableFormKey === null && u.count > 0));
  assert(rebuilt.unsupported.length < 100);
  const physicalReport = []; const physical = await buildCombatDomain(exportsDir, plugins, physicalReport);
  assert.equal(physicalReport.length, physical.unsupported.reduce((sum, u) => sum + u.count, 0));
  assert(physical.records.every(r => !['NPC_', 'CLAS'].includes(r.recordType)));
  const keys = new Set(rebuilt.records.map(r => r.stableFormKey));
  for (const actual of rebuilt.records.filter(r => r.recordType === 'NPC_')) {
    assert.equal(actual.data.fields.length, NPC_FIELDS.length);
    let mask = 0;
    for (const group of actual.data.providers) { assert.equal(mask & group[0], 0); mask |= group[0]; }
    assert.equal(mask, 2 ** NPC_TEMPLATE_CATEGORIES.length - 1);
    for (const category of NPC_TEMPLATE_CATEGORIES) {
      const provider = npcTemplateProvider(actual.data, category);
      if (provider.status === 'SUPPORTED') assert(keys.has(provider.provider));
      else assert.equal(typeof provider.reason, 'string');
    }
  }
});

test('all CLAS skill/stat weights and auto-calculation parameters equal exports by FormID', () => {
  const skillNames = NPC_FIELDS.filter(p => p.startsWith('PlayerSkills.SkillValues[')).map(p => p.slice(p.indexOf('[') + 1, -1));
  for (const actual of npcDomain.records.filter(r => r.recordType === 'CLAS')) {
    const source = row('CLAS', encodeFormKey(actual.stableFormKey, 'housecarl', actual.pluginKind));
    const fields = new Map(source.fields.map(f => [f.path, f]));
    assert.equal(actual.winnerPlugin, source.winner);
    assert.deepEqual(actual.data.skillWeights, skillNames.map(s => Number(fields.get('SkillWeights[' + s + ']').value)));
    assert.deepEqual(actual.data.statWeights, ['Health', 'Magicka', 'Stamina'].map(s => Number(fields.get('StatWeights[' + s + ']').value)));
    for (const [key, path] of Object.entries({bleedoutDefault:'BleedoutDefault',voicePoints:'VoicePoints',unknown:'Unknown',unknown2:'Unknown2'})) {
      assert.equal(actual.data[key], Number(fields.get(path).value));
    }
    assert.equal(actual.data.isDeleted, fields.get('IsDeleted').value === 'True');
  }
});

test('CLAS absent fields and mismatched epochs fail explicitly; stale record signatures are refused', async () => {
  const fixture = workspace + '_work/evidence/DS-2d/clas-fixture'; await mkdir(fixture, {recursive:true});
  const source = structuredClone(row('CLAS', '017008:Skyrim.esm'));
  source.fields = source.fields.filter(f => f.path !== 'SkillWeights[Block]');
  source.fields.find(f => f.path === 'StatWeights[Health]').value = 'NaN';
  async function write(type, records, epoch = npcDomain.exportEpoch) {
    await writeFile(fixture + '/' + type + '.jsonl', [JSON.stringify({housecarl_artifact:1,row_count:records.length,epoch}), ...records.map(r=>JSON.stringify(r))].join('\n')+'\n');
  }
  await write('NPC_', [row('NPC_', '023ABE:Skyrim.esm')]); await write('CLAS', [source]);
  const partial = await buildNpcsDomain(fixture, plugins);
  const actual = partial.records.find(r => r.recordType === 'CLAS');
  assert.equal(actual.data.skillWeights[3], null); assert.equal(actual.data.statWeights[0], null);
  assert(actual.data.unavailable.includes('SkillWeights[Block]'));
  assert(partial.unsupported.some(u => u.reason === 'Class: CLAS absent from exports'));
  await write('CLAS', [source], 'wrong-epoch');
  await assert.rejects(buildNpcsDomain(fixture, plugins), /different epochs/);
  for (const type of ['NPC_', 'CLAS']) {
    const corrupt = structuredClone(npcDomain), record = corrupt.records.find(r => r.recordType === type);
    if (type === 'NPC_') record.data.fields[0] = !record.data.fields[0]; else record.data.skillWeights[0]++;
    // Re-sign only the container, so the stale definition signature must still be detected.
    corrupt.signature = contentSignature(corrupt);
    const refused = loadDomain(corrupt, createFileHost(catalogApi([corrupt]), dataDir, [corrupt]));
    assert.equal(refused.status, 'UNSUPPORTED'); assert(refused.issues.some(s => s.includes('Record content signature mismatch')));
  }
});

// DS-2d fixtures are mutations of exported records and are confined to evidence.
async function fixtureWriter(name, initial) {
  const dir = workspace + '_work/evidence/DS-2d/' + name;
  await mkdir(dir, {recursive:true});
  const write = async (sig, records, epoch=domain.exportEpoch) => writeFile(dir+'/'+sig+'.jsonl',
    [JSON.stringify({housecarl_artifact:1,row_count:records.length,epoch}),...records.map(JSON.stringify)].join('\n')+'\n');
  for (const [sig,records] of Object.entries(initial)) await write(sig,records);
  return {dir,write};
}
const sourceValue = (source,path) => source.fields.find(f=>f.path===path)?.value;
const stableAddress = address => {
  const [local,plugin] = address.split(':'); return plugin.toLowerCase()+'|'+local.toUpperCase();
};

test('Q15a all template combat columns match terminal export winners; item enchantment remains local', () => {
  const counts = {WEAP:0,ARMO:0};
  for (const actual of domain.records.filter(r=>r.data.template)) {
    const sig=actual.recordType, columns=sig==='WEAP'?WEAPON_COMBAT_FIELDS:ARMOR_COMBAT_FIELDS;
    const path=sig==='WEAP'?'Template':'TemplateArmor';
    const source=row(sig,encodeFormKey(actual.stableFormKey,'housecarl',actual.pluginKind));
    let current=source; const chain=[stableAddress(source.formid)], seen=new Set(chain);
    while (sourceValue(current,path)) {
      current=row(sig,sourceValue(current,path));
      assert(!seen.has(stableAddress(current.formid))); seen.add(stableAddress(current.formid)); chain.push(stableAddress(current.formid));
    }
    assert.equal(actual.data.template.status,'SUPPORTED');
    assert.deepEqual(actual.data.template.chain,chain);
    assert.equal(actual.data.template.provider,chain.at(-1));
    for(const [i,p] of columns.entries()) {
      const exported=sourceValue(current,p), value=actual.data.fields[p];
      if (typeof value==='number') assert.equal(value,Number(exported),actual.stableFormKey+':'+p);
      else if (typeof value==='string' && value.includes('|')) assert.equal(value,stableAddress(exported));
      else if (value!==null) assert.equal(value,exported);
      const local=sourceValue(source,p), saved=actual.data.template.localValues[i];
      if(typeof saved==='number') assert.equal(saved,Number(local));
    }
    const ench=sourceValue(source,'ObjectEffect');
    assert.equal(actual.data.fields.ObjectEffect,ench?stableAddress(ench):null);
    if(actual.data.fields[columns[0]]!==actual.data.template.localValues[0]) counts[sig]++;
  }
  assert.deepEqual(counts,{WEAP:2327,ARMO:461});
  console.log('Q15a changed base values:',JSON.stringify(counts));
});

test('Q15a chained/cyclic/missing/wrong-type/deleted and incomplete template stats never fall back to local stats', async () => {
  const weapon=structuredClone(row('WEAP','01397E:Skyrim.esm'));
  const armor=structuredClone(row('ARMO','012E46:Skyrim.esm'));
  const a=structuredClone(weapon), b=structuredClone(weapon), c=structuredClone(weapon);
  a.formid='000101:Skyrim.esm'; b.formid='000102:Skyrim.esm'; c.formid='000103:Skyrim.esm';
  const link=(r,path,to)=> {const f=r.fields.find(f=>f.path===path); delete f.note; f.value=to;};
  link(a,'Template',b.formid);link(b,'Template',c.formid);
  a.fields.find(f=>f.path==='BasicStats.Damage').value='999';
  b.fields.find(f=>f.path==='BasicStats.Damage').value='888';
  const fixture=await fixtureWriter('equipment-fixture',{WEAP:[a,b,c],ARMO:[armor],AMMO:[],RACE:[],KYWD:[]});
  const get=async()=>{const d=await buildCombatDomain(fixture.dir,plugins);return d.records.find(r=>r.stableFormKey===stableAddress(a.formid));};
  let actual=await get();assert.equal(actual.data.template.chain.length,3);
  assert.equal(actual.data.fields['BasicStats.Damage'],Number(sourceValue(c,'BasicStats.Damage')));
  c.fields=c.fields.filter(f=>f.path!=='Data.Speed');await fixture.write('WEAP',[a,b,c]);actual=await get();
  assert.equal(actual.data.fields['Data.Speed'],null);assert(actual.data.exportNotes['Data.Speed']);
  link(c,'Template',a.formid);await fixture.write('WEAP',[a,b,c]);actual=await get();
  assert.match(actual.data.template.reason,/cycle/);assert.equal(actual.data.fields['BasicStats.Damage'],null);
  await fixture.write('WEAP',[a]);actual=await get();assert.match(actual.data.template.reason,/absent/);
  link(a,'Template',armor.formid);await fixture.write('WEAP',[a]);actual=await get();assert.match(actual.data.template.reason,/outside record type/);
  link(a,'Template',b.formid); b.fields.find(f=>f.path==='IsDeleted').value='True';await fixture.write('WEAP',[a,b]);actual=await get();
  assert.match(actual.data.template.reason,/deleted/);assert.equal(actual.data.fields['BasicStats.Damage'],null);
  const ar=structuredClone(armor),base=structuredClone(armor);ar.formid='000201:Skyrim.esm';base.formid='000202:Skyrim.esm';
  link(ar,'TemplateArmor',base.formid);ar.fields.find(f=>f.path==='ArmorRating').value='999';
  await fixture.write('ARMO',[ar,base]);const d=await buildCombatDomain(fixture.dir,plugins);
  assert.equal(d.records.find(r=>r.stableFormKey===stableAddress(ar.formid)).data.fields.ArmorRating,Number(sourceValue(base,'ArmorRating')));
});

test('Q15 effect definitions reproduce independently of plugin order and agree with exports by FormID', async () => {
  const rebuilt=await buildEffectsDomain(exportsDir,[...plugins].reverse());
  assert.equal(canonicalJson(rebuilt)+'\n',await readFile(core+'catalog/effects.json','utf8'));
  const mgefs=effectsDomain.records.filter(r=>r.recordType==='MGEF'), selected=new Set(mgefs.map(r=>r.stableFormKey));
  assert.deepEqual(new Set(mgefs.map(r=>r.data.family)),new Set(['ONE_HANDED','TWO_HANDED','ARCHERY','UNARMED','POWER_ATTACK','BASH','ARMOR_RATING','BLOCK','RESIST_ARROW_BLOCKING','RESIST_POWER_BLOCKING','SNEAK_ATTACK']));
  for(const actual of mgefs) {
    const source=row('MGEF',encodeFormKey(actual.stableFormKey,'housecarl',actual.pluginKind));
    assert.equal(actual.winnerPlugin,source.winner);
    for(const [i,p] of EFFECT_FIELDS.entries()) {
      const exported=sourceValue(source,p);
      assert.equal(actual.data.fields[i],exported===undefined?null:exported.includes(':')?stableAddress(exported):exported);
    }
    if(actual.data.family==='SNEAK_ATTACK') assert.equal(actual.data.enabled,false);
    assert.equal(actual.data.activation,'UNSUPPORTED');
    if(actual.data.controller) {
      const p=row('PERK',encodeFormKey(actual.data.controller.key,'housecarl','FULL'));
      const prefix=actual.data.controller.entry;
      assert.equal(actual.data.entryPoint,sourceValue(p,prefix+'.EntryPoint'));
      assert.equal(actual.data.controller.coefficient,Number(sourceValue(p,prefix+'.Value')));
    }
  }
  let selectedEffects=0,excludedEffects=0;
  for(const actual of effectsDomain.records.filter(r=>r.recordType!=='MGEF')) {
    const source=row(actual.recordType,encodeFormKey(actual.stableFormKey,'housecarl',actual.pluginKind));
    assert.equal(actual.data.magnitudeSource,'PREMADE_RECORD_ONLY');
    assert.equal(actual.data.activation,'UNSUPPORTED');
    for(const [key,magnitude,duration,area,index,unconditional] of actual.data.effects) {
      const prefix='Effects['+index+']'; assert(selected.has(key));
      assert.equal(key,stableAddress(sourceValue(source,prefix+'.BaseEffect')));
      assert.equal(magnitude,Number(sourceValue(source,prefix+'.Data.Magnitude')));
      assert.equal(duration,Number(sourceValue(source,prefix+'.Data.Duration')));
      assert.equal(area,Number(sourceValue(source,prefix+'.Data.Area')));
      assert.equal(unconditional,source.fields.find(f=>f.path===prefix+'.Conditions')?.note==='[list: 0 item(s)]');
      selectedEffects++;
    }
    assert.equal(actual.data.totalEffects,actual.data.effects.length+actual.data.excludedEffects);
    excludedEffects+=actual.data.excludedEffects;
  }
  console.log('Q15 closure:',mgefs.length,'MGEF;',selectedEffects,'selected carrier effects;',excludedEffects,'omitted effects within selected carriers');
});

test('Q15 family classifier follows fields even after renaming; hostile effects, unknown flags and missing magnitude stay explicit', async () => {
  const m=structuredClone(row('MGEF','07A0FF:Skyrim.esm'));
  m.editorid='UnrelatedName';for(const f of m.fields.filter(f=>/^(EditorID|Name|Description)$/.test(f.path)))f.value='unrelated text';
  assert.equal(physicalEffectRule(m)[0],'ONE_HANDED');
  m.fields.find(f=>f.path==='Archetype.ActorValue').value='Magicka';assert.equal(physicalEffectRule(m),undefined);
  m.fields.find(f=>f.path==='Archetype.ActorValue').value='OneHandedPowerModifier';
  m.fields.find(f=>f.path==='Flags').value='Hostile, Detrimental';assert.equal(physicalEffectRule(m),undefined);
  m.fields.find(f=>f.path==='Flags').value='UnknownFlag';
  const carrier=structuredClone([...sources.get('ENCH').records.values()].find(r=>r.fields.some(f=>f.value==='07A0FF:Skyrim.esm')));
  const magnitudePath=carrier.fields.find(f=>f.path.endsWith('.BaseEffect')&&f.value===m.formid).path.replace('BaseEffect','Data.Magnitude');
  carrier.fields=carrier.fields.filter(f=>f.path!==magnitudePath);
  const f=await fixtureWriter('effects-fixture',{MGEF:[m],ENCH:[carrier],ALCH:[],PERK:[row('PERK','0A725C:Skyrim.esm')]});
  const partial=await buildEffectsDomain(f.dir,plugins);
  assert(partial.records.find(r=>r.recordType==='MGEF').data.reasons.includes('unknown effect flags'));
  const actual=partial.records.find(r=>r.recordType==='ENCH');assert.equal(actual.data.effects[0][1],null);
  assert.equal(actual.data.definitionStatus,'UNSUPPORTED');assert(actual.data.unavailable.includes(magnitudePath));
  await f.write('PERK',[]);const noController=await buildEffectsDomain(f.dir,plugins);
  assert(noController.records.find(r=>r.recordType==='MGEF').data.reasons.includes('controller entry point unavailable'));
  await f.write('ALCH',[],'other-epoch');await assert.rejects(buildEffectsDomain(f.dir,plugins),/different epochs/);
});
