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
  "export { loadDomain, canonicalJson, encodeFormKey, recordSignature } from './shared/record-catalog/src/index.ts';",
  "export { createFileHost } from './tools/catalog/host.ts';"
].join('\n'), resolveDir: core }, bundle: true, platform: 'node', format: 'esm', write: false });
const { buildCombatDomain, loadDomain, canonicalJson, encodeFormKey, recordSignature, createFileHost } =
  await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const domain = JSON.parse(await readFile(core + 'catalog/combat.json', 'utf8'));
const families = ['WEAP', 'ARMO', 'AMMO', 'RACE', 'KYWD'];
const sources = new Map(await Promise.all(families.map(async name => {
  const lines = (await readFile(exportsDir + '/' + name + '.jsonl', 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  return [name, { manifest: lines.shift(), records: new Map(lines.map(row => [row.formid.toLowerCase(), row])) }];
})));
const row = (type, address) => {
  const result = sources.get(type).records.get(address.toLowerCase());
  assert.ok(result, 'Required source FormID: ' + address); return result;
};
const byAddress = new Map(domain.records.map(r => [encodeFormKey(r.stableFormKey, 'housecarl', r.pluginKind).toLowerCase(), r]));
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
  for (const sig of families.filter(s => s !== 'KYWD')) {
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
  assert(domain.unsupported.some(u => u.stableFormKey === find('01320A:Skyrim.esm').stableFormKey && u.reason.includes('AttackData')));
});

test('reordered full and light plugins change runtime IDs; domain and every record signature remain identical', () => {
  console.log('reordering: resolving original');
  const a = loadDomain(domain, createFileHost(catalogApi([domain]), dataDir, [domain]));
  console.log('reordering: resolving reordered');
  const b = loadDomain(domain, createFileHost(catalogApi([domain], true), dataDir, [domain]));
  console.log('reordering: comparing', a.status, b.status);
  assert.equal(a.status, 'SUPPORTED', a.issues.join('; ')); assert.equal(b.status, 'SUPPORTED', b.issues.join('; '));
  assert.equal(a.signature, b.signature);
  for (const r of a.records) {
    const moved = b.byKey(r.definition.stableFormKey); assert.ok(moved);
    assert.equal(moved.definition.catalogSignature, r.definition.catalogSignature);
    assert.deepEqual(moved.data, r.data);
  }
  assert(a.records.some(r => r.pluginKind === 'FULL' && r.runtimeFormId !== b.byKey(r.definition.stableFormKey).runtimeFormId));
  assert(a.records.some(r => r.pluginKind === 'LIGHT' && r.runtimeFormId !== b.byKey(r.definition.stableFormKey).runtimeFormId));
  const record = domain.records.find(r => r.pluginKind === 'LIGHT');
  const absent = catalogApi([domain]); const lookup = absent.lookupEspmRecordById;
  const missingId = absent.getIdFromDesc(encodeFormKey(record.stableFormKey, 'skymp', record.pluginKind));
  absent.lookupEspmRecordById = id => id === missingId ? {} : lookup(id);
  const refused = loadDomain(domain, createFileHost(absent, dataDir, [domain]));
  assert.equal(refused.status, 'UNSUPPORTED'); assert.equal(refused.records.length, 0);
  console.log('reordering PASSED: FULL and LIGHT runtime IDs changed; signatures/data identical; absent winner refused');
});

test('boot loads combat with createFileHost; damage declares DS-4/DS-5 rather than a missing catalog', async () => {
  const domains = await Promise.all(['standing-stones', 'races', 'classes', 'combat'].map(async n => JSON.parse(await readFile(core + 'catalog/' + n + '.json', 'utf8'))));
  const mp = Object.assign(fakeHost(), catalogApi(domains));
  mp.getServerSettings = () => ({ dataDir });
  const require = createRequire(import.meta.url);
  const runtime = require('../../dist/aetherius-gameplay-core.cjs').createGameplayCore({ mp, pg: unavailablePg, log: logger(), env: { GAMEPLAY_CORE_MODE_COMBAT_PROBE: 'audit' } });
  let started = false;
  runtime.register({ id: 'combat-probe', domain: 'combat', requiresDatabase: false, start(context) {
    started = true; assert.equal(context.catalog.records.length, domain.records.length);
  } });
  await runtime.initialize();
  try {
    assert.equal(started, true);
    const damage = runtime.capabilityReport().systems.find(s => s.id === 'damage');
    assert.equal(damage.catalog.domain, 'combat'); assert.equal(damage.catalog.status, 'SUPPORTED');
    assert.equal(damage.status, 'UNSUPPORTED');
    assert(damage.missing.some(s => s.includes('COMBAT_PROFILE_PROJECTION_NOT_DELIVERED')));
    assert(damage.missing.some(s => s.includes('NATIVE_COMBAT_CATALOG_BRIDGE_NOT_DELIVERED')));
    assert(!damage.missing.some(s => s.includes('Catalog domain damage not delivered')));
  } finally { await runtime.shutdown(); }
});

test('missing fields, invalid numbers, missing keywords, epochs and metadata never gain defaults', async () => {
  const fixture = workspace + '_work/evidence/DS-2/generator-fixture'; await mkdir(fixture, { recursive: true });
  const fixtureRows = {
    WEAP: [row('WEAP', '01397E:Skyrim.esm')], ARMO: [row('ARMO', '012E46:Skyrim.esm')],
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
