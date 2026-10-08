import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createStableFormKey } from '../../contracts/src/identity.ts';
import type { CatalogSignature, CharacterKey, DefinitionRef, RuntimeFormId, StableFormKey } from '../../contracts/src/identity.ts';
import { contentSignature, decodeFormKey, encodeFormKey, loadDomain, recordSignature } from '../src/index.ts';
import type { CatalogHost, DomainData, PluginFingerprint } from '../src/types.ts';
import { createFileHost } from '../../../tools/catalog/host.ts';
import { buildDomains } from '../../../tools/catalog/build.ts';
import { parseHostPort } from '../../../tools/catalog/real-host.ts';
import { compose, effectiveSet } from '../../../modules/actor-state-system/src/index.ts';

const readDomain = (name: string): DomainData => JSON.parse(readFileSync(new URL(`../../../catalog/${name}.json`, import.meta.url), 'utf8')) as DomainData;
const stones = readDomain('standing-stones');
const races = readDomain('races');
const exportDir = new URL('../../../../_work/exports/', import.meta.url);
const metadata = JSON.parse(readFileSync(new URL('../../../../aetherius-server/build/dist/server/data/aetherius-loadorder.json', import.meta.url), 'utf8')) as { plugins: PluginFingerprint[] };
const key = (local: number, plugin = 'Skyrim.esm', kind: 'FULL' | 'LIGHT' = 'FULL') => createStableFormKey(plugin, local, kind);

/** Numeric return + nested {record:{type}} (missing -> {}) match ScampServer.cpp
 * GetIdFromDesc at 1361 and LookupEspmRecordById at 1137/1175, FormDesc.cpp.
 * Host-issued numbers are opaque: no plugin slots/indices are simulated in Core.
 * Distinct resolver snapshots represent a reordered full and light namespace. */
function simulated(data: DomainData, changed = false): CatalogHost {
  const ids = new Map(data.records.map((r, i) => [r.stableFormKey,
    (r.pluginKind === 'LIGHT' ? changed ? 4263000000 : 4262000000 : changed ? 6000000 : 3000000) + i]));
  return { plugins: () => changed ? [...data.dependencies].reverse() : data.dependencies,
    getIdFromDesc(desc) {
      const filename = desc.slice(desc.indexOf(':') + 1);
      const p = data.dependencies.find(d => d.filename.toLowerCase() === filename.toLowerCase());
      if (!p) throw new Error('Plugin absent');
      const k = decodeFormKey(desc, 'skymp', p.isLight ? 'LIGHT' : 'FULL');
      return ids.get(k) ?? 0;
    },
    lookupEspmRecordById(id) {
      const k = [...ids.entries()].find(([, n]) => n === id)?.[0];
      const raw = k ? { record: { type: data.records.find(r => r.stableFormKey === k)!.recordType } } : {};
      return { type: raw.record?.type ?? '' };
    } };
}

for (const [plugin, local, kind] of [
  ['Skyrim.esm', 0xe5f4c, 'FULL'], ['Plugin With Spaces.esp', 0x123, 'FULL'],
  ['Light.esl', 0x818, 'LIGHT'], ['Light With Spaces.esp', 1, 'LIGHT']
] as const) for (const spelling of ['canonical', 'housecarl', 'damage', 'skymp'] as const) {
  test(`codec ${spelling} ${plugin}`, () => {
    const k = key(local, plugin, kind);
    const encoded = encodeFormKey(k, spelling, kind, plugin);
    assert.equal(decodeFormKey(encoded, spelling, kind), k);
    if (spelling === 'skymp') assert.equal(encoded, `${local.toString(16)}:${plugin}`);
    assert.equal(encodeFormKey(decodeFormKey(encoded, spelling, kind), spelling, kind, plugin), encoded);
  });
}
test('codecs reject oversized/null/local ranges, paths and incompatible filenames', () => {
  assert.throws(() => decodeFormKey(`${'0'.repeat(2)}0E5F4C:Skyrim.esm`, 'housecarl', 'FULL'));
  assert.throws(() => decodeFormKey('001000:Light.esp', 'housecarl', 'LIGHT'));
  assert.throws(() => decodeFormKey('000000:Light.esl', 'housecarl', 'LIGHT'));
  assert.throws(() => decodeFormKey('000001:../Bad.esp', 'housecarl', 'FULL'));
  assert.throws(() => encodeFormKey(key(1), 'skymp', 'FULL', 'Other.esm'));
});

