#include "PartOne.h"
#include "MpActor.h"
#include "aetherius_combat/AetheriusDamageFormula.h"
#include "formulas/ShadowDamageFormula.h"
#include "formulas/TES5DamageFormula.h"
#include "formulas/DamageMultFormula.h"
#include "formulas/SweetPieDamageFormula.h"
#include "formulas/SweetPieSpellDamageFormula.h"
#include "formulas/DamageMultConditionalFormula.h"
#include "condition_functions/ConditionFunctionFactory.h"
#include <chrono>
#include <fstream>
#include <iostream>
#include <limits>

namespace {
int checks = 0;
void Check(bool ok, const char* why) {
  ++checks;
  if (!ok) throw std::runtime_error(why);
}
void Near(float actual, float expected, const char* why) {
  Check(std::abs(actual - expected) < 0.00001f, why);
}
std::unique_ptr<IDamageFormula> Legacy() {
  std::unique_ptr<IDamageFormula> formula = std::make_unique<TES5DamageFormula>();
  formula = std::make_unique<DamageMultFormula>(std::move(formula),
    nlohmann::json{{"multiplier", 1}});
  formula = std::make_unique<SweetPieDamageFormula>(std::move(formula), nullptr);
  formula = std::make_unique<SweetPieSpellDamageFormula>(std::move(formula), nullptr);
  formula = std::make_unique<DamageMultConditionalFormula>(std::move(formula),
    nullptr, nullptr, std::make_shared<ConditionFunctionMap>(
      ConditionFunctionFactory::CreateConditionFunctions()));
  return formula;
}
class FaultFormula final : public IDamageFormula {
public:
  explicit FaultFormula(int fault) : fault(fault) {}
  float CalculateDamage(const MpActor&, const MpActor&, const HitData&) const override {
    if (fault == 0) throw std::runtime_error("injected candidate exception");
    if (fault == 1) return std::numeric_limits<float>::quiet_NaN();
    if (fault == 2) return std::numeric_limits<float>::infinity();
    if (fault == 3) return -1;
    if (fault == 4) throw 7; // A non-std exception must also stay isolated.
    return 12;
  }
  float CalculateDamage(const MpActor&, const MpActor&, const SpellCastData&) const override {
    if (fault == 5) return 17;
    throw std::runtime_error("magic candidate must not run");
  }
private:
  int fault;
};
Inventory::Entry Worn(uint32_t id) {
  Inventory::Entry entry(id, 1);
  entry.SetWorn(Inventory::Worn::Right);
  return entry;
}

void Run(const std::filesystem::path& manifestPath) {
  std::cout << std::unitbuf;
  std::ifstream in(manifestPath);
  nlohmann::json manifest;
  in >> manifest;
  std::vector<std::filesystem::path> paths;
  for (const auto& row : manifest.at("plugins"))
    paths.push_back(manifestPath.parent_path() / row.at("filename").get<std::string>());
  espm::Loader loader(paths);
  std::cout << "Host load order: " << paths.size() << " plugins\n";
  PartOne host;
  host.AttachEspm(&loader);
  host.CreateActor(0xff000001, {0, 0, 0}, 0, 0x3c);
  host.CreateActor(0xff000002, {0, 0, 0}, 0, 0x3c);
  auto& attacker = host.worldState.GetFormAt<MpActor>(0xff000001);
  auto& defender = host.worldState.GetFormAt<MpActor>(0xff000002);
  Equipment equipment;
  equipment.inv.entries.push_back(Worn(0x1397e));
  attacker.SetEquipment(equipment);
  Equipment armor;
  armor.inv.entries.push_back(Worn(0x12e46));
  defender.SetEquipment(armor);
  const auto& browser = loader.GetBrowser();
  auto& cache = browser.GetCache();
  const auto weaponData = espm::Convert<espm::WEAP>(browser.LookupById(0x1397e).rec)->GetData(cache);
  const auto armorData = espm::Convert<espm::ARMO>(browser.LookupById(0x12e46).rec)->GetData(cache);
  const auto rating = armorData.baseRatingX100 / 100.0;
  const float weaponBase = static_cast<float>(weaponData.weapData->damage);
  std::cout << "Winner facts: dagger=" << weaponBase << " gauntlets=" << rating << '\n';
  Check(!armorData.enchantmentFormId, "fixture must be unenchanted winning armor");
  auto before = Legacy();
  auto off = Legacy();
  auto buffer = std::make_shared<ShadowDamageFormula::Buffer>();
  ShadowDamageFormula on(Legacy(),
    std::make_unique<aetherius::combat::AetheriusDamageFormula>(browser,
      std::vector<aetherius::combat::StableFormKey>{
        aetherius::combat::StableFormKey::Parse("Skyrim.esm:01397E"),
        aetherius::combat::StableFormKey::Parse("Skyrim.esm:012E46")}), buffer);
  const auto scaling = espm::GetData<espm::GMST>(espm::GMST::kFArmorScalingFactor, &host.worldState).value;
  const auto maxArmor = espm::GetData<espm::GMST>(espm::GMST::kFMaxArmorRating, &host.worldState).value;
  HitData hit{};
  hit.aggressor = attacker.GetFormId(); hit.target = defender.GetFormId();
  hit.source = 0x1397e;
  // All eight power/block/sneak combinations, with native Block off and on.
  for (bool nativeBlock : {false, true}) {
    defender.SetIsBlockActive(nativeBlock);
    for (int flags = 0; flags < 8; ++flags) {
      hit.isPowerAttack = (flags & 1) != 0;
      hit.isHitBlocked = (flags & 2) != 0;
      hit.isSneakAttack = (flags & 4) != 0;
      float golden = weaponBase * .01f * (100.f - std::min(
        static_cast<float>(rating) * scaling, maxArmor));
      if (hit.isPowerAttack) golden *= 2.f;
      if (hit.isHitBlocked) golden *= .1f;
      if (hit.isSneakAttack) golden *= 1.3f;
      const auto original = before->CalculateDamage(attacker, defender, hit);
      Near(original, golden, "legacy flag golden changed");
      Check(off->CalculateDamage(attacker, defender, hit) == original, "off differs from original chain");
      Check(on.CalculateDamage(attacker, defender, hit) == original, "shadow changed applied damage");
      const auto& sample = buffer->samples[buffer->next - 1];
      Check(sample.status == ShadowDamageFormula::Status::Calculated, "candidate not calculated");
      const float candidate = static_cast<float>(weaponBase * (1 - rating * .8 / 500) *
        (hit.isHitBlocked && nativeBlock ? .8 : 1));
      Near(sample.candidate, candidate, "candidate physical golden changed");
      Check(sample.neutralProfile && sample.hit.isPowerAttack == hit.isPowerAttack &&
        sample.hit.isHitBlocked == hit.isHitBlocked && sample.hit.isSneakAttack == hit.isSneakAttack,
        "sample context missing");
      std::cout << "flags=" << flags << " nativeBlock=" << nativeBlock
        << " off=" << original << " returned=" << sample.current
        << " candidate=" << sample.candidate << " neutral=true\n";
    }
  }
  std::cout << "BEGIN outside-hit snapshot; size=" << buffer->size << " next=" << buffer->next << '\n';
  const auto initialSnapshot = buffer->Read();
  std::cout << "Outside-hit snapshot: " << initialSnapshot.dump() << '\n';
  hit.isPowerAttack = hit.isHitBlocked = hit.isSneakAttack = false;
  const auto baseline = before->CalculateDamage(attacker, defender, hit);
  for (int fault = 0; fault < 5; ++fault) {
    auto failures = std::make_shared<ShadowDamageFormula::Buffer>();
    ShadowDamageFormula shadow(Legacy(), std::make_unique<FaultFormula>(fault), failures);
    Check(shadow.CalculateDamage(attacker, defender, hit) == baseline, "fault changed applied result");
    Check(failures->failures == 1 && failures->hits == 1, "failure counter missing");
    Check(failures->invalid == (fault >= 1 && fault <= 3 ? 1u : 0u), "invalid counter");
    Check(failures->exceptions == (fault == 0 || fault == 4 ? 1u : 0u), "exception counter");
    Check(failures->Read()["samples"][0]["candidate"].is_null(), "failed candidate must be null");
    std::cout << "Fault " << fault << ": " << failures->Read().dump() << '\n';
  }
  auto currentFailures = std::make_shared<ShadowDamageFormula::Buffer>();
  ShadowDamageFormula failedCurrent(std::make_unique<FaultFormula>(0),
    std::make_unique<FaultFormula>(5), currentFailures);
  bool threw = false;
  try { (void)failedCurrent.CalculateDamage(attacker, defender, hit); } catch (...) { threw = true; }
  Check(threw && currentFailures->hits == 0, "current exception must retain original behavior");

  // Real candidate rejects incomplete input without applying an invented value.
  equipment.inv.entries.clear(); attacker.SetEquipment(equipment);
  Check(on.CalculateDamage(attacker, defender, hit) == baseline, "unsupported source changed current");
  Check(buffer->samples[buffer->next - 1].reason == aetherius::combat::UnsupportedReason::SourceNotEquipped,
    "source not equipped reason");
  equipment.inv.entries.push_back(Worn(0x1397e)); attacker.SetEquipment(equipment);
  armor.inv.entries[0].enchantmentId = 1; defender.SetEquipment(armor);
  Check(on.CalculateDamage(attacker, defender, hit) == baseline, "unsupported enchanted armor changed current");
  Check(buffer->samples[buffer->next - 1].reason == aetherius::combat::UnsupportedReason::EnchantedArmor,
    "enchanted armor reason");
  armor.inv.entries[0].enchantmentId.reset(); defender.SetEquipment(armor);
  equipment.inv.entries.resize(65); attacker.SetEquipment(equipment);
  Check(on.CalculateDamage(attacker, defender, hit) == baseline, "equipment limit changed current");
  Check(buffer->samples[buffer->next - 1].reason == aetherius::combat::UnsupportedReason::EquipmentCapacity,
    "equipment capacity reason");
  equipment.inv.entries.resize(1); attacker.SetEquipment(equipment);
  equipment.inv.entries.push_back(Worn(0x1397e)); attacker.SetEquipment(equipment);
  Check(on.CalculateDamage(attacker, defender, hit) == baseline, "duplicate weapon changed current");
  Check(buffer->samples[buffer->next - 1].reason == aetherius::combat::UnsupportedReason::DuplicateWeapon,
    "duplicate equipped weapon reason");
  equipment.inv.entries.resize(1);
  equipment.inv.entries[0] = Worn(0x12eb7); attacker.SetEquipment(equipment);
  hit.source = 0x12eb7;
  const auto unprepared = before->CalculateDamage(attacker, defender, hit);
  Check(on.CalculateDamage(attacker, defender, hit) == unprepared, "missing prepared record changed current");
  Check(buffer->samples[buffer->next - 1].reason == aetherius::combat::UnsupportedReason::MissingRecord,
    "missing prepared record reason");
  equipment.inv.entries[0] = Worn(0x1397e); attacker.SetEquipment(equipment);
  hit.source = 0x1f4;
  const auto unarmed = before->CalculateDamage(attacker, defender, hit);
  Check(on.CalculateDamage(attacker, defender, hit) == unarmed, "unarmed changed current");
  Check(buffer->samples[buffer->next - 1].reason == aetherius::combat::UnsupportedReason::UnarmedRaceSnapshot,
    "unarmed needs bounded race context");
  hit.source = 0x1397e;
  auto ring = std::make_shared<ShadowDamageFormula::Buffer>();
  ShadowDamageFormula bounded(Legacy(), std::make_unique<FaultFormula>(5), ring);
  for (size_t i = 0; i < ShadowDamageFormula::kCapacity + 17; ++i)
    (void)bounded.CalculateDamage(attacker, defender, hit);
  const auto ringJson = ring->Read();
  Check(ring->size == ShadowDamageFormula::kCapacity && ring->hits == ShadowDamageFormula::kCapacity + 17,
    "ring grew beyond fixed capacity");
  Check(ringJson["overwritten"] == 17 && ringJson["samples"][0]["sequence"] == 18 &&
    ringJson["samples"].back()["sequence"] == ring->hits, "ring order/overwrite incorrect");
  std::cout << "Fixed buffer bytes=" << sizeof(ShadowDamageFormula::Buffer)
    << " capacity=" << ring->size << " overwritten=" << ringJson["overwritten"] << '\n';
  ShadowDamageFormula magic(std::make_unique<FaultFormula>(5), std::make_unique<FaultFormula>(0), ring);
  Check(magic.CalculateDamage(attacker, defender, SpellCastData{}) == 17, "spell pass through changed");
  Check(ring->hits == ShadowDamageFormula::kCapacity + 17, "magic must not enter physical buffer");

  // Warm legacy record caches before timing. No JSON/log/output in timed loops.
  for (int i = 0; i < 1000; ++i) { (void)off->CalculateDamage(attacker, defender, hit); (void)on.CalculateDamage(attacker, defender, hit); }
  constexpr int iterations = 20000;
  volatile double sink = 0;
  auto bench = [&](const IDamageFormula& formula) {
    const auto start = std::chrono::steady_clock::now();
    for (int i = 0; i < iterations; ++i) sink = sink + formula.CalculateDamage(attacker, defender, hit);
    return std::chrono::duration<double, std::nano>(std::chrono::steady_clock::now() - start).count() / iterations;
  };
  double offSum = 0, onSum = 0;
  for (int round = 0; round < 5; ++round) {
    const auto offNs = round % 2 ? bench(*off) : 0;
    const auto onNs = bench(on);
    const auto finalOffNs = round % 2 ? offNs : bench(*off);
    offSum += finalOffNs; onSum += onNs;
    std::cout << "BENCH round=" << round << " iterations=" << iterations
      << " off_ns=" << finalOffNs << " shadow_ns=" << onNs << " added_ns=" << onNs - finalOffNs << '\n';
  }
  Check(buffer->size == ShadowDamageFormula::kCapacity && sink > 0, "benchmark/capacity check");
  std::cout << "BENCH mean off_ns=" << offSum / 5 << " shadow_ns=" << onSum / 5
    << " added_ns=" << (onSum - offSum) / 5 << '\n';
  // Isolate the added work from the much slower legacy lookup path: short
  // full-chain runs can otherwise hide sub-microsecond cost under timing noise.
  FaultFormula fixedCurrent(5);
  auto isolatedBuffer = std::make_shared<ShadowDamageFormula::Buffer>();
  ShadowDamageFormula isolated(std::make_unique<FaultFormula>(5),
    std::make_unique<aetherius::combat::AetheriusDamageFormula>(browser,
      std::vector<aetherius::combat::StableFormKey>{
        aetherius::combat::StableFormKey::Parse("Skyrim.esm:01397E"),
        aetherius::combat::StableFormKey::Parse("Skyrim.esm:012E46")}), isolatedBuffer);
  constexpr int isolatedIterations = 500000;
  auto isolatedBench = [&](const IDamageFormula& formula) {
    const auto start = std::chrono::steady_clock::now();
    for (int i = 0; i < isolatedIterations; ++i)
      sink = sink + formula.CalculateDamage(attacker, defender, hit);
    return std::chrono::duration<double, std::nano>(std::chrono::steady_clock::now() - start).count() / isolatedIterations;
  };
  for (int round = 0; round < 3; ++round) {
    const auto fixedNs = isolatedBench(fixedCurrent);
    const auto shadowNs = isolatedBench(isolated);
    std::cout << "ISOLATED round=" << round << " iterations=" << isolatedIterations
      << " fixed_ns=" << fixedNs << " shadow_ns=" << shadowNs
      << " added_ns=" << shadowNs - fixedNs << '\n';
  }
  std::cout << "PASS " << checks << " checks\n";
}
}

