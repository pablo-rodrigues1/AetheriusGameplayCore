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
    contents: "export {composePlayerCombatProfile} from './runtime/src/combat-profile.ts';\n",
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const api = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

function catalog(name) {
  return JSON.parse(readFileSync(resolve(root, 'catalog', name + '.json'), 'utf8'));
}

const raceCatalog = catalog('races');
const stoneCatalog = catalog('standing-stones');
const classCatalog = catalog('classes');
const catalogRecords = [...raceCatalog.records, ...stoneCatalog.records];
const recordsByKey = new Map(catalogRecords.map(record => [record.stableFormKey, record]));

function requiredRecord(key, recordType) {
  const record = recordsByKey.get(key);
  assert.ok(record, 'catalog must contain ' + key);
  assert.equal(record.recordType, recordType, key + ' record type');
  return record;
}

const raceSourceKey = 'skyrim.esm|013746';
const stoneSourceKey = 'skyrim.esm|0D232D';
const racePerkKey = 'aetherius.esp|000805';
const stonePerkKey = 'mundus.esp|00080D';
assert.ok(raceCatalog.roots.includes(raceSourceKey), 'race source key must be a catalog root');
assert.ok(stoneCatalog.roots.includes(stoneSourceKey), 'standing-stone source key must be a catalog root');
const raceRecord = requiredRecord(raceSourceKey, 'RACE');
const stoneRecord = requiredRecord(stoneSourceKey, 'ACTI');
const racePerk = requiredRecord(racePerkKey, 'PERK');
const stonePerk = requiredRecord(stonePerkKey, 'PERK');
assert.ok(raceRecord.signature && stoneRecord.signature && racePerk.signature && stonePerk.signature);

const classIds = (classCatalog.classes ?? []).map(definition => definition.id).filter(id => typeof id === 'string');
assert.ok(classIds.length > 0, 'class catalog must contain class identities');
const classId = classIds.find(id => id === 'viper') ?? classIds[0];
const otherClassId = classIds.find(id => id !== classId);
assert.ok(otherClassId, 'class catalog must contain a second class identity');

const perkRecordsByKey = new Map(catalogRecords
  .filter(record => record.recordType === 'PERK')
  .map(record => [record.stableFormKey, record]));
function lookupPerk(key) {
  const record = perkRecordsByKey.get(key);
  if (!record) return undefined;
  return {
    definition: {
      stableFormKey: record.stableFormKey,
      recordType: record.recordType,
      catalogSignature: record.signature,
    },
    winnerPlugin: record.winnerPlugin,
    data: record.data,
  };
}

function perkGrant(sourceKind, sourceKey, record) {
  return {
    kind: 'perk',
    definition: {
      stableFormKey: record.stableFormKey,
      recordType: 'PERK',
      catalogSignature: record.signature,
    },
    rank: 1,
    source: { kind: sourceKind, key: sourceKey },
    revision: 1,
  };
}

function classFacts(id, level = 40) {
  return {
    kind: 'classes',
    classId: id,
    level,
    classRevision: 1,
    levelRevision: 1,
    attributeAllocationRevision: 0,
    attributeMaximum: { status: 'UNSUPPORTED', value: null, reason: 'fixture has no attribute maxima' },
  };
}

function profile(grants, classes) {
  const binding = {
    profileKey: 'profile:race-stone-test',
    characterKey: 'profile:race-stone-test',
    actorRef: { actorId: 71 },
    epoch: 'race-stone-test-epoch',
  };
  return api.composePlayerCombatProfile({
    binding,
    set: {
      characterKey: binding.characterKey,
      revision: { facts: 1, grants: 1, equipment: 0, effects: 0, catalog: 1 },
      grants,
    },
    facts: {
      ...(classes ? { classes } : {}),
      races: { kind: 'races', race: { status: 'SUPPORTED', value: raceSourceKey }, revision: 1 },
    },
    classData: classCatalog,
    lookupPerk,
  });
}

function compiledPerk(combatProfile, sourceKind, sourceKey, stableFormKey) {
  const item = combatProfile.perks.value.find(candidate =>
    candidate.sourceKind === sourceKind && candidate.sourceKey === sourceKey && candidate.stableFormKey === stableFormKey);
  assert.ok(item, sourceKind + ' grant should be present in the combat profile');
  return item;
}

test('RACE perk compilation preserves its catalog-derived origin', () => {
  const grant = perkGrant('RACE', raceSourceKey, racePerk);
  const result = profile([grant]);
  const item = compiledPerk(result, 'RACE', raceSourceKey, racePerkKey);

  assert.notEqual(item.reason, 'DS3_COMPILER_SOURCE_KIND_UNSUPPORTED');
  assert.ok(item.compiled, 'RACE grant should reach the perk compiler');
  assert.equal(item.compiled.origin.sourceKind, 'RACE');
  assert.equal(item.compiled.origin.sourceKey, raceSourceKey);
  assert.ok(item.compiled.rules.some(rule => rule.entryPoint === 'ModIncomingDamage'));
});

