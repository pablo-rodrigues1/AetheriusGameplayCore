export const COMBAT_ENTRY_POINTS = [
  "ModAttackDamage",
  "CalculateWeaponDamage",
  "ModPowerAttackDamage",
  "ModSneakAttackMult",
  "CalculateMyCriticalHitChance",
  "CalculateMyCriticalHitDamage",
  "ModIncomingDamage",
  "ModTargetDamageResistance",
  "ModArmorRating",
  "ModPercentBlocked",
] as const;

export const CERTIFIED_CONDITIONS = [
  "HasKeyword",
  "WornHasKeyword",
  "WornApparelHasKeywordCount",
  "HasPerk",
  "GetIsID",
  "GetEquippedItemType",
  "IsWeaponSkillType",
  "GetActorValuePercent",
  "GetActorValue",
] as const;

export type ConditionFunction = (typeof CERTIFIED_CONDITIONS)[number];

export interface FlatField {
  path: string;
  value?: string;
  note?: string;
  note_ref?: string;
}

export interface PerkRecord {
  formid: string;
  winner?: string;
  fields: FlatField[];
}

export type GrantOrigin =
  | {
      sourceKind: "CLASS";
      sourceKey: string;
      classId: string;
      level: number;
    }
  | {
      sourceKind: "RACE";
      sourceKey: string;
      classId?: never;
      level?: never;
    }
  | {
      sourceKind: "STANDING_STONE";
      sourceKey: string;
      classId?: never;
      level?: never;
    }
  | {
      // DS-5c: perk listed on the winning NPC_ record (BaseData template provider).
      // sourceKey = StableFormKey of that NPC_.
      sourceKind: "NPC_RECORD";
      sourceKey: string;
      classId?: never;
      level?: never;
    };

export interface CompiledCondition {
  function: ConditionFunction;
  compare: string;
  comparisonValue: number;
  parameter?: string;
  actorValue?: string;
  runOn: string;
  runOnTabIndex: number;
  orNext: boolean;
}

export interface ConditionTab {
  tabIndex: number;
  clauses: CompiledCondition[][];
}

export interface CompiledRule {
  status: "SUPPORTED" | "UNSUPPORTED";
  reason?: string;
  conditionFunctions: string[];
  perk: string;
  winner: string;
  entryPoint: string;
  modification: string;
  value: number;
  actorValue?: string;
  priority: number;
  rank: number;
  tabCount: number;
  conditions: ConditionTab[];
  origin: GrantOrigin;
  effectIndex: number;
}

export interface CompiledPerk {
  perk: string;
  winner: string;
  origin: GrantOrigin;
  rules: CompiledRule[];
}

export interface ConditionContext {
  keywords?: readonly string[];
  perks?: readonly string[];
  actorValues?: Readonly<Record<string, number>>;
  actorValuePercents?: Readonly<Record<string, number>>;
  equippedItemTypes?: Readonly<Record<string, number>>;
  weaponSkillType?: string;
  wornKeywordCounts?: Readonly<Record<string, number>>;
  actorId?: string;
  wornKeywords?: readonly string[];
}

export interface EvaluationContext {
  subject?: ConditionContext;
  target?: ConditionContext;
}

interface ParsedConditions {
  tabs: ConditionTab[];
  functions: string[];
  errors: string[];
}

const field = (record: PerkRecord, path: string): string | undefined =>
  record.fields.find((item) => item.path === path)?.value;

function indexes(record: PerkRecord, pattern: RegExp): number[] {
  return [...new Set(
    record.fields.flatMap((item) => {
      const match = item.path.match(pattern);
      return match ? [Number(match[1])] : [];
    }),
  )].sort((left, right) => left - right);
}

function scopedIndexes(record: PerkRecord, prefix: string, pattern: RegExp): number[] {
  return [...new Set(
    record.fields.flatMap((item) => {
      if (!item.path.startsWith(prefix)) return [];
      const match = item.path.match(pattern);
      return match ? [Number(match[1])] : [];
    }),
  )].sort((left, right) => left - right);
}

