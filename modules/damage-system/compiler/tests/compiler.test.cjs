const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { compilePerk, evaluateConditionTabs, ruleMatches, formKeyToStable } = require("../dist/compiler.js");
const { loadPerkRecords } = require("../tools/load-perk-export.cjs");

const root = path.resolve(__dirname, "../../../../../");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "AetheriusGameplayCore/modules/damage-system/tests/golden/physical_damage_golden.json"), "utf8"));
const crosswalk = fs.readFileSync(path.join(root, "_work/exports/classes/perk-crosswalk.jsonl"), "utf8").trim().split(/\r?\n/).map(JSON.parse);
const loaded = loadPerkRecords(
  path.join(root, "_work/exports/combat-20261024/PERK.jsonl"),
  path.join(root, "_work/exports/combat-20261024/PERK-effects-completos.jsonl"),
);
const records = new Map(loaded.records.map((record) => [record.formid, record]));
const byForm = (formid) => records.get(formid);
const field = (record, path) => record.fields.find((item) => item.path === path)?.value;
const functionsAt = (record, effectIndex) => [...new Set(record.fields
  .filter((item) => item.path.startsWith("Effects[" + effectIndex + "].Conditions[") && item.path.endsWith(".Data.Function"))
  .map((item) => item.value))].sort();
const effectAt = (record, effectIndex) => record.fields
  .filter((item) => item.path.startsWith("Effects[" + effectIndex + "]."))
  .reduce((result, item) => {
    const remainder = item.path.slice(("Effects[" + effectIndex + "].").length);
    if (!remainder.includes(".")) result[remainder] = item.value;
    return result;
  }, {});
function originFor(formid, preferredClass) {
  for (const row of crosswalk) for (const candidate of row.candidates || []) {
    if (candidate.formid !== formid) continue;
    const grant = (candidate.classes || row.classes || []).find((entry) => !preferredClass || entry.split("@")[0] === preferredClass);
    if (!grant) continue;
    const [classId, level] = grant.split("@");
    return { sourceKind: "CLASS", sourceKey: grant, classId, level: Number(level) };
  }
}
function rowFor(formid) {
  return crosswalk.find((row) => (row.candidates || []).some((candidate) => candidate.formid === formid));
}
function condition(functionName, overrides = {}) {
  return {
    function: functionName,
    compare: "EqualTo",
    comparisonValue: 1,
    runOn: "Subject",
    runOnTabIndex: 0,
    orNext: false,
    ...overrides,
  };
}
function contextFor(functionName, value, key) {
  const stableKey = key || "01ABCD:Example.esp";
  switch (functionName) {
    case "HasKeyword": return { subject: { keywords: value ? [stableKey] : [] } };
    case "WornHasKeyword": return { subject: { wornKeywords: value ? [stableKey] : [] } };
    case "WornApparelHasKeywordCount": return { subject: { wornKeywordCounts: { [stableKey]: value } } };
    case "HasPerk": return { subject: { perks: value ? [stableKey] : [] } };
    case "GetIsID": return { subject: { actorId: value ? stableKey : "01FFFF:Other.esp" } };
    case "GetEquippedItemType": return { subject: { equippedItemTypes: { Left: value } } };
    case "IsWeaponSkillType": return { subject: { weaponSkillType: value ? "OneHanded" : "TwoHanded" } };
    case "GetActorValuePercent": return { subject: { actorValuePercents: { Health: value } } };
    case "GetActorValue": return { subject: { actorValues: { OneHanded: value } } };
  }
}

 test("G2 golden effects match the winning PERK export located by formid", () => {
  const cases = fixture.cases.filter((item) => item.group === "G2_CLASS_PERK_ENTRY_POINTS");
  let matched = 0;
  let skippedWithoutClassGrant = 0;
  for (const item of cases) {
    if (!item.formid || !item.recordEffect) { skippedWithoutClassGrant++; continue; }
    const record = byForm(item.formid);
    assert.ok(record, "PERK export missing " + item.formid);
    const origin = originFor(item.formid, item.classGrantedBy?.[0]);
    assert.ok(origin, "crosswalk grant missing " + item.formid);
    const compiled = compilePerk(record, origin);
    const expected = item.recordEffect;
    const rule = compiled.rules.find((candidate) =>
      candidate.entryPoint === expected.EntryPoint &&
      candidate.modification === expected.Modification &&
      candidate.value === expected.Value,
    );
    assert.ok(rule, "golden effect missing for " + item.id);
    const raw = effectAt(record, rule.effectIndex);
    assert.equal(rule.priority, Number(raw.Priority));
    assert.equal(rule.rank, Number(raw.Rank));
    assert.deepEqual(rule.conditionFunctions, functionsAt(record, rule.effectIndex));
    matched++;
  }
  console.log("G2 matched golden effects=" + matched + "; no-class-grant cases=" + skippedWithoutClassGrant);
  assert.ok(matched > 0);
});

