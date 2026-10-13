#pragma once
#include "formulas/IDamageFormula.h"
#include "physical/PhysicalDamagePipeline.h"
#include "ShadowStatus.h"
#include <map>

namespace espm { class CombineBrowser; }
namespace aetherius::combat {
// A6-S3 only. No actor state is installed or persisted. The zero profile is
// explicit experimental input; its result is never applied by the host.
class AetheriusDamageFormula final : public IDamageFormula {
public:
  static constexpr size_t kMaxEquipmentEntries = 64;
  AetheriusDamageFormula(const espm::CombineBrowser& browser,
    const std::vector<StableFormKey>& physicalRecords);
  float CalculateDamage(const MpActor&, const MpActor&, const HitData&) const override;
  float CalculateDamage(const MpActor&, const MpActor&, const SpellCastData&) const override;
private:
  enum class Kind { Weapon, Armor };
  struct Record {
    Kind kind;
    double base;
    const char* skill;
    bool supported;
  };
  // Filled from winning host records at startup, then immutable on hits.
  std::map<uint32_t, Record> records;
  const CombatProfile neutralProfile{0, {}, {}, 0, 0, 0};
  const CombatSettings settings{};
  const PerkRegistry noPerks{};
};
}
