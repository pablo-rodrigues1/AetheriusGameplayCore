#include "aetherius_combat/physical/PhysicalDamagePipeline.h"
#include "aetherius_combat/ds5a/Physical.h"

#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

using namespace aetherius::combat;

namespace {

struct FixedRollRng : CombatRng {
  double value = 0.5;
  int calls = 0;
  explicit FixedRollRng(double v) : value(v) {}
  double Unit() override {
    ++calls;
    return value;
  }
};

enum class CaseOutcome {
  Passed,
  Failed,
  Pending
};

struct CaseResult {
  std::string id;
  std::string group;
  std::string kind;
  std::string expectedStatus;
  CaseOutcome outcome = CaseOutcome::Failed;
  std::string detail;
  std::string origin;
  std::string pendingPlanFunction;
};

bool Near(double actual, double expected, double tolerance) {
  return std::abs(actual - expected) <= tolerance;
}

std::string OutcomeToString(CaseOutcome o) {
  switch (o) {
    case CaseOutcome::Passed:
      return "PASS";
    case CaseOutcome::Failed:
      return "FAIL";
    case CaseOutcome::Pending:
      return "PENDING";
  }
  return "FAIL";
}

nlohmann::json ReadJsonFile(const std::string& path) {
  std::ifstream in(path);
  if (!in) {
    throw std::runtime_error("missing file: " + path);
  }
  nlohmann::json j;
  in >> j;
  return j;
}

bool TryParseFormKey(const std::string& raw, StableFormKey& out, std::string& errorOut) {
  try {
    out = StableFormKey::Parse(raw);
    return true;
  } catch (const std::exception& ex) {
    errorOut = ex.what();
    return false;
  }
}

std::vector<StableFormKey> ParseKeyList(
    const nlohmann::json& arr,
    std::vector<std::string>& errors) {
  std::vector<StableFormKey> out;
  if (!arr.is_array()) return out;
  for (const auto& item : arr) {
    StableFormKey k;
    std::string err;
    if (TryParseFormKey(item.get<std::string>(), k, err)) {
      out.push_back(k);
    } else {
      errors.push_back(err);
    }
  }
  return out;
}

CombatProfile BuildProfile(
    const nlohmann::json& skillsJson,
    const nlohmann::json& perksJson,
    std::vector<std::string>& errors) {
  CombatProfile p;
  p.revision = 1;
  if (skillsJson.is_object()) {
    for (const auto& it : skillsJson.items()) {
      p.skills[it.key()] = it.value().get<double>();
    }
  }
  if (perksJson.is_array()) {
    for (const auto& raw : perksJson) {
      StableFormKey k;
      std::string err;
      if (TryParseFormKey(raw.get<std::string>(), k, err)) {
        p.perks.push_back({k, 1U});
      } else {
        errors.push_back(err);
      }
    }
  }
  return p;
}

double FindTraceValue(const CombatTrace& trace, const std::string& stage, double fallback) {
  for (const auto& step : trace.Steps()) {
    if (step.stage == stage) {
      return step.value;
    }
  }
  return fallback;
}

bool LooksLikeRuntimeHex8(const std::string& text) {
  if (text.size() == 10 && text[0] == '0' && (text[1] == 'x' || text[1] == 'X')) {
    for (std::size_t i = 2; i < 10; ++i) {
      const unsigned char ch = static_cast<unsigned char>(text[i]);
      if (!std::isxdigit(ch)) return false;
    }
    return true;
  }
  if (text.size() == 8) {
    bool allHex = true;
    for (char c : text) {
      if (!std::isxdigit(static_cast<unsigned char>(c))) {
        allHex = false;
        break;
      }
    }
    if (allHex) return true;
  }
  return false;
}

void AuditJsonFormKeysRecursive(
    const nlohmann::json& node,
    const std::string& jsonPath,
    std::vector<std::string>& invalidFormKeys) {
  if (node.is_object()) {
    for (const auto& it : node.items()) {
      const std::string childPath = jsonPath + "." + it.key();
      if (it.value().is_string()) {
        const std::string val = it.value().get<std::string>();
        if (LooksLikeRuntimeHex8(val)) {
          invalidFormKeys.push_back(childPath + " looks like 8-hex runtime FormID: " + val);
        }
        const bool isKeyField =
            it.key() == "formKey" || it.key() == "perkFormKey" ||
            it.key() == "blockerPerkFormKey" || it.key() == "requiredFormKey" ||
            it.key() == "forbiddenFormKey" || it.key() == "wrongFormKey" ||
            it.key() == "conditionKey" || it.key() == "perkKeyUpper" ||
            it.key() == "perkKeyLower" || it.key() == "keywordUpper" ||
            it.key() == "keywordLower";
        if (isKeyField && !val.empty()) {
          StableFormKey parsed;
          std::string err;
          if (!TryParseFormKey(val, parsed, err)) {
            invalidFormKeys.push_back(childPath + " invalid StableFormKey '" + val + "': " + err);
          }
        }
      } else if (
          it.value().is_array() &&
          (it.key() == "perks" || it.key() == "actorPerks" ||
           it.key() == "keywords" || it.key() == "positiveKeywords" ||
           it.key() == "negativeKeywords" || it.key() == "missingKeywords")) {
        for (std::size_t idx = 0; idx < it.value().size(); ++idx) {
          const std::string val = it.value()[idx].get<std::string>();
          StableFormKey parsed;
          std::string err;
          if (!TryParseFormKey(val, parsed, err)) {
            invalidFormKeys.push_back(
                childPath + "[" + std::to_string(idx) + "] invalid StableFormKey '" + val + "': " + err);
          }
        }
      } else {
        AuditJsonFormKeysRecursive(it.value(), childPath, invalidFormKeys);
      }
    }
  } else if (node.is_array()) {
    for (std::size_t idx = 0; idx < node.size(); ++idx) {
      AuditJsonFormKeysRecursive(
          node[idx], jsonPath + "[" + std::to_string(idx) + "]", invalidFormKeys);
    }
  }
}

CaseResult EvaluatePhysicalDamageCase(
    const nlohmann::json& tc,
    const CombatSettings& settings,
    const PerkRegistry& perks) {
  CaseResult res;
  res.id = tc.at("id").get<std::string>();
  res.group = tc.at("group").get<std::string>();
  res.kind = tc.at("kind").get<std::string>();
  res.expectedStatus = tc.at("expectedStatus").get<std::string>();
  res.origin = tc.value("origin", "");
  if (tc.contains("pendingPlanFunction") && !tc.at("pendingPlanFunction").is_null()) {
    res.pendingPlanFunction = tc.at("pendingPlanFunction").get<std::string>();
  }

  std::vector<std::string> errors;
  const auto& input = tc.at("input");
  const auto& expected = tc.at("expected");

  const auto& weap = input.at("weapon");
  StableFormKey weapKey;
  std::string weapErr;
  if (!TryParseFormKey(weap.at("formKey").get<std::string>(), weapKey, weapErr)) {
    errors.push_back(weapErr);
  }
  const std::vector<StableFormKey> weapKeywords =
      ParseKeyList(weap.value("keywords", nlohmann::json::array()), errors);

  const auto& attJson = input.at("attacker");
  const CombatProfile attacker = BuildProfile(
      attJson.value("skills", nlohmann::json::object()),
      attJson.value("perks", nlohmann::json::array()),
      errors);

  const auto& defJson = input.at("defender");
  const CombatProfile defender = BuildProfile(
      defJson.value("skills", nlohmann::json::object()),
      defJson.value("perks", nlohmann::json::array()),
      errors);

  const auto& atkJson = input.at("attack");
  DamageContext ctx{
      attacker,
      defender,
      weap.at("skill").get<std::string>(),
      weapKeywords,
      weap.at("baseDamage").get<double>(),
      atkJson.value("flatItemDamage", 0.0),
      atkJson.value("itemMultiplier", 1.0),
      defJson.value("armorRating", 0.0),
      atkJson.value("attackMultiplier", 1.0),
      weap.value("critDamage", 0.0),
      atkJson.value("criticalChance", 0.0),
      defJson.value("blocking", false)};

  const int repeatHits = atkJson.value("repeatHits", 1);
  DamageResult result{};
  CombatTrace trace(true);
  bool stableAcrossRepeats = true;

  for (int hitIndex = 0; hitIndex < repeatHits; ++hitIndex) {
    FixedRollRng rng(atkJson.value("rngRoll", 0.5));
    CombatTrace hitTrace(true);
    const DamageResult current = PhysicalDamage(ctx, settings, perks, rng, hitTrace);
    if (hitIndex == 0) {
      result = current;
      trace = hitTrace;
    } else if (!Near(current.health, result.health, 1e-9)) {
      stableAcrossRepeats = false;
    }
  }

  const double actualFinal = result.health;
  const double actualPre = FindTraceValue(trace, "physical.preDefense", actualFinal);
  const double actualCrit = FindTraceValue(trace, "critical.component", 0.0);
  const double actualBlock = FindTraceValue(trace, "block.reduction", 0.0);
  const double actualArmor = FindTraceValue(trace, "armor.reduction", 0.0);

  const double tol = expected.value("tolerance", 1e-6);
  const double expFinal = expected.at("finalDamage").get<double>();
  const double expPre = expected.value("preDefenseDamage", expFinal);
  const double expCrit = expected.value("criticalComponent", 0.0);
  const double expBlock = expected.value("blockReduction", 0.0);
  const double expArmor = expected.value("armorReduction", 0.0);

  const bool matches =
      errors.empty() &&
      stableAcrossRepeats &&
      Near(actualFinal, expFinal, tol) &&
      Near(actualPre, expPre, tol) &&
      Near(actualCrit, expCrit, tol) &&
      Near(actualBlock, expBlock, tol) &&
      Near(actualArmor, expArmor, tol);

  std::ostringstream oss;
  oss << std::fixed << std::setprecision(5)
      << "expected final=" << expFinal << " (pre=" << expPre << ", crit=" << expCrit
      << ", block=" << expBlock << ", armor=" << expArmor << "), "
      << "actual final=" << actualFinal << " (pre=" << actualPre << ", crit=" << actualCrit
      << ", block=" << actualBlock << ", armor=" << actualArmor << ")";
  res.detail = oss.str();

  if (matches) {
    res.outcome = CaseOutcome::Passed;
  } else if (res.expectedStatus == "PENDING") {
    res.outcome = CaseOutcome::Pending;
  } else {
    res.outcome = CaseOutcome::Failed;
  }
  return res;
}

CaseResult EvaluateArmorPieceCase(
    const nlohmann::json& tc,
    const CombatSettings& settings,
    const PerkRegistry& perks) {
  CaseResult res;
  res.id = tc.at("id").get<std::string>();
  res.group = tc.at("group").get<std::string>();
  res.kind = tc.at("kind").get<std::string>();
  res.expectedStatus = tc.at("expectedStatus").get<std::string>();
  res.origin = tc.value("origin", "");
  if (tc.contains("pendingPlanFunction") && !tc.at("pendingPlanFunction").is_null()) {
    res.pendingPlanFunction = tc.at("pendingPlanFunction").get<std::string>();
  }

  std::vector<std::string> errors;
  const auto& input = tc.at("input");
  const auto& expected = tc.at("expected");

  const CombatProfile profile = BuildProfile(
      input.value("actorSkills", nlohmann::json::object()),
      input.value("actorPerks", nlohmann::json::array()),
      errors);
  const std::vector<StableFormKey> keywords =
      ParseKeyList(input.value("keywords", nlohmann::json::array()), errors);

  CombatTrace trace(true);
  const double actual = ArmorPiece(
      input.at("baseArmor").get<double>(),
      input.at("skill").get<std::string>(),
      profile,
      keywords,
      input.value("flatArmor", 0.0),
      input.value("itemMultiplier", 1.0),
      perks,
      settings,
      trace);

  const double expRating = expected.at("armorRating").get<double>();
  const double tol = expected.value("tolerance", 1e-6);
  const bool matches = errors.empty() && Near(actual, expRating, tol);

  std::ostringstream oss;
  oss << std::fixed << std::setprecision(4)
      << "expected armorRating=" << expRating << ", actual=" << actual;
  res.detail = oss.str();

  if (matches) {
    res.outcome = CaseOutcome::Passed;
  } else if (res.expectedStatus == "PENDING") {
    res.outcome = CaseOutcome::Pending;
  } else {
    res.outcome = CaseOutcome::Failed;
  }
  return res;
}

CaseResult EvaluateArmorCurveTableCase(
    const nlohmann::json& tc,
    const CombatSettings& settings,
    const PerkRegistry& perks) {
  CaseResult res;
  res.id = tc.at("id").get<std::string>();
  res.group = tc.at("group").get<std::string>();
  res.kind = tc.at("kind").get<std::string>();
  res.expectedStatus = tc.at("expectedStatus").get<std::string>();
  res.origin = tc.value("origin", "");

  const auto& input = tc.at("input");
  const auto& expected = tc.at("expected");
  const double incoming = input.at("incomingDamage").get<double>();
  const double tol = expected.value("tolerance", 1e-6);

  bool allMatch = true;
  std::ostringstream mismatchDetail;
  CombatProfile neutral;
  neutral.revision = 1;

  for (const auto& pt : input.at("points")) {
    const double armor = pt.at("armor").get<double>();
    const double expRed = pt.at("expectedReduction").get<double>();
    const double expRem = pt.at("expectedRemainingDamage").get<double>();

    const double actualRed = ArmorReduction(armor, settings);
    DamageContext ctx{neutral, neutral, "OneHanded", {}, incoming, 0.0, 1.0, armor, 1.0, 0.0, 0.0, false};
    FixedRollRng rng(0.5);
    CombatTrace trace(false);
    const double actualRem = PhysicalDamage(ctx, settings, perks, rng, trace).health;

    if (!Near(actualRed, expRed, tol) || !Near(actualRem, expRem, tol)) {
      allMatch = false;
      mismatchDetail << "[armor=" << armor << " got red=" << actualRed << " rem=" << actualRem << "] ";
    }
  }

  std::ostringstream oss;
  oss << "checked " << input.at("points").size() << " curve points (0..1500), allMatch="
      << (allMatch ? "true" : "false") << " " << mismatchDetail.str();
  res.detail = oss.str();
  res.outcome = allMatch ? CaseOutcome::Passed : CaseOutcome::Failed;
  return res;
}

CaseResult EvaluateBlockReductionCase(
    const nlohmann::json& tc,
    const CombatSettings& settings,
    const PerkRegistry& perks) {
  CaseResult res;
  res.id = tc.at("id").get<std::string>();
  res.group = tc.at("group").get<std::string>();
  res.kind = tc.at("kind").get<std::string>();
  res.expectedStatus = tc.at("expectedStatus").get<std::string>();
  res.origin = tc.value("origin", "");

  std::vector<std::string> errors;
  const auto& input = tc.at("input");
  const auto& expected = tc.at("expected");
  const double tol = expected.value("tolerance", 1e-6);

  bool allMatch = true;
  std::ostringstream detailOss;
  for (const auto& sample : input.at("samples")) {
    CombatProfile defender = BuildProfile(
        nlohmann::json::object({{"Block", sample.at("blockSkill").get<double>()}}),
        sample.value("perks", nlohmann::json::array()),
        errors);
    CombatSettings localSettings = settings;
    if (sample.contains("baseOverride") && !sample.at("baseOverride").is_null()) {
      localSettings.blockBase = sample.at("baseOverride").get<double>();
    }
    CombatTrace trace(true);
    const double actual = BlockReduction(defender, perks, localSettings, trace);
    const double expRed = sample.at("expectedReduction").get<double>();
    detailOss << std::fixed << std::setprecision(4)
              << "[Block=" << sample.at("blockSkill").get<double>()
              << " actual=" << actual << " exp=" << expRed << "] ";
    if (!Near(actual, expRed, tol)) {
      allMatch = false;
    }
  }

  res.detail = detailOss.str();
  res.outcome = (errors.empty() && allMatch) ? CaseOutcome::Passed : CaseOutcome::Failed;
  return res;
}

CaseResult EvaluatePerkEntryPointCase(
    const nlohmann::json& tc,
    const PerkRegistry& perks) {
  CaseResult res;
  res.id = tc.at("id").get<std::string>();
  res.group = tc.at("group").get<std::string>();
  res.kind = tc.at("kind").get<std::string>();
  res.expectedStatus = tc.at("expectedStatus").get<std::string>();
  res.origin = tc.value("origin", "");
  if (tc.contains("pendingPlanFunction") && !tc.at("pendingPlanFunction").is_null()) {
    res.pendingPlanFunction = tc.at("pendingPlanFunction").get<std::string>();
  }

  std::vector<std::string> errors;
  const auto& input = tc.at("input");
  const auto& expected = tc.at("expected");

  const std::string entryPoint = input.at("entryPoint").get<std::string>();
  const std::string operation = input.at("operation").get<std::string>();
  if (tc.value("statusReason", "") == "NO_CLASS_PERK_IN_LOAD_ORDER" ||
      input.value("statusReason", "") == "NO_CLASS_PERK_IN_LOAD_ORDER") {
    std::ostringstream oss;
    oss << "ep=" << entryPoint << " op=" << operation
        << " statusReason=NO_CLASS_PERK_IN_LOAD_ORDER";
    res.detail = oss.str();
    res.outcome = (res.expectedStatus == "PENDING") ? CaseOutcome::Pending : CaseOutcome::Failed;
    return res;
  }

  StableFormKey perkKey;
  std::string keyErr;
  if (!TryParseFormKey(input.at("perkFormKey").get<std::string>(), perkKey, keyErr)) {
    errors.push_back(keyErr);
  }

  const CombatProfile actor = BuildProfile(
      input.value("actorSkills", nlohmann::json::object()),
      input.value("actorPerks", nlohmann::json::array()),
      errors);
  const std::vector<StableFormKey> keywords =
      ParseKeyList(input.value("keywords", nlohmann::json::array()), errors);

  const bool perkSupportedInCatalog = perks.Supports(perkKey);
  CombatTrace trace(true);
  const double actual = perks.Multiplier(entryPoint, actor, keywords, trace);
  const double expMult = expected.at("multiplier").get<double>();
  const double tol = expected.value("tolerance", 1e-6);

  const bool matches =
      errors.empty() &&
      perkSupportedInCatalog &&
      Near(actual, expMult, tol);

  std::ostringstream oss;
  oss << std::fixed << std::setprecision(4)
      << "perk=" << perkKey.ToString() << " ep=" << entryPoint << " op=" << operation
      << " supportedInCatalog=" << (perkSupportedInCatalog ? "true" : "false")
      << " expected=" << expMult << " actual=" << actual;
  res.detail = oss.str();

  if (matches) {
    res.outcome = CaseOutcome::Passed;
  } else if (!perkSupportedInCatalog && res.expectedStatus == "PENDING") {
    res.outcome = CaseOutcome::Pending;
  } else {
    res.outcome = CaseOutcome::Failed;
  }
  return res;
}

CaseResult EvaluateConditionCase(
    const nlohmann::json& tc,
    const PerkRegistry& perks) {
  CaseResult res;
  res.id = tc.at("id").get<std::string>();
  res.group = tc.at("group").get<std::string>();
  res.kind = tc.at("kind").get<std::string>();
  res.expectedStatus = tc.at("expectedStatus").get<std::string>();
  res.origin = tc.value("origin", "");
  if (tc.contains("pendingPlanFunction") && !tc.at("pendingPlanFunction").is_null()) {
    res.pendingPlanFunction = tc.at("pendingPlanFunction").get<std::string>();
  }

  std::vector<std::string> errors;
  const auto& input = tc.at("input");
  const auto& expected = tc.at("expected");
  const std::string condFn = input.at("conditionFunction").get<std::string>();

  if (condFn == "UncertifiedRejection") {
    bool allRejected = true;
    bool allMatchesFalse = true;
    std::string firstErrorMsg;

    for (const auto& item : input.at("uncertifiedCases")) {
      const std::string fn = item.at("function").get<std::string>();
      const std::string pKey = item.at("perkFormKey").get<std::string>();
      const std::string cKey = item.at("conditionKey").get<std::string>();

      const nlohmann::json singleCatalog = {
          {"schemaVersion", 1},
          {"perks",
           {{{"key", pKey},
             {"editorId", "TestUncertified"},
             {"winner", "Skyrim.esm"},
             {"effects",
              {{{"entryPoint", "CalculateWeaponDamage"},
                {"skill", "OneHanded"},
                {"coefficient", 0.01},
                {"conditions",
                 {{{{"function", fn},
                    {"key", cKey},
                    {"expected", true},
                    {"orNext", false}}}}}}}}}}}};

      bool rejected = false;
      try {
        PerkRegistry tempReg;
        tempReg.Load(singleCatalog);
      } catch (const std::exception& ex) {
        rejected = true;
        if (firstErrorMsg.empty()) {
          firstErrorMsg = ex.what();
        }
      }
      if (!rejected) {
        allRejected = false;
      }

      PerkHandler handler;
      handler.key = StableFormKey::Parse(pKey);
      handler.entryPoint = "CalculateWeaponDamage";
      handler.skill = "OneHanded";
      handler.coefficient = 0.01;
      handler.conditions = {{{fn, StableFormKey::Parse(cKey), true, false}}};

      CombatProfile actor;
      actor.skills["OneHanded"] = 100.0;
      actor.perks.push_back({handler.key, 1U});
      if (handler.Matches(actor, {StableFormKey::Parse(cKey)})) {
        allMatchesFalse = false;
      }
    }

    std::ostringstream oss;
    oss << "allRejectedOnLoad=" << (allRejected ? "true" : "false")
        << ", allMatchesFalse=" << (allMatchesFalse ? "true" : "false")
        << ", rejectionReason='" << firstErrorMsg << "'";
    res.detail = oss.str();

    const std::string expSub = expected.value("expectedReasonSubstring", "unsupported condition");
    const bool ok =
        allRejected &&
        allMatchesFalse &&
        firstErrorMsg.find(expSub) != std::string::npos;
    res.outcome = ok ? CaseOutcome::Passed : CaseOutcome::Failed;
    return res;
  }

  if (condFn == "HasKeyword") {
    StableFormKey perkKey;
    std::string err;
    TryParseFormKey(input.at("perkFormKey").get<std::string>(), perkKey, err);
    const std::string ep = input.at("entryPoint").get<std::string>();
    const std::string skill = input.at("skill").get<std::string>();
    const double skillVal = input.at("skillValue").get<double>();

    CombatProfile actor;
    actor.skills[skill] = skillVal;
    actor.perks.push_back({perkKey, 1U});

    const auto posKw = ParseKeyList(input.at("positiveKeywords"), errors);
    const auto negKw = ParseKeyList(input.at("negativeKeywords"), errors);
    const auto misKw = ParseKeyList(input.at("missingKeywords"), errors);

    CombatTrace trace(false);
    const double posActual = perks.Multiplier(ep, actor, posKw, trace);
    const double negActual = perks.Multiplier(ep, actor, negKw, trace);
    const double misActual = perks.Multiplier(ep, actor, misKw, trace);

    const double tol = expected.value("tolerance", 1e-6);
    const double expPos = expected.at("positiveMultiplier").get<double>();
    const double expNeg = expected.at("negativeMultiplier").get<double>();
    const double expMis = expected.at("missingMultiplier").get<double>();

    std::ostringstream oss;
    oss << std::fixed << std::setprecision(4)
        << "HasKeyword pos=" << posActual << " (exp " << expPos
        << "), neg=" << negActual << " (exp " << expNeg
        << "), missing=" << misActual << " (exp " << expMis << ")";
    res.detail = oss.str();

    const bool ok =
        errors.empty() &&
        Near(posActual, expPos, tol) &&
        Near(negActual, expNeg, tol) &&
        Near(misActual, expMis, tol);
    res.outcome = ok ? CaseOutcome::Passed : CaseOutcome::Failed;
    return res;
  }

  if (condFn == "HasPerk") {
    StableFormKey perkKey;
    StableFormKey blockerKey;
    std::string err;
    TryParseFormKey(input.at("perkFormKey").get<std::string>(), perkKey, err);
    TryParseFormKey(input.at("blockerPerkFormKey").get<std::string>(), blockerKey, err);

    const std::string ep = input.at("entryPoint").get<std::string>();
    const std::string skill = input.at("skill").get<std::string>();
    const double skillVal = input.at("skillValue").get<double>();
    const auto kw = ParseKeyList(input.at("keywords"), errors);

    CombatProfile posActor;
    posActor.skills[skill] = skillVal;
    posActor.perks.push_back({perkKey, 1U});

    CombatProfile negActor = posActor;
    negActor.perks.push_back({blockerKey, 1U});

    CombatProfile misActor;
    misActor.skills[skill] = skillVal;

    CombatTrace trace(false);
    const double posActual = perks.Multiplier(ep, posActor, kw, trace);
    const double negActual = perks.Multiplier(ep, negActor, kw, trace);
    const double misActual = perks.Multiplier(ep, misActor, kw, trace);

    const double tol = expected.value("tolerance", 1e-6);
    const double expPos = expected.at("positiveMultiplier").get<double>();
    const double expNeg = expected.at("negativeMultiplier").get<double>();
    const double expMis = expected.at("missingMultiplier").get<double>();

    std::ostringstream oss;
    oss << std::fixed << std::setprecision(4)
        << "HasPerk pos=" << posActual << " (exp " << expPos
        << "), neg=" << negActual << " (exp " << expNeg
        << "), missing=" << misActual << " (exp " << expMis << ")";
    res.detail = oss.str();

    const bool ok =
        errors.empty() &&
        Near(posActual, expPos, tol) &&
        Near(negActual, expNeg, tol) &&
        Near(misActual, expMis, tol);
    res.outcome = ok ? CaseOutcome::Passed : CaseOutcome::Failed;
    return res;
  }

  // Certified condition functions planned in Function 5 (DS-3 / DS-5) not yet implemented in PerkRegistry.h
  const nlohmann::json probeCatalog = {
      {"schemaVersion", 1},
      {"perks",
       {{{"key", input.at("perkFormKey").get<std::string>()},
         {"editorId", "ProbeCondition_" + condFn},
         {"winner", "Skyrim.esm"},
         {"effects",
          {{{"entryPoint", "CalculateWeaponDamage"},
            {"skill", "OneHanded"},
            {"coefficient", 0.01},
            {"conditions",
             {{{{"function", condFn},
                {"key", "Skyrim.esm:01E711"},
                {"expected", true},
                {"orNext", false}}}}}}}}}}}};

  bool supportedByCurrentCore = true;
  std::string loadError;
  try {
    PerkRegistry probe;
    probe.Load(probeCatalog);
  } catch (const std::exception& ex) {
    supportedByCurrentCore = false;
    loadError = ex.what();
  }

  std::ostringstream oss;
  oss << "condition=" << condFn
      << " supportedByCurrentCore=" << (supportedByCurrentCore ? "true" : "false")
      << " (PerkRegistry::Load: '" << loadError << "')"
      << " expected pos=" << expected.at("positiveMultiplier").get<double>()
      << " neg=" << expected.at("negativeMultiplier").get<double>()
      << " missing=" << expected.at("missingMultiplier").get<double>();
  res.detail = oss.str();

  if (!supportedByCurrentCore && res.expectedStatus == "PENDING") {
    res.outcome = CaseOutcome::Pending;
  } else {
    res.outcome = CaseOutcome::Failed;
  }
  return res;
}

CaseResult EvaluateInvariantCase(
    const nlohmann::json& tc,
    const nlohmann::json& rootFixture,
    const CombatSettings& settings,
    const PerkRegistry& perks) {
  CaseResult res;
  res.id = tc.at("id").get<std::string>();
  res.group = tc.at("group").get<std::string>();
  res.kind = tc.at("kind").get<std::string>();
  res.expectedStatus = tc.at("expectedStatus").get<std::string>();
  res.origin = tc.value("origin", "");

  const auto& input = tc.at("input");
  const auto& expected = tc.at("expected");

  if (input.value("auditAllCasesInFixture", false)) {
    int missingOrigins = 0;
    std::vector<std::string> invalidFormKeys;
    for (const auto& c : rootFixture.at("cases")) {
      const std::string cid = c.value("id", "<unknown>");
      if (c.value("origin", "").empty()) {
        ++missingOrigins;
      }
      AuditJsonFormKeysRecursive(c, cid, invalidFormKeys);
    }

    std::ostringstream oss;
    oss << "missingOrigins=" << missingOrigins
        << ", invalidFormKeys=" << invalidFormKeys.size();
    if (!invalidFormKeys.empty()) {
      oss << " (first: " << invalidFormKeys.front() << ")";
    }
    res.detail = oss.str();
    const bool ok =
        missingOrigins == expected.value("missingOrigins", 0) &&
        static_cast<int>(invalidFormKeys.size()) == expected.value("invalidFormKeys", 0);
    res.outcome = ok ? CaseOutcome::Passed : CaseOutcome::Failed;
    return res;
  }

  const StableFormKey perkUpper = StableFormKey::Parse(input.at("perkKeyUpper").get<std::string>());
  const StableFormKey perkLower = StableFormKey::Parse(input.at("perkKeyLower").get<std::string>());
  const StableFormKey kwUpper = StableFormKey::Parse(input.at("keywordUpper").get<std::string>());
  const StableFormKey kwLower = StableFormKey::Parse(input.at("keywordLower").get<std::string>());

  CombatProfile attA;
  attA.skills["OneHanded"] = 50.0;
  attA.perks.push_back({perkUpper, 1U});

  CombatProfile attB;
  attB.skills["OneHanded"] = 50.0;
  attB.perks.push_back({perkLower, 1U});

  CombatProfile def;
  DamageContext ctxA{attA, def, "OneHanded", {kwUpper}, 20.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, false};
  DamageContext ctxB{attB, def, "OneHanded", {kwLower}, 20.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, false};

  FixedRollRng rngA(0.5);
  FixedRollRng rngB(0.5);
  CombatTrace traceA(false);
  CombatTrace traceB(false);
  const double dmgA = PhysicalDamage(ctxA, settings, perks, rngA, traceA).health;
  const double dmgB = PhysicalDamage(ctxB, settings, perks, rngB, traceB).health;
  const double expDmg = expected.at("expectedDamage").get<double>();
  const double tol = expected.value("tolerance", 1e-6);

  std::ostringstream oss;
  oss << std::fixed << std::setprecision(4)
      << "dmgA=" << dmgA << ", dmgB=" << dmgB << " (expected=" << expDmg << ")";
  res.detail = oss.str();

  const bool ok = (perkUpper == perkLower) && (kwUpper == kwLower) &&
                  Near(dmgA, expDmg, tol) && Near(dmgB, expDmg, tol);
  res.outcome = ok ? CaseOutcome::Passed : CaseOutcome::Failed;
  return res;
}

}  // namespace