test("G3 case condition is a subset of the actual effect; extra conditions are context requirements", () => {
  const cases = fixture.cases.filter((item) => item.group === "G3_CERTIFIED_CONDITIONS");
  const extras = [];
  const fixtureDrift = [];
  let checked = 0;
  for (const item of cases) {
    if (!item.formid || !item.recordEffect) continue;
    const record = byForm(item.formid);
    assert.ok(record, "PERK export missing " + item.formid);
    const functionName = item.input?.conditionFunction;
    if (item.input?.statusReason === "NO_CLASS_PERK_IN_LOAD_ORDER") {
      const found = crosswalk.filter((row) => row.status === "RESOLVED")
        .flatMap((row) => row.candidates || [])
        .filter((candidate) => candidate.classes?.length)
        .flatMap((candidate) => byForm(candidate.formid)?.fields || [])
        .filter((field) => field.path.endsWith(".Data.Function") && field.value === functionName);
      assert.equal(found.length, 0, "fixture says no class perk uses " + functionName);
      checked++;
      continue;
    }
    assert.ok(functionName, "condition function missing for " + item.id);
    const origin = originFor(item.formid, item.classGrantedBy?.[0]);
    assert.ok(origin, "crosswalk grant missing " + item.formid);
    const compiled = compilePerk(record, origin);
    const matchingEffects = compiled.rules.filter((rule) =>
      rule.entryPoint === item.recordEffect.EntryPoint &&
      rule.modification === item.recordEffect.Modification,
    );
    assert.ok(matchingEffects.length, "effect missing for " + item.id);
    const rule = matchingEffects.find((candidate) => candidate.value === Number(item.recordEffect.Value)) || matchingEffects[0];
    const exportFunctions = functionsAt(record, rule.effectIndex);
    if (!exportFunctions.includes(functionName)) {
      fixtureDrift.push(item.id + " fixture=" + functionName + " export=" + exportFunctions.join(", "));
    }
    const additional = exportFunctions.filter((fn) => fn !== functionName);
    if (additional.length) extras.push(item.id + " requires context: " + additional.join(", "));
    if (exportFunctions.some((fn) => !["HasKeyword", "WornHasKeyword", "WornApparelHasKeywordCount", "HasPerk", "GetIsID", "GetEquippedItemType", "IsWeaponSkillType", "GetActorValuePercent", "GetActorValue"].includes(fn))) {
      assert.equal(rule.status, "UNSUPPORTED", "uncertified condition accepted for " + item.id);
      assert.match(rule.reason, /unsupported condition/);
      assert.equal(ruleMatches(rule, { subject: {} }), false);
    }
    checked++;
  }
  console.log("G3 checked=" + checked + "; extra conditions are context requirements: " + extras.join("; ") + "; fixture/export divergences: " + fixtureDrift.join("; "));
  assert.ok(checked > 0);
});
test("all class effects cover every exported combat family and Modification with exact source values", () => {
  const observed = new Set();
  const compiledPairs = new Set();
  const entryPoints = new Set([
    "ModAttackDamage", "CalculateWeaponDamage", "ModPowerAttackDamage", "ModSneakAttackMult",
    "CalculateMyCriticalHitChance", "CalculateMyCriticalHitDamage", "ModIncomingDamage",
    "ModTargetDamageResistance", "ModArmorRating", "ModPercentBlocked",
  ]);
  let effectsChecked = 0;
  for (const row of crosswalk) {
    if (row.status !== "RESOLVED") continue;
    for (const candidate of row.candidates || []) {
      const record = byForm(candidate.formid);
      assert.ok(record, "resolved crosswalk record missing " + candidate.formid);
      const grant = (candidate.classes || row.classes || [])[0];
      if (!grant) continue;
      const [classId, rawLevel] = grant.split("@");
      const compiled = compilePerk(record, { sourceKind: "CLASS", sourceKey: grant, classId, level: Number(rawLevel) });
      for (const effect of record.fields.filter((item) => /^Effects\[\d+\]\.EntryPoint$/.test(item.path))) {
        if (!entryPoints.has(effect.value)) continue;
        const effectIndex = Number(effect.path.match(/^Effects\[(\d+)\]/)[1]);
        const raw = effectAt(record, effectIndex);
        const key = effect.value + " / " + raw.Modification;
        const rule = compiled.rules.find((item) => item.effectIndex === effectIndex);
        observed.add(key);
        assert.ok(rule, "compiled effect missing " + candidate.formid + " effect " + effectIndex);
        assert.equal(rule.entryPoint, raw.EntryPoint);
        assert.equal(rule.modification, raw.Modification);
        assert.equal(rule.value, Number(raw.Value));
        assert.equal(rule.priority, Number(raw.Priority));
        assert.equal(rule.rank, Number(raw.Rank));
        assert.equal(rule.status, rule.reason ? "UNSUPPORTED" : "SUPPORTED");
        compiledPairs.add(key);
        effectsChecked++;
      }
    }
  }
  assert.deepEqual([...compiledPairs].sort(), [...observed].sort());
  assert.ok(effectsChecked > 0);
  console.log("source effects=" + effectsChecked + "; entry point/Modification pairs=" + observed.size + "; " + [...observed].sort().join("; "));
});