test('STANDING_STONE uses the real record status while preserving its 0.9 damage rule', () => {
  const grant = perkGrant('STANDING_STONE', stoneSourceKey, stonePerk);
  const result = profile([grant]);
  const item = compiledPerk(result, 'STANDING_STONE', stoneSourceKey, stonePerkKey);
  const incomingDamage = item.compiled.rules.find(rule => rule.effectIndex === 0);
  const conditionalEffect = item.compiled.rules.find(rule => rule.effectIndex === 1);

  assert.equal(item.compiled.origin.sourceKind, 'STANDING_STONE');
  assert.equal(item.compiled.origin.sourceKey, stoneSourceKey);
  assert.equal(incomingDamage.entryPoint, 'ModIncomingDamage');
  assert.equal(incomingDamage.status, 'SUPPORTED');
  assert.equal(incomingDamage.modification, 'Multiply');
  assert.equal(incomingDamage.value, 0.9);
  assert.equal(conditionalEffect.status, 'UNSUPPORTED');
  assert.match(conditionalEffect.reason, /empty condition group/);
  assert.equal(item.status, 'UNSUPPORTED');
  assert.match(item.reason, /empty condition group/);
});

test('RACE and STANDING_STONE grants compile without class facts', () => {
  const grants = [
    perkGrant('RACE', raceSourceKey, racePerk),
    perkGrant('STANDING_STONE', stoneSourceKey, stonePerk),
  ];
  const result = profile(grants, undefined);
  const race = compiledPerk(result, 'RACE', raceSourceKey, racePerkKey);
  const stone = compiledPerk(result, 'STANDING_STONE', stoneSourceKey, stonePerkKey);

  assert.ok(race.compiled);
  assert.ok(stone.compiled);
  assert.notEqual(race.reason, 'CLASS_GRANT_ORIGIN_UNAVAILABLE');
  assert.notEqual(stone.reason, 'CLASS_GRANT_ORIGIN_UNAVAILABLE');
  assert.equal(race.compiled.origin.sourceKey, raceSourceKey);
  assert.equal(stone.compiled.origin.sourceKey, stoneSourceKey);
});

test('CLASS still requires matching class facts and a level from 1 through 40', () => {
  const grant = perkGrant('CLASS', classId, racePerk);
  const cases = [
    ['missing class facts', undefined],
    ['mismatched class identity', classFacts(otherClassId, 40)],
    ['level below range', classFacts(classId, 0)],
    ['level above range', classFacts(classId, 41)],
  ];
  for (const [label, facts] of cases) {
    const item = compiledPerk(profile([grant], facts), 'CLASS', classId, racePerkKey);
    assert.equal(item.status, 'UNSUPPORTED', label);
    assert.equal(item.reason, 'CLASS_GRANT_ORIGIN_UNAVAILABLE', label);
    assert.equal(item.compiled, null, label);
  }

  const accepted = compiledPerk(profile([grant], classFacts(classId, 40)), 'CLASS', classId, racePerkKey);
  assert.ok(accepted.compiled);
  assert.equal(accepted.compiled.origin.sourceKind, 'CLASS');
  assert.equal(accepted.compiled.origin.sourceKey, classId);
  assert.equal(accepted.compiled.origin.classId, classId);
  assert.equal(accepted.compiled.origin.level, 40);
});

test('RELIGION and QUEST perk grants remain unsupported by the compiler source-kind boundary', () => {
  for (const sourceKind of ['RELIGION', 'QUEST']) {
    const key = sourceKind === 'RELIGION' ? 'religion-test-key' : 'quest-test-key';
    const item = compiledPerk(profile([perkGrant(sourceKind, key, racePerk)]), sourceKind, key, racePerkKey);
    assert.equal(item.status, 'UNSUPPORTED');
    assert.equal(item.reason, 'DS3_COMPILER_SOURCE_KIND_UNSUPPORTED');
    assert.equal(item.compiled, null);
  }
});

test('racial perk with catalog condition metadata but no certified condition fields stays unsupported with a reason', () => {
  const conditionMetadata = racePerk.data.exportNotes?.['Effects[0].Conditions[0].Conditions'];
  assert.match(conditionMetadata, /^\[list: [1-9]\d* item\(s\)\]$/);
  assert.equal(Object.keys(racePerk.data.fields).some(path =>
    /^Effects\[0\]\.Conditions\[0\]\.Conditions\[\d+\]\.Data\.Function$/.test(path)), false);

  const item = compiledPerk(
    profile([perkGrant('RACE', raceSourceKey, racePerk)]),
    'RACE', raceSourceKey, racePerkKey,
  );
  const incomingDamage = item.compiled.rules.find(rule => rule.effectIndex === 0);
  assert.equal(item.status, 'UNSUPPORTED');
  assert.match(item.reason, /empty condition group at Effects\[0\]\.Conditions\[0\]/);
  assert.equal(incomingDamage.status, 'UNSUPPORTED');
  assert.match(incomingDamage.reason, /empty condition group/);
});