test('builder is byte deterministic and exported selectors map all stones including Apprentice negative', async () => {
  const { fileURLToPath } = await import('node:url');
  const generated = await buildDomains(fileURLToPath(exportDir), metadata.plugins);
  assert.deepEqual(generated, await buildDomains(fileURLToPath(exportDir), metadata.plugins));
  assert.deepEqual(generated, [stones, races]);
  assert.equal(stones.roots.length, 13);
  for (const [activator, spell] of [[0xd232d, 0xe5f4c], [0xd232e, 0xe5f47], [0xd232f, 0xe5f45]]) {
    assert.deepEqual(stones.records.find(r => r.stableFormKey === key(activator!))!.data.spells, [key(spell!)]);
  }
  assert.deepEqual(stones.records.find(r => r.stableFormKey === key(0xd2331))!.data.spells, [key(0xe5f4e), key(0x10e439)]);
  const sprint = stones.unsupported.find(r => r.stableFormKey === key(0x818, 'Mundus.esp'));
  assert.equal(sprint?.status, 'UNSUPPORTED');
  assert.match(sprint!.reason, /No activator script property/);
  assert.ok(stones.records.filter(r => r.recordType === 'ACTI').every(r => r.data.grantStatus === 'SUPPORTED'));
});
test('every playable race and its grants match winner fields, without localized-name matching', () => {
  const rows = readFileSync(new URL('RACE.jsonl', exportDir), 'utf8').trim().split(/\r?\n/).slice(1).map(line => JSON.parse(line) as { formid: string; fields: { path: string; value?: string }[] });
  const playable = rows.filter(row => row.fields.some(f => f.path === 'Flags' && f.value?.split(/,\s*/).includes('Playable')));
  assert.equal(playable.length, 10);
  assert.equal(races.roots.length, 10);
  for (const row of playable) {
    const record = races.records.find(r => r.stableFormKey === decodeFormKey(row.formid, 'housecarl', 'FULL'))!;
    assert.equal(record.winnerPlugin, 'AETHERIUS - BALANCE.esp');
    assert.deepEqual(record.data.actorEffects, row.fields.filter(f => /^ActorEffect\[\d+\]$/.test(f.path)).map(f => decodeFormKey(f.value!, 'housecarl', 'FULL')));
    assert.deepEqual(record.data.starting, Object.fromEntries(['Health', 'Magicka', 'Stamina'].map(stat => [stat, Number(row.fields.find(f => f.path === `Starting[${stat}]`)!.value)])));
  }
});
for (const data of [stones, races]) test(`immutable boot-only lookup and port checks: ${data.domain}`, () => {
  const host = simulated(data);
  const catalog = loadDomain(data, host);
  assert.equal(catalog.status, 'SUPPORTED', catalog.issues.join('; '));
  host.getIdFromDesc = () => { throw new Error('No host access after boot'); };
  host.plugins = () => { throw new Error('No host access after boot'); };
  const record = catalog.roots[0]!;
  assert.equal(catalog.byKey(record.definition.stableFormKey), record);
  assert.equal(catalog.byRuntimeId(record.runtimeFormId), record);
  assert.equal(catalog.resolve(record.definition.stableFormKey, record.definition.catalogSignature).status, 'SUPPORTED');
  assert.equal(catalog.lookup(record.definition).status, 'SUPPORTED');
  assert.equal(catalog.lookup({ ...record.definition, recordType: 'WEAP' }).status, 'UNSUPPORTED');
  assert.equal(catalog.resolve(record.definition.stableFormKey, 'stale' as CatalogSignature).status, 'UNSUPPORTED');
  assert.throws(() => { (record.data as Record<string, unknown>).editorId = 'changed'; });
  assert.throws(() => { (catalog.roots as unknown[]).push(record); });
  assert.equal(Object.isFrozen(data), false);
});
test('full and light defining records survive different host namespaces', () => {
  const full = stones.records.find(r => r.definingPlugin === 'Mundus.esp')!;
  const lightKey = key(0x818, 'Test Light.esp', 'LIGHT');
  const payload = { ...stones, records: [...stones.records, { ...full, stableFormKey: lightKey, definingPlugin: 'Test Light.esp', pluginKind: 'LIGHT' as const, winnerPlugin: 'Test Light.esp' }],
    dependencies: [...stones.dependencies, { filename: 'Test Light.esp', size: 12, crc32: -1, isLight: true }] };
  const data = signedDomain(payload);
  const first = loadDomain(data, simulated(data));
  const reordered = loadDomain(data, simulated(data, true));
  assert.equal(first.status, 'SUPPORTED');
  assert.equal(reordered.status, 'SUPPORTED');
  for (const record of first.records) {
    const other = reordered.byKey(record.definition.stableFormKey)!;
    assert.deepEqual({ ...record, runtimeFormId: null }, { ...other, runtimeFormId: null });
    assert.notEqual(record.runtimeFormId, other.runtimeFormId);
  }
  assert.notEqual(first.byKey(lightKey)!.runtimeFormId, reordered.byKey(lightKey)!.runtimeFormId);
});