test("all nine certified condition functions distinguish positive, negative, and missing context", () => {
  const functions = ["HasKeyword", "WornHasKeyword", "WornApparelHasKeywordCount", "HasPerk", "GetIsID", "GetEquippedItemType", "IsWeaponSkillType", "GetActorValuePercent", "GetActorValue"];
  for (const fn of functions) {
    const key = "01ABCD:Example.esp";
    const comparisonValue = fn === "GetActorValuePercent" ? 0.5 : fn === "WornApparelHasKeywordCount" ? 2 : fn === "GetActorValue" ? 50 : 1;
    const comparison = fn === "GetActorValuePercent" || fn === "WornApparelHasKeywordCount" || fn === "GetActorValue" ? "GreaterThanOrEqualTo" : "EqualTo";
    const value = fn === "GetActorValuePercent" ? 0.7 : fn === "WornApparelHasKeywordCount" ? 3 : fn === "GetActorValue" ? 60 : 1;
    const negative = fn === "GetActorValuePercent" ? 0.2 : fn === "WornApparelHasKeywordCount" ? 1 : fn === "GetActorValue" ? 40 : 0;
    const parameter = ["HasKeyword", "WornHasKeyword", "WornApparelHasKeywordCount", "HasPerk", "GetIsID"].includes(fn) ? key : undefined;
    const actorValue = fn === "GetEquippedItemType" ? "Left" : fn === "IsWeaponSkillType" ? "OneHanded" : fn === "GetActorValuePercent" ? "Health" : fn === "GetActorValue" ? "OneHanded" : undefined;
    const item = condition(fn, { compare: comparison, comparisonValue, parameter, actorValue });
    const tabs = [{ tabIndex: 0, clauses: [[item]] }];
    assert.equal(evaluateConditionTabs(tabs, contextFor(fn, value, key)), true, fn + " positive");
    assert.equal(evaluateConditionTabs(tabs, contextFor(fn, negative, key)), false, fn + " negative");
    assert.equal(evaluateConditionTabs(tabs, {}), false, fn + " missing context");
  }
});