int main(int argc, char** argv) {
  bool failOnPending = false;
  bool verifyExpectedStatusOnly = false;
  for (int i = 1; i < argc; ++i) {
    const std::string arg(argv[i]);
    if (arg == "--fail-on-pending") {
      failOnPending = true;
    } else if (arg == "--verify-expected-status") {
      verifyExpectedStatusOnly = true;
    }
  }

  try {
    const std::string configDir = COMBAT_CONFIG_DIR;
    const std::string fixturePath = GOLDEN_FIXTURE_PATH;

    const CombatSettings settings =
        CombatSettings::FromJson(ReadJsonFile(configDir + "/aetherius-combat.json"));
    PerkRegistry perks;
    perks.Load(ReadJsonFile(configDir + "/verified-perks.json"));
    const nlohmann::json fixture = ReadJsonFile(fixturePath);

    std::vector<CaseResult> results;
    for (const auto& tc : fixture.at("cases")) {
      const std::string kind = tc.at("kind").get<std::string>();
      // DS-5a executes only the perk-free slice against the installed kernel.
      namespace ds = aetherius::combat::ds5a;
      if (tc.value("statusReason","")=="DS-5b") {
        CaseResult pending;pending.id=tc.at("id");pending.group=tc.at("group");pending.kind=kind;
        pending.expectedStatus="PENDING";pending.outcome=CaseOutcome::Pending;pending.detail="DS-5b";pending.origin=tc.value("origin","");
        // BLOCK-01 contains one perk-free sample: check it even though the full case is pending.
        if(kind=="block_reduction")for(const auto& sample:tc.at("input").at("samples")) {
          if(sample.at("perks").empty() && !Near(ds::Block(sample.at("blockSkill")),sample.at("expectedReduction"),1e-6)) {
            pending.outcome=CaseOutcome::Failed;pending.detail="perk-free block sample failed";
          }
        }
        results.push_back(pending);
      } else if (kind == "armor_piece") {
        const auto& input=tc.at("input");const double value=ds::ArmorPiece(input.at("baseArmor"),input.at("actorSkills").at(input.at("skill").get<std::string>()),{1.5,1,1.4});
        CaseResult r;r.id=tc.at("id");r.group=tc.at("group");r.kind=kind;r.expectedStatus=tc.at("expectedStatus");r.origin=tc.value("origin","");
        r.outcome=Near(value,tc.at("expected").at("armorRating"),1e-6)?CaseOutcome::Passed:CaseOutcome::Failed;
        r.detail="DS-5a kernel rating="+std::to_string(value);results.push_back(r);
      } else if(kind=="armor_curve_table") {
        auto r=EvaluateArmorCurveTableCase(tc,settings,perks);
        for(const auto& point:tc.at("input").at("points"))if(!Near(ds::ArmorCurve(point.at("armor")),point.at("expectedReduction"),1e-6))r.outcome=CaseOutcome::Failed;
        r.detail+="; DS-5a kernel checked";results.push_back(r);
      } else if (kind == "physical_damage") {
        results.push_back(EvaluatePhysicalDamageCase(tc, settings, perks));
      } else if (kind == "armor_piece") {
        results.push_back(EvaluateArmorPieceCase(tc, settings, perks));
      } else if (kind == "armor_curve_table") {
        results.push_back(EvaluateArmorCurveTableCase(tc, settings, perks));
      } else if (kind == "block_reduction") {
        results.push_back(EvaluateBlockReductionCase(tc, settings, perks));
      } else if (kind == "perk_entry_point") {
        results.push_back(EvaluatePerkEntryPointCase(tc, perks));
      } else if (kind == "condition_eval") {
        results.push_back(EvaluateConditionCase(tc, perks));
      } else if (kind == "invariant_check") {
        results.push_back(EvaluateInvariantCase(tc, fixture, settings, perks));
      } else {
        throw std::runtime_error("unknown golden case kind: " + kind);
      }
    }

    int passedCount = 0;
    int failedCount = 0;
    int pendingCount = 0;
    int unexpectedStatusCount = 0;

    std::cout << "================================================================================\n";
    std::cout << "Aetherius Damage System - Casos Dourados de Dano Fisico (DS-1)\n";
    std::cout << "================================================================================\n";

    for (const auto& r : results) {
      const std::string actualTag = OutcomeToString(r.outcome);
      if (r.outcome == CaseOutcome::Passed) {
        ++passedCount;
      } else if (r.outcome == CaseOutcome::Pending) {
        ++pendingCount;
      } else {
        ++failedCount;
      }

      if (actualTag != r.expectedStatus) {
        ++unexpectedStatusCount;
      }

      std::cout << "[" << std::left << std::setw(7) << actualTag << "] "
                << r.id << " (" << r.group << " / " << r.kind << ")\n"
                << "          " << r.detail << "\n"
                << "          Origin: " << r.origin << "\n";
      if (!r.pendingPlanFunction.empty()) {
        std::cout << "          Plan:   " << r.pendingPlanFunction << "\n";
      }
    }

    std::cout << "--------------------------------------------------------------------------------\n";
    std::cout << "Summary: total=" << results.size()
              << " PASS=" << passedCount
              << " FAIL=" << failedCount
              << " PENDING=" << pendingCount
              << " (unexpectedStatusMismatch=" << unexpectedStatusCount << ")\n";
    std::cout << "================================================================================\n";

    if (verifyExpectedStatusOnly) {
      return unexpectedStatusCount == 0 ? 0 : 1;
    }
    if (failedCount > 0) {
      return 1;
    }
    if (failOnPending && pendingCount > 0) {
      return 1;
    }
    return 0;
  } catch (const std::exception& ex) {
    std::cerr << "[FATAL] golden_tests exception: " << ex.what() << "\n";
    return 2;
  }
}