/** Re-sign explicit fixture edits as the offline builder would. */
function signedDomain(input: DomainData): DomainData {
  const payload = { ...input, records: input.records.map(record => ({ ...record,
    signature: recordSignature(record, input.dependencies.find(p => p.filename.toLowerCase() === record.definingPlugin.toLowerCase())!) })) };
  return { ...payload, signature: contentSignature(payload) };
}

test('one exported record in two fixture domains composes with both origins', async () => {
  // Fixture changes one race ActorEffect to reference the real Warrior spell;
  // all other selected rows retain export content. No new production domain.
  const generated = await buildDomains(fileURLToPath(new URL('./fixtures/overlap/', import.meta.url)), metadata.plugins);
  const [stoneData, raceData] = generated as [DomainData, DomainData];
  assert.notEqual(stoneData.signature, raceData.signature);
  const stoneCatalog = loadDomain(stoneData, simulated(stoneData));
  const raceCatalog = loadDomain(raceData, simulated(raceData, true));
  assert.equal(stoneCatalog.status, 'SUPPORTED', stoneCatalog.issues.join('; '));
  assert.equal(raceCatalog.status, 'SUPPORTED', raceCatalog.issues.join('; '));
  const shared = key(0xe5f4c);
  const first = stoneCatalog.byKey(shared)!.definition as DefinitionRef<'SPEL'>;
  const second = raceCatalog.byKey(shared)!.definition as DefinitionRef<'SPEL'>;
  assert.deepEqual(first, second);
  assert.equal(stoneCatalog.lookup(second).status, 'SUPPORTED');
  assert.equal(raceCatalog.lookup(first).status, 'SUPPORTED');
  assert.equal(raceCatalog.resolve(shared, first.catalogSignature).status, 'SUPPORTED');
  const composed = compose('profile:1' as CharacterKey, [
    [{ kind: 'ability', definition: first, source: { kind: 'STANDING_STONE', key: 'warrior' }, revision: 1 }],
    [{ kind: 'ability', definition: second, source: { kind: 'RACE', key: raceData.roots[0]! }, revision: 1 }]
  ], { facts: 1, grants: 1, equipment: 0, effects: 0, catalog: 1 });
  assert.equal(composed.grants.length, 2);
  const effective = effectiveSet(composed);
  assert.equal(effective.grants.length, 1);
  assert.deepEqual(effective.grants[0]!.sources.map(s => s.kind).sort(), ['RACE', 'STANDING_STONE']);
});