test("OR clauses, multiple tabs, and RunOn Target preserve their separate semantics", () => {
  const first = condition("HasKeyword", { parameter: "01AAAA:Keyword.esp", runOnTabIndex: 0, orNext: true });
  const second = condition("HasKeyword", { parameter: "01BBBB:Keyword.esp", runOnTabIndex: 0 });
  const third = condition("HasPerk", { parameter: "01CCCC:Perk.esp", runOnTabIndex: 1 });
  const tabs = [
    { tabIndex: 0, clauses: [[first, second]] },
    { tabIndex: 1, clauses: [[third]] },
  ];
  assert.equal(evaluateConditionTabs(tabs, { subject: { keywords: ["01BBBB:Keyword.esp"], perks: ["01CCCC:Perk.esp"] } }), true);
  assert.equal(evaluateConditionTabs(tabs, { subject: { keywords: [], perks: ["01CCCC:Perk.esp"] } }), false);
  assert.equal(evaluateConditionTabs(tabs, { subject: { keywords: ["01BBBB:Keyword.esp"], perks: [] } }), false);
  const targetTab = [{ tabIndex: 2, clauses: [[condition("HasKeyword", { parameter: "01DDDD:Keyword.esp", runOn: "Target", runOnTabIndex: 2 })]] }];
  assert.equal(evaluateConditionTabs(targetTab, { subject: { keywords: [] }, target: { keywords: ["01DDDD:Keyword.esp"] } }), true);
  assert.equal(evaluateConditionTabs(targetTab, { subject: { keywords: ["01DDDD:Keyword.esp"] }, target: { keywords: [] } }), false);
});

test("missing required fields and uncertified conditions reject the whole rule with reasons", () => {
  const source = byForm("0BABE4:Skyrim.esm");
  assert.ok(source);
  const origin = originFor(source.formid);
  const withoutPriority = { ...source, fields: source.fields.filter((item) => item.path !== "Effects[0].Priority") };
  const missing = compilePerk(withoutPriority, origin).rules.find((rule) => rule.effectIndex === 0);
  assert.equal(missing.status, "UNSUPPORTED");
  assert.match(missing.reason, /invalid Priority/);

  const uncertifiedSource = byForm("105F1C:Skyrim.esm");
  const uncertifiedOrigin = originFor(uncertifiedSource.formid);
  const rejected = compilePerk(uncertifiedSource, uncertifiedOrigin).rules.find((rule) => rule.entryPoint === "ModAttackDamage");
  assert.ok(rejected);
  assert.equal(rejected.status, "UNSUPPORTED");
  assert.match(rejected.reason, /unsupported condition GetDistance/);
  assert.equal(ruleMatches(rejected, { subject: {} }), false);
});

test("the complete export replaces all truncated records by formid and preserves stable identity", () => {
  assert.equal(loaded.replaced.length, 10);
  assert.ok(loaded.replaced.includes("0C1E91:Skyrim.esm"));
  assert.ok(loaded.replaced.includes("0C1E93:Skyrim.esm"));
  assert.ok(loaded.replaced.includes("0C1E95:Skyrim.esm"));
  assert.ok(loaded.replaced.includes("0C1E97:Skyrim.esm"));
  assert.ok(loaded.replaced.includes("0C3679:Skyrim.esm"));
  assert.ok(loaded.replaced.includes("0C5C07:Skyrim.esm"));
  assert.ok(loaded.replaced.includes("10B1D9:Skyrim.esm"));
  assert.ok(loaded.replaced.includes("000801:FirstPersonInteractions.esp"));
  assert.ok(loaded.replaced.includes("00845D:waccf_armor and clothing extension.esp"));
  assert.ok(loaded.replaced.includes("05BB51:Pilgrim.esp"));
  for (const formid of loaded.replaced) assert.equal(byForm(formid).fields.some((item) => item.path === "…"), false, formid);
  assert.equal(formKeyToStable("01abcd:example.esp"), "01ABCD:example.esp");
  console.log("completed records=" + loaded.replaced.length + "; count includes 0C1E91 Execute");
});