#include "WeaponPoisonTest.h" // AETHERIUS D-P1: reuse the approved standalone test target.
#include "WeaponPoisonNpcTest.h" // FIX-1010 hosted NPC reproduction.
#include "WeaponPoisonIntentTest.h" // D-P1-fix2 actual command, no OnEquip assumption.
#include "DevAttributesTest.h" // AETHERIUS DEV-A1: native resource acceptance, no sockets.

#ifdef AETHERIUS_SHADOW_STANDALONE
int main(int argc, char** argv) {
  try {
    if (argc == 3 && std::string(argv[1]) == "--dev-attributes") { RunDevAttributesTests(argv[2]); return 0; } // AETHERIUS DEV-A1
    if (argc == 4 && std::string(argv[1]) == "--poison-intent") { RunWeaponPoisonIntentTests(argv[2], argv[3]); return 0; }
    if (argc == 3 && std::string(argv[1]) == "--npc") { RunWeaponPoisonNpcTests(argv[2]); return 0; }
    if (argc == 4 && std::string(argv[1]) == "--poison") { RunWeaponPoisonTests(argv[2], argv[3]); return 0; } // AETHERIUS D-P1
    if (argc != 2) throw std::runtime_error("usage: aetherius-shadow-test <loadorder-manifest>");
    Run(argv[1]); return 0;
  } catch (const std::exception& e) {
    std::cerr << "FAIL after " << checks << " checks: " << e.what() << '\n'; return 1;
  }
}
#else
#include <catch2/catch_all.hpp>
TEST_CASE("Aetherius shadow acceptance", "[aetherius-shadow][espm]") {
  Run(std::filesystem::path(DIST_DIR) / "server/data/aetherius-loadorder.json");
}
#endif
