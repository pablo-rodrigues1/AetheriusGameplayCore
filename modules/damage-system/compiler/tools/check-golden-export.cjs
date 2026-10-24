'use strict';

const fs = require('node:fs');
const path = require('node:path');

const workspace = path.resolve(__dirname, '../../../../..');
const fixturePath = path.resolve(__dirname, '../../tests/golden/physical_damage_golden.json');
const exportDir = path.join(workspace, '_work', 'exports', 'combat-20261024');
const crosswalkPath = path.join(workspace, '_work', 'exports', 'classes', 'perk-crosswalk.jsonl');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const failures = [];
const exactConditionCaseIds = new Set([
  'EP-03-ModPowerAttackDamage-FuriousStrength-MultiplyOnePlusAVMult',
  'EP-05-CalculateMyCriticalHitChance-Execute-Add',
  'EP-06B-CalculateMyCriticalHitDamage-Execute-Multiply',
  'EP-07-ModIncomingDamage-BattleFatigue-Multiply',
  'EP-09B-ModArmorRating-HeavyArmorFit-Multiply',
  'COND-04-WornApparelHasKeywordCount-positive-negative-missing',
  'COND-06-GetEquippedItemType-positive-negative-missing',
  'COND-07-IsWeaponSkillType-positive-negative-missing',
  'COND-08-GetActorValuePercent-positive-negative-missing',
]);
let comparedEffects = 0;
let exactConditionsCompared = 0;
let noClassSearches = 0;
let checkedCases = 0;

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map(JSON.parse);
}

const exportsByFormId = new Map();
for (const file of ['PERK.jsonl', 'PERK-effects-completos.jsonl']) {
  for (const record of readJsonl(path.join(exportDir, file))) {
    if (record.formid && Array.isArray(record.fields)) exportsByFormId.set(record.formid, record);
  }
}
const crosswalk = readJsonl(crosswalkPath).filter((row) => row.status === 'RESOLVED');
const classPerks = new Set(crosswalk.flatMap((row) => (row.candidates || [])
  .filter((candidate) => Array.isArray(candidate.classes || row.classes) && (candidate.classes || row.classes).length > 0)
  .map((candidate) => candidate.formid)));

function field(record, key) {
  return record.fields.find((item) => item.path === key)?.value;
}