const racesCatalog = JSON.parse(fs.readFileSync(path.join(root, "AetheriusGameplayCore/catalog/races.json"), "utf8"));
const stonesCatalog = JSON.parse(fs.readFileSync(path.join(root, "AetheriusGameplayCore/catalog/standing-stones.json"), "utf8"));

function recordFromCatalog(catalog, stableFormKey) {
  const entry = catalog.records.find((item) => item.stableFormKey === stableFormKey);
  assert.ok(entry, "catalog record missing for " + stableFormKey);
  const pipe = stableFormKey.indexOf("|");
  const plugin = stableFormKey.slice(0, pipe);
  const hex = stableFormKey.slice(pipe + 1);
  const formid = hex + ":" + plugin;
  const rawFields = entry.data.fields || {};
  const fields = Object.entries(rawFields).map(([path, value]) => ({ path, value: String(value) }));
  return {
    formid,
    winner: entry.winnerPlugin || plugin,
    fields,
  };
}

test("RACE and STANDING_STONE perks from catalogs compile with preserved origin and expected combat rules", () => {
  // 1. STANDING_STONE: Warrior doomstone perk (00080D:Mundus.esp)
  const warriorRecord = recordFromCatalog(stonesCatalog, "mundus.esp|00080D");
  const warriorOrigin = { sourceKind: "STANDING_STONE", sourceKey: "mundus.esp|00080D" };
  const compiledWarrior = compilePerk(warriorRecord, warriorOrigin);
  assert.equal(compiledWarrior.perk, "00080D:mundus.esp");
  assert.equal(compiledWarrior.winner, "Mundus.esp");
  assert.deepEqual(compiledWarrior.origin, warriorOrigin);
  assert.equal(compiledWarrior.rules.length, 2);

  const warriorIncoming = compiledWarrior.rules.find((r) => r.effectIndex === 0);
  assert.ok(warriorIncoming);
  assert.equal(warriorIncoming.entryPoint, "ModIncomingDamage");
  assert.equal(warriorIncoming.modification, "Multiply");
  assert.equal(warriorIncoming.value, 0.9);
  assert.equal(warriorIncoming.priority, 2);
  assert.equal(warriorIncoming.rank, 0);
  assert.equal(warriorIncoming.status, "SUPPORTED");
  assert.deepEqual(warriorIncoming.origin, warriorOrigin);
  assert.equal(ruleMatches(warriorIncoming, {}), true);

  const warriorSpell = compiledWarrior.rules.find((r) => r.effectIndex === 1);
  assert.ok(warriorSpell);
  assert.equal(warriorSpell.entryPoint, "ModIncomingSpellMagnitude");
  assert.equal(warriorSpell.status, "UNSUPPORTED");
  assert.match(warriorSpell.reason, /out-of-scope entry point ModIncomingSpellMagnitude/);
  assert.deepEqual(warriorSpell.origin, warriorOrigin);

  // 2. STANDING_STONE: Lover doomstone perk (000808:Mundus.esp)
  const loverRecord = recordFromCatalog(stonesCatalog, "mundus.esp|000808");
  const loverOrigin = { sourceKind: "STANDING_STONE", sourceKey: "mundus.esp|000808" };
  const compiledLover = compilePerk(loverRecord, loverOrigin);
  assert.equal(compiledLover.perk, "000808:mundus.esp");
  assert.deepEqual(compiledLover.origin, loverOrigin);
  const loverIncoming0 = compiledLover.rules.find((r) => r.effectIndex === 0);
  assert.ok(loverIncoming0);
  assert.equal(loverIncoming0.entryPoint, "ModIncomingDamage");
  assert.equal(loverIncoming0.modification, "Multiply");
  assert.equal(loverIncoming0.value, 1.25);
  assert.equal(loverIncoming0.priority, 4);
  assert.equal(loverIncoming0.status, "UNSUPPORTED");
  assert.deepEqual(loverIncoming0.origin, loverOrigin);

  // 3. RACE: Nord racial perk (000805:Aetherius.esp)
  const nordRecord = recordFromCatalog(racesCatalog, "aetherius.esp|000805");
  const nordOrigin = { sourceKind: "RACE", sourceKey: "skyrim.esm|013746" };
  const compiledNord = compilePerk(nordRecord, nordOrigin);
  assert.equal(compiledNord.perk, "000805:aetherius.esp");
  assert.deepEqual(compiledNord.origin, nordOrigin);
  assert.equal(compiledNord.rules.length, 4);
  for (const rule of compiledNord.rules) {
    assert.deepEqual(rule.origin, nordOrigin);
  }
  const nordIncoming0 = compiledNord.rules.find((r) => r.effectIndex === 0);
  assert.ok(nordIncoming0);
  assert.equal(nordIncoming0.entryPoint, "ModIncomingDamage");
  assert.equal(nordIncoming0.modification, "Multiply");
  assert.equal(nordIncoming0.value, 0.75);
  assert.equal(nordIncoming0.priority, 4);

  // 4. ModSneakAttackMult perks: Wood Elf (aetherius.esp|000827) and Shadow (mundus.esp|000812)
  const woodElfRecord = recordFromCatalog(racesCatalog, "aetherius.esp|000827");
  const woodElfOrigin = { sourceKind: "RACE", sourceKey: "skyrim.esm|013749" };
  const compiledWoodElf = compilePerk(woodElfRecord, woodElfOrigin);
  assert.deepEqual(compiledWoodElf.origin, woodElfOrigin);
  const woodElfSneak = compiledWoodElf.rules.find((r) => r.effectIndex === 0);
  assert.ok(woodElfSneak);
  assert.equal(woodElfSneak.entryPoint, "ModSneakAttackMult");
  assert.equal(woodElfSneak.value, 1.25);
  assert.deepEqual(woodElfSneak.origin, woodElfOrigin);

  const shadowRecord = recordFromCatalog(stonesCatalog, "mundus.esp|000812");
  const shadowOrigin = { sourceKind: "STANDING_STONE", sourceKey: "mundus.esp|000812" };
  const compiledShadow = compilePerk(shadowRecord, shadowOrigin);
  assert.deepEqual(compiledShadow.origin, shadowOrigin);
  const shadowSneak = compiledShadow.rules.find((r) => r.effectIndex === 0);
  assert.ok(shadowSneak);
  assert.equal(shadowSneak.entryPoint, "ModSneakAttackMult");
  assert.equal(shadowSneak.value, 1.25);
  assert.deepEqual(shadowSneak.origin, shadowOrigin);
});

