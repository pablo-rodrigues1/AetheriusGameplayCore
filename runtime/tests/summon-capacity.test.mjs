import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const compiled = await build({ absWorkingDir: root, stdin: { loader: 'ts', resolveDir: root, contents: `
  export {composeSummonCapacity, SummonCapacityProjection} from './runtime/src/summon-capacity.ts';
  export {classGrants} from './modules/class-progression-system/src/index.ts';
  export {standingStoneGrants} from './modules/standing-stone-system/src/provider.ts';
` }, bundle: true, platform: 'node', format: 'esm', write: false });
const { composeSummonCapacity, SummonCapacityProjection, classGrants, standingStoneGrants } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const load = name => JSON.parse(readFileSync(root + 'catalog/' + name + '.json', 'utf8'));
const classes = load('classes'), stones = load('standing-stones');
const records = new Map([...classes.records, ...stones.records].map(record => [record.stableFormKey, {
  definition: { recordType: record.recordType, stableFormKey: record.stableFormKey, catalogSignature: record.signature }, data: record.data
}]));
const lookup = key => records.get(key);
const classCatalog = { status: 'SUPPORTED', byKey: lookup };
const stoneCatalog = { status: 'SUPPORTED', byKey: lookup, unsupported: stones.unsupported, roots: stones.roots.map(lookup) };
const revision = { facts: 1, grants: 1, equipment: 0, effects: 0, catalog: 1 };
const set = grants => ({ characterKey: 'profile:1', revision, grants });
const classAt = (classId, level) => classGrants(classes, classCatalog, { classId, revision: 1 }, level);
const stone = key => standingStoneGrants(stoneCatalog, key ? { stoneKey: key, revision: 1 } : undefined);
const ritual = () => stone('skyrim.esm|0D2337');
const twin = () => classAt('invocador', 40).filter(grant => grant.definition.stableFormKey === 'skyrim.esm|0D5F1C');

test('actual class stages give one base slot, plus Twin Souls only when granted, and Ritual stacks once', () => {
  for (const definition of classes.classes) for (let level = 1; level <= 40; level++) {
    const grants = classAt(definition.id, level);
    const hasTwin = grants.some(grant => grant.definition.stableFormKey === 'skyrim.esm|0D5F1C');
    assert.equal(composeSummonCapacity(set(grants), lookup).limit, 1 + Number(hasTwin), definition.id + '@' + level);
    assert.equal(composeSummonCapacity(set([...grants, ...ritual()]), lookup).limit, 2 + Number(hasTwin));
  }
  assert.equal(composeSummonCapacity(set(classAt('invocador', 39)), lookup).limit, 1);
  assert.equal(composeSummonCapacity(set(classAt('invocador', 40)), lookup).limit, 2);
});

test('the two independent bonuses accumulate to three without counting duplicated grants or native delivery twice', () => {
  const grants = [...twin(), ...twin(), ...ritual(), ...ritual(), {
    kind: 'perk', definition: lookup('mundus.esp|000823').definition, rank: 1, revision: 1,
    source: { kind: 'STANDING_STONE', key: 'skyrim.esm|0D2337' }
  }];
  assert.deepEqual(composeSummonCapacity(set(grants), lookup), { limit: 3, bonuses: ['RITUAL_STONE', 'TWIN_SOULS'] });
});

test('changing the selected stone removes Ritual even if its ability remains learned locally', () => {
  const old = ritual()[0];
  const learned = { ...old, source: { kind: 'LEARNED', key: 'spellbook' } };
  assert.equal(composeSummonCapacity(set([learned]), lookup).limit, 1);
  assert.equal(composeSummonCapacity(set([...twin(), ...stone('skyrim.esm|0D232D'), learned]), lookup).limit, 2);
  assert.equal(composeSummonCapacity(set([{ ...old, source: { kind: 'STANDING_STONE', key: 'skyrim.esm|0D232D' } }]), lookup).limit, 1);
});

test('missing records, mismatched signatures or rank zero do not grant additional slots', () => {
  const grant = twin()[0];
  assert.equal(composeSummonCapacity(set([{ ...grant, rank: 0 }]), lookup).limit, 1);
  assert.equal(composeSummonCapacity(set([{ ...grant, definition: { ...grant.definition, catalogSignature: 'other' } }]), lookup).limit, 1);
  assert.equal(composeSummonCapacity(set([...twin(), ...ritual()]), () => undefined).limit, 1);
  assert.equal(composeSummonCapacity(set(ritual()), key => key === 'mundus.esp|00081B' ? undefined : lookup(key)).limit, 1);
  assert.equal(composeSummonCapacity(set(twin()), key => {
    const record = lookup(key);
    return key === 'skyrim.esm|0D5F1C' ? { ...record, data: { fields: { ...record.data.fields, 'Effects[0].Value': '2' } } } : record;
  }).limit, 1, 'unknown record semantics must not become an unreviewed bonus');
});

test('capacity follows class/stone changes and refuses old sessions or character bindings', () => {
  const binding = { characterKey: 'profile:1', profileKey: 'profile:1', actorRef: { actorId: 91 }, epoch: 'one' };
  let current = binding;
  const projection = new SummonCapacityProjection(lookup, candidate => candidate.epoch === current.epoch, () => true);
  projection.publish(binding, set([...twin(), ...ritual()])); assert.equal(projection.read(binding).value.limit, 3);
  projection.publish(binding, set(ritual())); assert.equal(projection.read(binding).value.limit, 2);
  projection.publish(binding, set([])); assert.equal(projection.read(binding).value.limit, 1);
  current = { ...binding, epoch: 'two' };
  assert.equal(projection.read(current).status, 'UNSUPPORTED');
  projection.publish(current, set(twin())); projection.clear(binding);
  assert.equal(projection.read(current).value.limit, 2, 'old-session cleanup must preserve the new session');
  projection.publish(current, { ...set(ritual()), characterKey: 'profile:2' });
  assert.equal(projection.read(current).value.limit, 2);
  projection.publish(binding, set(ritual())); assert.equal(projection.read(current).value.limit, 2);
  projection.shutdown(); assert.equal(projection.read(current).status, 'UNSUPPORTED');
});

test('disabled or unselected canary sources contribute no bonus', () => {
  const binding = { characterKey: 'profile:1', actorRef: { actorId: 91 }, epoch: 'one' };
  let allowed = new Set(['CLASS']);
  const projection = new SummonCapacityProjection(lookup, () => true, (_binding, kind) => allowed.has(kind));
  projection.publish(binding, set([...twin(), ...ritual()])); assert.equal(projection.read(binding).value.limit, 2);
  allowed = new Set(['STANDING_STONE']); projection.publish(binding, set([...twin(), ...ritual()]));
  assert.equal(projection.read(binding).value.limit, 2);
  allowed.clear(); projection.publish(binding, set([...twin(), ...ritual()])); assert.equal(projection.read(binding).value.limit, 1);
});