test('editing one record changes only its signature and rejects its previous reference', () => {
  const original = loadDomain(stones, simulated(stones));
  const target = original.records.find(r => r.definition.recordType === 'SPEL')!;
  const modified = signedDomain({ ...stones, records: stones.records.map(r => r.stableFormKey === target.definition.stableFormKey
    ? { ...r, data: { ...r.data, spellType: 'fixture-edited' } } : r) });
  const current = loadDomain(modified, simulated(modified));
  assert.equal(current.status, 'SUPPORTED');
  assert.notEqual(current.signature, original.signature);
  for (const prior of original.records) {
    const next = current.byKey(prior.definition.stableFormKey)!;
    if (prior === target) {
      assert.notEqual(next.definition.catalogSignature, prior.definition.catalogSignature);
      assert.equal(current.lookup(prior.definition).status, 'UNSUPPORTED');
      assert.equal(current.resolve(prior.definition.stableFormKey, prior.definition.catalogSignature).status, 'UNSUPPORTED');
    } else {
      assert.equal(next.definition.catalogSignature, prior.definition.catalogSignature);
      assert.equal(current.lookup(prior.definition).status, 'SUPPORTED');
    }
  }
});

for (const field of ['size', 'crc32', 'isLight'] as const) test(`defining plugin ${field} changes only its records' signatures`, () => {
  // Mundus also wins Skyrim-defined records: those must retain their signature.
  const before = new Map(stones.records.map(r => [r.stableFormKey, r.signature]));
  const modified = signedDomain({ ...stones, dependencies: stones.dependencies.map(p => p.filename === 'Mundus.esp'
    ? { ...p, [field]: field === 'isLight' ? !p.isLight : field === 'size' ? p.size + 1 : p.crc32 ^ 1 } : p) });
  const own = modified.records.filter(r => r.definingPlugin === 'Mundus.esp');
  const other = modified.records.filter(r => r.definingPlugin !== 'Mundus.esp');
  assert.ok(own.length && other.length);
  assert.notEqual(modified.signature, stones.signature);
  for (const record of own) assert.notEqual(record.signature, before.get(record.stableFormKey));
  for (const record of other) assert.equal(record.signature, before.get(record.stableFormKey));
  // Kind change cannot be reconciled with the old record namespaces.
  const catalog = loadDomain(modified, simulated(modified));
  assert.equal(catalog.status, field === 'isLight' ? 'UNSUPPORTED' : 'SUPPORTED');
});

test('domain metadata, siblings and unrelated dependencies do not version an existing record', () => {
  const before = loadDomain(stones, simulated(stones));
  const payload = { ...stones, domain: 'races' as const, exportEpoch: 'fixture-other-epoch',
    dependencies: [...stones.dependencies, { filename: 'Unrelated.esp', size: 12, crc32: 1, isLight: false }],
    records: stones.records.slice(0, -1), roots: [stones.records[0]!.stableFormKey], unsupported: [] };
  const modified = { ...payload, signature: contentSignature(payload) };
  const after = loadDomain(modified, simulated(modified, true));
  assert.equal(after.status, 'SUPPORTED', after.issues.join('; '));
  assert.notEqual(after.signature, before.signature);
  for (const record of after.records) assert.equal(record.definition.catalogSignature,
    before.byKey(record.definition.stableFormKey)!.definition.catalogSignature);
});

test('ports reject domain, another record and stale signatures; tampered record signature blocks boot', () => {
  const catalog = loadDomain(stones, simulated(stones));
  const first = catalog.records[0]!, other = catalog.records[1]!;
  assert.notEqual(first.definition.catalogSignature, other.definition.catalogSignature);
  for (const signature of [stones.signature, other.definition.catalogSignature, 'stale' as CatalogSignature]) {
    assert.equal(catalog.resolve(first.definition.stableFormKey, signature).status, 'UNSUPPORTED');
    assert.equal(catalog.lookup({ ...first.definition, catalogSignature: signature }).status, 'UNSUPPORTED');
  }
  const payload = { ...stones, records: stones.records.map((r, i) => i === 0 ? { ...r, signature: stones.signature } : r) };
  const modified = { ...payload, signature: contentSignature(payload) };
  assert.match(loadDomain(modified, simulated(modified)).issues.join('; '), /Record content signature mismatch/);
});