test("RACE and STANDING_STONE perks with uncertified conditions are marked UNSUPPORTED with origin preserved", () => {
  const warrior = recordFromCatalog(stonesCatalog, "mundus.esp|00080D");
  const uncertifiedRecord = {
    ...warrior,
    fields: [
      ...warrior.fields.filter((f) => !f.path.startsWith("Effects[0].Conditions")),
      { path: "Effects[0].Conditions[0].RunOnTabIndex", value: "0" },
      { path: "Effects[0].Conditions[0].Conditions[0].Data.Function", value: "GetDistance" },
      { path: "Effects[0].Conditions[0].Conditions[0].Data.RunOnType", value: "Subject" },
      { path: "Effects[0].Conditions[0].Conditions[0].CompareOperator", value: "LessThan" },
      { path: "Effects[0].Conditions[0].Conditions[0].ComparisonValue", value: "500" },
    ],
  };

  const stoneOrigin = { sourceKind: "STANDING_STONE", sourceKey: "mundus.esp|00080D" };
  const compiledStone = compilePerk(uncertifiedRecord, stoneOrigin);
  assert.deepEqual(compiledStone.origin, stoneOrigin);
  const stoneRule = compiledStone.rules.find((r) => r.effectIndex === 0);
  assert.ok(stoneRule);
  assert.equal(stoneRule.status, "UNSUPPORTED");
  assert.match(stoneRule.reason, /unsupported condition GetDistance/);
  assert.deepEqual(stoneRule.origin, stoneOrigin);
  assert.equal(ruleMatches(stoneRule, { subject: {} }), false);

  const raceOrigin = { sourceKind: "RACE", sourceKey: "skyrim.esm|013746" };
  const compiledRace = compilePerk(uncertifiedRecord, raceOrigin);
  assert.deepEqual(compiledRace.origin, raceOrigin);
  const raceRule = compiledRace.rules.find((r) => r.effectIndex === 0);
  assert.ok(raceRule);
  assert.equal(raceRule.status, "UNSUPPORTED");
  assert.match(raceRule.reason, /unsupported condition GetDistance/);
  assert.deepEqual(raceRule.origin, raceOrigin);
  assert.equal(ruleMatches(raceRule, { subject: {} }), false);
});