function numberField(record: PerkRecord, path: string, fallback = 0): number {
  const value = field(record, path);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function stableFormKey(record: PerkRecord, paths: string[]): string | undefined {
  for (const path of paths) {
    const linked = field(record, path + ".Link");
    if (linked && /^[\da-f]{6}:[^:]+$/i.test(linked)) return linked;
    const direct = field(record, path);
    if (direct && /^[\da-f]{6}:[^:]+$/i.test(direct)) return direct;
  }
  return undefined;
}

function parseConditions(record: PerkRecord, effectIndex: number): ParsedConditions {
  const effectPrefix = "Effects[" + effectIndex + "].";
  const conditionPrefix = effectPrefix + "Conditions[";
  const groups = scopedIndexes(
    record,
    conditionPrefix,
    /^Effects\[\d+\]\.Conditions\[(\d+)\]\.RunOnTabIndex$/,
  );
  const byTab = new Map<number, CompiledCondition[]>();
  const functions: string[] = [];
  const errors: string[] = [];

  for (const groupIndex of groups) {
    const groupPath = effectPrefix + "Conditions[" + groupIndex + "]";
    const tabIndex = numberField(record, groupPath + ".RunOnTabIndex", Number.NaN);
    if (!Number.isInteger(tabIndex)) {
      errors.push("invalid RunOnTabIndex at " + groupPath);
      continue;
    }

    const listPrefix = groupPath + ".Conditions[";
    const conditionIndexes = scopedIndexes(
      record,
      listPrefix,
      /^Effects\[\d+\]\.Conditions\[\d+\]\.Conditions\[(\d+)\]\.Data\.Function$/,
    );
    if (conditionIndexes.length === 0) {
      errors.push("empty condition group at " + groupPath);
      continue;
    }

    const tabConditions = byTab.get(tabIndex) ?? [];
    for (const conditionIndex of conditionIndexes) {
      const path = listPrefix + conditionIndex + "]";
      const fn = field(record, path + ".Data.Function") ?? "UNKNOWN";
      functions.push(fn);
      if (!(CERTIFIED_CONDITIONS as readonly string[]).includes(fn)) {
        errors.push("unsupported condition " + fn + " at " + path);
        continue;
      }

      const formParameter = stableFormKey(record, [
        path + ".Data.Keyword",
        path + ".Data.Perk",
        path + ".Data.Parameter1",
      ]);
      const rawActorValue =
        field(record, path + ".Data.ActorValue") ??
        field(record, path + ".Data.Parameter1");
      const actorValue = rawActorValue && rawActorValue !== "0" ? rawActorValue : undefined;
      const runOn = field(record, path + ".Data.RunOnType") ?? "Subject";
      const compare = field(record, path + ".CompareOperator") ?? "EqualTo";
      const comparisonValue = numberField(record, path + ".ComparisonValue", Number.NaN);
      const flags = (field(record, path + ".Flags") ?? "").split(/[|, ]/);
      const needsFormKey = [
        "HasKeyword",
        "WornHasKeyword",
        "WornApparelHasKeywordCount",
        "HasPerk",
        "GetIsID",
      ].includes(fn);
      const needsActorValue = [
        "GetEquippedItemType",
        "IsWeaponSkillType",
        "GetActorValuePercent",
        "GetActorValue",
      ].includes(fn);

      if (!Number.isFinite(comparisonValue)) {
        errors.push("missing comparison value for " + fn + " at " + path);
      }
      if (needsFormKey && !formParameter) {
        errors.push("missing stable form key parameter for " + fn + " at " + path);
      }
      if (needsActorValue && !actorValue) {
        errors.push("missing parameter for " + fn + " at " + path);
      }
      if (runOn !== "Subject" && runOn !== "Target") {
        errors.push("unsupported RunOn " + runOn + " for " + fn + " at " + path);
      }

      tabConditions.push({
        function: fn as ConditionFunction,
        compare,
        comparisonValue,
        parameter: formParameter,
        actorValue,
        runOn,
        runOnTabIndex: tabIndex,
        orNext: flags.includes("OR"),
      });
    }
    byTab.set(tabIndex, tabConditions);
  }

  const tabs = [...byTab.entries()]
    .sort(([left], [right]) => left - right)
    .map(([tabIndex, conditions]) => {
      const clauses: CompiledCondition[][] = [];
      let clause: CompiledCondition[] = [];
      for (const condition of conditions) {
        clause.push(condition);
        if (!condition.orNext) {
          clauses.push(clause);
          clause = [];
        }
      }
      if (clause.length > 0) clauses.push(clause);
      return { tabIndex, clauses };
    });

  return {
    tabs,
    functions: [...new Set(functions)].sort(),
    errors,
  };
}

export function compilePerk(record: PerkRecord, origin: GrantOrigin): CompiledPerk {
  if (!record?.fields || !/^[\da-f]{6}:[^:]+$/i.test(record.formid)) {
    throw new Error("PERK record requires a StableFormKey formid");
  }
  if (
    !origin ||
    !origin.sourceKey ||
    (origin.sourceKind !== "CLASS" &&
      origin.sourceKind !== "RACE" &&
      origin.sourceKind !== "STANDING_STONE" &&
      origin.sourceKind !== "NPC_RECORD") ||
    (origin.sourceKind === "CLASS" &&
      (!origin.classId ||
        !Number.isInteger(origin.level) ||
        origin.level < 1))
  ) {
    throw new Error("invalid grant origin");
  }

  const rules: CompiledRule[] = [];
  const effectIndexes = indexes(record, /^Effects\[(\d+)\]\.EntryPoint$/);
  for (const effectIndex of effectIndexes) {
    const prefix = "Effects[" + effectIndex + "].";
    const entryPoint = field(record, prefix + "EntryPoint") ?? "";
    const modification = field(record, prefix + "Modification") ?? "";
    const value = numberField(record, prefix + "Value", Number.NaN);
    const priority = numberField(record, prefix + "Priority", Number.NaN);
    const rank = numberField(record, prefix + "Rank", Number.NaN);
    const rawActorValue = field(record, prefix + "ActorValue") ?? field(record, prefix + "Data.ActorValue");
    const actorValue = rawActorValue && rawActorValue !== "0" ? rawActorValue : undefined;
    const parsedConditions = parseConditions(record, effectIndex);
    const reasons = [...parsedConditions.errors];

    if (!(COMBAT_ENTRY_POINTS as readonly string[]).includes(entryPoint)) {
      reasons.push("out-of-scope entry point " + (entryPoint || "(missing)"));
    }
    if (!modification) reasons.push("missing Modification");
    if (!Number.isFinite(value)) reasons.push("invalid Value");
    if (!Number.isFinite(priority)) reasons.push("invalid Priority");
    if (!Number.isFinite(rank)) reasons.push("invalid Rank");

    rules.push({
      status: reasons.length > 0 ? "UNSUPPORTED" : "SUPPORTED",
      reason: reasons.length > 0 ? [...new Set(reasons)].join("; ") : undefined,
      conditionFunctions: parsedConditions.functions,
      perk: record.formid,
      winner: record.winner ?? "",
      entryPoint,
      modification,
      value,
      actorValue,
      priority,
      rank,
      tabCount: numberField(record, prefix + "PerkConditionTabCount", 0),
      conditions: parsedConditions.tabs,
      origin,
      effectIndex,
    });
  }

  return {
    perk: record.formid,
    winner: record.winner ?? "",
    origin,
    rules,
  };
}

function compare(value: number, operator: string, expected: number): boolean {
  switch (operator) {
    case "EqualTo": return value === expected;
    case "NotEqualTo": return value !== expected;
    case "GreaterThan": return value > expected;
    case "GreaterThanOrEqualTo": return value >= expected;
    case "LessThan": return value < expected;
    case "LessThanOrEqualTo": return value <= expected;
    default: return false;
  }
}

function conditionValue(condition: CompiledCondition, context: ConditionContext): number | undefined {
  const key = condition.parameter ?? "";
  switch (condition.function) {
    case "HasKeyword":
      return context.keywords === undefined ? undefined : Number(context.keywords.includes(key));
    case "WornHasKeyword":
      return context.wornKeywords === undefined ? undefined : Number(context.wornKeywords.includes(key));
    case "WornApparelHasKeywordCount":
      return context.wornKeywordCounts?.[key];
    case "HasPerk":
      return context.perks === undefined ? undefined : Number(context.perks.includes(key));
    case "GetIsID":
      return context.actorId === undefined ? undefined : Number(context.actorId === key);
    case "GetEquippedItemType":
      return context.equippedItemTypes?.[condition.actorValue ?? ""];
    case "IsWeaponSkillType":
      return context.weaponSkillType === undefined
        ? undefined
        : Number(context.weaponSkillType === condition.actorValue);
    case "GetActorValuePercent":
      return context.actorValuePercents?.[condition.actorValue ?? ""];
    case "GetActorValue":
      return context.actorValues?.[condition.actorValue ?? ""];
  }
}

function matchesCondition(condition: CompiledCondition, context: ConditionContext): boolean {
  const value = conditionValue(condition, context);
  return value !== undefined && Number.isFinite(value) &&
    compare(value, condition.compare, condition.comparisonValue);
}

export function evaluateConditionTabs(
  tabs: readonly ConditionTab[],
  context: EvaluationContext,
): boolean {
  return tabs.length === 0 || tabs.every((tab) =>
    tab.clauses.every((clause) => clause.some((condition) => {
      const actor = condition.runOn === "Target" ? context.target : context.subject;
      return actor !== undefined && matchesCondition(condition, actor);
    })),
  );
}

export function ruleMatches(rule: CompiledRule, context: EvaluationContext): boolean {
  return rule.status === "SUPPORTED" && evaluateConditionTabs(rule.conditions, context);
}

export function operationMultiplier(
  rule: Pick<CompiledRule, "modification" | "value" | "actorValue">,
  actorValues: Readonly<Record<string, number>>,
): number | undefined {
  if (rule.modification === "Multiply") return rule.value;
  if (rule.modification === "MultiplyOnePlusAVMult") {
    const value = rule.actorValue ? actorValues[rule.actorValue] : undefined;
    return value === undefined ? undefined : 1 + rule.value * value;
  }
  return undefined;
}

export function formKeyToStable(value: string): string | undefined {
  const match = value.match(/^([\da-f]{6}):(.+)$/i);
  return match ? match[1].toUpperCase() + ":" + match[2] : undefined;
}