test('real-host requires an explicit valid UDP port without opening a native server', () => {
  assert.equal(parseHostPort('7791'), 7791);
  for (const input of [undefined, '', '0', '-1', '65536', '1.5', 'NaN', '7791;exit', ' 7791']) {
    assert.throws(() => parseHostPort(input), /Explicit UDP port required/);
  }
});
for (const kind of ['missing', 'crc', 'size', 'light'] as const) test(`plugin ${kind} blocks only dependent domain`, () => {
  const host = simulated(stones);
  host.plugins = () => stones.dependencies.filter(p => kind !== 'missing' || p.filename !== 'Mundus.esp').map(p => p.filename === 'Mundus.esp' ? { ...p,
    crc32: kind === 'crc' ? p.crc32 ^ 1 : p.crc32, size: kind === 'size' ? p.size + 1 : p.size, isLight: kind === 'light' ? !p.isLight : p.isLight } : p);
  const catalog = loadDomain(stones, host);
  assert.equal(catalog.status, 'UNSUPPORTED');
  assert.match(catalog.issues.join('; '), /Mundus\.esp/);
  assert.equal(catalog.records.length, 0);
  assert.equal(loadDomain(races, simulated(races)).status, 'SUPPORTED');
});
test('mapping a missing record, wrong types and exceptions are unsupported', () => {
  for (const inspection of [() => ({ type: '' }), () => ({ type: 'WEAP' }), () => { throw new Error('lookup failed'); }]) {
    const host = simulated(stones);
    host.lookupEspmRecordById = inspection;
    const catalog = loadDomain(stones, host);
    assert.equal(catalog.status, 'UNSUPPORTED');
    assert.equal(catalog.byKey(stones.roots[0]!), undefined);
  }
});
test('unreadable relevant file blocks its domain, unrelated file errors are ignored', () => {
  const host = simulated(stones);
  host.plugins = () => [...stones.dependencies.filter(p => p.filename !== 'Mundus.esp'),
    { filename: 'Mundus.esp', status: 'UNSUPPORTED', reason: 'File is unreadable' }];
  assert.match(loadDomain(stones, host).issues.join('; '), /fingerprint unavailable.*File is unreadable/);
  const raceHost = simulated(races);
  raceHost.plugins = () => [...races.dependencies, { filename: 'Mundus.esp', status: 'UNSUPPORTED', reason: 'File is unreadable' }];
  assert.equal(loadDomain(races, raceHost).status, 'SUPPORTED');
});
test('invalid ids, dynamic records, collisions and resolver exceptions block boot', () => {
  for (const resolver of [() => 0, () => NaN, () => -1, () => 2 ** 32, () => 255 * 2 ** 24 + 1, () => 123, () => { throw new Error('resolve failed'); }]) {
    const host = simulated(stones);
    host.getIdFromDesc = resolver;
    host.lookupEspmRecordById = () => ({ type: 'ACTI' });
    assert.equal(loadDomain(stones, host).status, 'UNSUPPORTED');
  }
});
test('tampering, inconsistent metadata and duplicate records cannot expose a partial catalog', () => {
  const changed = structuredClone(stones);
  (changed.records[0]!.data as Record<string, unknown>).editorId = 'tampered';
  assert.match(loadDomain(changed, simulated(changed)).issues.join('; '), /content signature/);
  const duplicate = { ...stones, records: [...stones.records, stones.records[0]!] };
  assert.equal(loadDomain({ ...duplicate, signature: contentSignature(duplicate) }, simulated(duplicate)).status, 'UNSUPPORTED');
  const wrongKind = { ...stones, records: stones.records.map(r => ({ ...r, definingPlugin: 'Other.esp' })) };
  assert.equal(loadDomain({ ...wrongKind, signature: contentSignature(wrongKind) }, simulated(wrongKind)).status, 'UNSUPPORTED');
});
test('file adapter uses the host nested record shape and actual relevant signed CRC metadata', () => {
  const api = { getEspmLoadOrder: () => ['Skyrim.esm'], getIdFromDesc: () => 10,
    lookupEspmRecordById: () => ({ record: { type: 'SPEL' } }) };
  const host = createFileHost(api, fileURLToPath(new URL('../../../../aetherius-server/build/dist/server/data', import.meta.url)), [stones]);
  assert.deepEqual(host.plugins(), [stones.dependencies.find(p => p.filename === 'Skyrim.esm')]);
  assert.deepEqual(host.lookupEspmRecordById(10), { type: 'SPEL' });
});