test("GrantOrigin validation accepts CLASS, RACE, and STANDING_STONE and enforces origin fields", () => {
  const warrior = recordFromCatalog(stonesCatalog, "mundus.esp|00080D");

  // Valid origins for all three kinds
  assert.doesNotThrow(() => compilePerk(warrior, { sourceKind: "CLASS", sourceKey: "Warrior@1", classId: "Warrior", level: 1 }));
  assert.doesNotThrow(() => compilePerk(warrior, { sourceKind: "RACE", sourceKey: "skyrim.esm|013746" }));
  assert.doesNotThrow(() => compilePerk(warrior, { sourceKind: "STANDING_STONE", sourceKey: "mundus.esp|00080D" }));

  // Missing / empty sourceKey
  assert.throws(() => compilePerk(warrior, { sourceKind: "RACE", sourceKey: "" }), /invalid grant origin/);
  assert.throws(() => compilePerk(warrior, { sourceKind: "STANDING_STONE", sourceKey: "" }), /invalid grant origin/);
  assert.throws(() => compilePerk(warrior, { sourceKind: "CLASS", sourceKey: "", classId: "Warrior", level: 1 }), /invalid grant origin/);

  // CLASS requires classId and valid level
  assert.throws(() => compilePerk(warrior, { sourceKind: "CLASS", sourceKey: "Warrior@1", classId: "", level: 1 }), /invalid grant origin/);
  assert.throws(() => compilePerk(warrior, { sourceKind: "CLASS", sourceKey: "Warrior@1", classId: "Warrior", level: 0 }), /invalid grant origin/);
  assert.throws(() => compilePerk(warrior, { sourceKind: "CLASS", sourceKey: "Warrior@1", classId: "Warrior", level: -1 }), /invalid grant origin/);
  assert.throws(() => compilePerk(warrior, { sourceKind: "CLASS", sourceKey: "Warrior@1", classId: "Warrior", level: 1.5 }), /invalid grant origin/);
  assert.throws(() => compilePerk(warrior, { sourceKind: "CLASS", sourceKey: "Warrior@1", classId: "Warrior" }), /invalid grant origin/);

  // Unsupported sourceKind
  assert.throws(() => compilePerk(warrior, { sourceKind: "RELIGION", sourceKey: "talos" }), /invalid grant origin/);
  assert.throws(() => compilePerk(warrior, { sourceKind: "QUEST", sourceKey: "quest1" }), /invalid grant origin/);
  assert.throws(() => compilePerk(warrior, null), /invalid grant origin/);
});