function number(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function indices(record, regex) {
  return [...new Set(record.fields.flatMap((item) => {
    const match = item.path.match(regex);
    return match ? [Number(match[1])] : [];
  }))].sort((a, b) => a - b);
}

function parameter1(record, base) {
  const candidates = [
    'Data.Keyword',
    'Data.Perk',
    'Data.MagicEffect',
    'Data.MagicEffectKeyword',
    'Data.Parameter1.Link',
    'Data.Parameter1',
    'Data.ActorValue',
    'Data.StringParameter1',
  ];
  for (const suffix of candidates) {
    const value = field(record, base + suffix);
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string' && value.startsWith('[FormLinkOrIndex')) {
      const link = field(record, base + 'Data.Parameter1.Link');
      if (link !== undefined) return link;
      continue;
    }
    return value;
  }
  return undefined;
}

function sourceConditions(record, effectIndex) {
  const effectPrefix = 'Effects[' + effectIndex + '].';
  const groupIndexes = indices(record, /^Effects\[\d+\]\.Conditions\[(\d+)\]\.RunOnTabIndex$/);
  const conditions = [];

  for (const groupIndex of groupIndexes) {
    const groupPrefix = effectPrefix + 'Conditions[' + groupIndex + '].';
    const runOnTabIndex = number(field(record, groupPrefix + 'RunOnTabIndex'));
    const conditionIndexes = [...new Set(record.fields.flatMap((item) => {
      if (!item.path.startsWith(groupPrefix)) return [];
      const match = item.path.slice(groupPrefix.length).match(/^Conditions\[(\d+)\]\.Data\.Function$/);
      return match ? [Number(match[1])] : [];
    }))].sort((a, b) => a - b);

    for (const conditionIndex of conditionIndexes) {
      const base = groupPrefix + 'Conditions[' + conditionIndex + '].';
      const condition = {
        RunOnTabIndex: runOnTabIndex,
        Function: field(record, base + 'Data.Function'),
        CompareOperator: field(record, base + 'CompareOperator'),
        ComparisonValue: number(field(record, base + 'ComparisonValue')),
        Flags: field(record, base + 'Flags') ?? '0',
        RunOn: field(record, base + 'Data.RunOnType') ?? 'Subject',
      };
      const parameter = parameter1(record, base);
      if (parameter !== undefined) condition.parameter1 = parameter;
      conditions.push(condition);
    }
  }
  return conditions;
}

function sourceEffects(record) {
  return indices(record, /^Effects\[(\d+)\]\.EntryPoint$/).map((index) => {
    const prefix = 'Effects[' + index + '].';
    const effect = {
      index,
      EntryPoint: field(record, prefix + 'EntryPoint'),
      Modification: field(record, prefix + 'Modification'),
      Value: number(field(record, prefix + 'Value')),
      Priority: number(field(record, prefix + 'Priority')),
      Rank: number(field(record, prefix + 'Rank')),
      Conditions: sourceConditions(record, index),
    };
    const actorValue = field(record, prefix + 'ActorValue') ?? field(record, prefix + 'Data.ActorValue');
    if (actorValue !== undefined && actorValue !== '0') effect.ActorValue = actorValue;
    return effect;
  });
}

function conditionFunctions(conditions) {
  return [...new Set((conditions || []).map((condition) => condition.Function))].sort();
}

function exportFormId(stableKey) {
  if (typeof stableKey !== 'string') return stableKey;
  const match = stableKey.match(/^(.+):([\da-f]{6})$/i);
  return match ? match[2].toUpperCase() + ':' + match[1] : stableKey;
}

function functionSetForFixture(item) {
  return conditionFunctions(item.recordEffect?.Conditions || []);
}

function effectMatches(effect, expected) {
  return effect.EntryPoint === expected.EntryPoint &&
    effect.Modification === expected.Modification &&
    effect.Value === number(expected.Value) &&
    effect.Priority === number(expected.Priority) &&
    effect.Rank === number(expected.Rank) &&
    (expected.ActorValue === undefined || effect.ActorValue === expected.ActorValue);
}

function checkEffect(item, formid, expected) {
  const record = exportsByFormId.get(formid);
  if (!record) {
    failures.push(item.id + ': PERK export missing by formid ' + formid);
    return null;
  }
  const matches = sourceEffects(record).filter((effect) => effectMatches(effect, expected));
  if (matches.length !== 1) {
    failures.push(item.id + ': expected one exported effect matching entry point/operation/value/priority/rank; found ' + matches.length + ' at ' + formid);
    return null;
  }
  comparedEffects += 1;
  const effect = matches[0];

  for (const key of ['EntryPoint', 'Modification', 'Value', 'Priority', 'Rank']) {
    if (expected[key] !== undefined && effect[key] !== (key === 'EntryPoint' || key === 'Modification' ? expected[key] : number(expected[key]))) {
      failures.push(item.id + ': ' + key + ' fixture=' + expected[key] + ' export=' + effect[key]);
    }
  }
  if (expected.ActorValue !== undefined && effect.ActorValue !== expected.ActorValue) {
    failures.push(item.id + ': ActorValue fixture=' + expected.ActorValue + ' export=' + effect.ActorValue);
  }

  if (exactConditionCaseIds.has(item.id)) {
    if (JSON.stringify(expected.Conditions || []) !== JSON.stringify(effect.Conditions)) {
      failures.push(item.id + ': exact conditions fixture=' + JSON.stringify(expected.Conditions || []) + ' export=' + JSON.stringify(effect.Conditions));
    }
    exactConditionsCompared += 1;
  } else if (item.group === 'G2_CLASS_PERK_ENTRY_POINTS') {
    const fixtureFunctions = functionSetForFixture(item);
    const exportedFunctions = conditionFunctions(effect.Conditions);
    if (JSON.stringify(fixtureFunctions) !== JSON.stringify(exportedFunctions)) {
      failures.push(item.id + ': condition function set fixture=' + JSON.stringify(fixtureFunctions) + ' export=' + JSON.stringify(exportedFunctions));
    }
  } else {
    const selectedFunction = item.input?.conditionFunction;
    if (selectedFunction && selectedFunction !== 'UncertifiedRejection' &&
        !effect.Conditions.some((condition) => condition.Function === selectedFunction)) {
      failures.push(item.id + ': selected condition function ' + selectedFunction + ' absent from exported effect');
    }
  }
  return { record, effect };
}

function effectsForClassPerks(predicate) {
  const matches = [];
  for (const formid of classPerks) {
    const record = exportsByFormId.get(formid);
    if (!record) continue;
    for (const effect of sourceEffects(record)) {
      if (predicate(effect)) matches.push({ formid, effect });
    }
  }
  return matches;
}

const cases = fixture.cases.filter((item) =>
  item.group === 'G2_CLASS_PERK_ENTRY_POINTS' || item.group === 'G3_CERTIFIED_CONDITIONS');
for (const item of cases) {
  checkedCases += 1;
  const reason = item.statusReason || item.input?.statusReason || '';

  if (item.kind === 'perk_entry_point' && reason === 'NO_CLASS_PERK_IN_LOAD_ORDER') {
    const query = item.input || {};
    const matches = effectsForClassPerks((effect) =>
      effect.EntryPoint === query.entryPoint && effect.Modification === query.operation);
    noClassSearches += 1;
    if (matches.length) {
      failures.push(item.id + ': NO_CLASS_PERK_IN_LOAD_ORDER contradicted by RESOLVED class perks ' +
        JSON.stringify(matches.map((item) => ({ formid: item.formid, effect: item.effect.index }))));
    } else {
      process.stdout.write('SEARCH ' + item.id + ': RESOLVED class-perk records=' + classPerks.size +
        '; no matching ' + query.entryPoint + '/' + query.operation + '\n');
    }
    continue;
  }

  if (item.kind === 'condition_eval' && item.input?.conditionFunction === 'UncertifiedRejection') {
    for (const sample of item.input.uncertifiedCases || []) {
      const sampleExpected = {
        EntryPoint: sample.entryPoint,
        Modification: sample.modification,
        Value: sample.value,
        Priority: sample.priority,
        Rank: sample.rank,
      };
      const checked = checkEffect(item, sample.formid, sampleExpected);
      if (!checked) continue;
      const matches = checked.effect.Conditions.filter((condition) =>
        condition.Function === sample.function &&
        condition.ComparisonValue === number(sample.comparisonValue) &&
        condition.CompareOperator === sample.compareOperator &&
        (sample.conditionKey === undefined || sample.conditionKey === null ||
          condition.parameter1 === undefined || exportFormId(sample.conditionKey) === condition.parameter1));
      if (matches.length !== 1) {
        failures.push(item.id + '/' + sample.formid + ': uncertified condition details do not match export for ' + sample.function);
      }
    }
    continue;
  }

  if (item.kind === 'condition_eval' && reason === 'NO_CLASS_PERK_IN_LOAD_ORDER') {
    if (item.recordEffect) {
      checkEffect({
        ...item,
        input: { ...item.input, conditionFunction: undefined },
      }, item.formid, item.recordEffect);
    }
    const functionName = item.input?.conditionFunction;
    const matches = effectsForClassPerks((effect) =>
      effect.Conditions.some((condition) => condition.Function === functionName));
    noClassSearches += 1;
    if (matches.length) {
      failures.push(item.id + ': NO_CLASS_PERK_IN_LOAD_ORDER for condition ' + functionName +
        ' contradicted by RESOLVED class perks ' +
        JSON.stringify(matches.map((item) => ({ formid: item.formid, effect: item.effect.index }))));
    } else {
      process.stdout.write('SEARCH ' + item.id + ': RESOLVED class-perk records=' + classPerks.size +
        '; no condition ' + functionName + '\n');
    }
    continue;
  }

  if (!item.recordEffect) {
    failures.push(item.id + ': missing recordEffect without an explicit no-class reason');
    continue;
  }

  const checked = checkEffect(item, item.formid, item.recordEffect);
  if (!checked) continue;

  if (item.id === 'COND-06-GetEquippedItemType-positive-negative-missing' ||
      item.id === 'COND-07-IsWeaponSkillType-positive-negative-missing') {
    const functionName = item.input?.conditionFunction;
    const matches = effectsForClassPerks((effect) =>
      effect.Conditions.some((condition) => condition.Function === functionName));
    const selected = matches.some((match) => match.formid === item.formid &&
      match.effect.EntryPoint === item.recordEffect.EntryPoint &&
      match.effect.Modification === item.recordEffect.Modification &&
      match.effect.Value === number(item.recordEffect.Value));
    process.stdout.write('SEARCH ' + item.id + ': RESOLVED class-perk records=' + classPerks.size +
      '; effects with ' + functionName + '=' + matches.length +
      '; selected=' + item.formid + '; selected candidate found=' + selected + '\n');
    if (!selected) failures.push(item.id + ': chosen class perk does not use ' + functionName + ' in its effect');
  }

  if (checked.effect.Conditions.some((condition) =>
    condition.Function === 'IsPowerAttacking' || condition.Function === 'HasMagicEffect')) {
    if (item.expectedStatus !== 'PENDING' ||
        !String(item.statusReason || '').includes('UNSUPPORTED_UNCERTIFIED_CONDITIONS')) {
      failures.push(item.id + ': uncertified IsPowerAttacking/HasMagicEffect must remain PENDING with statusReason');
    }
  }
}

process.stdout.write('Checked G2/G3 fixtures=' + checkedCases +
  '; exported effects compared=' + comparedEffects +
  '; exact-condition cases=' + exactConditionsCompared +
  '; no-class searches=' + noClassSearches +
  '; divergences=' + failures.length + '\n');
for (const failure of failures) process.stderr.write('DIVERGENCE ' + failure + '\n');
process.exitCode = failures.length ? 1 : 0;
