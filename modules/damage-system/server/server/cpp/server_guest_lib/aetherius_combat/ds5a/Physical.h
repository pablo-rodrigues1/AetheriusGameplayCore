#pragma once
// DS-5a: bounded, allocation-free arithmetic. No perk evaluator or actor store.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace aetherius::combat::ds5a {
enum class Status { Calculated, Unsupported, Invalid };
enum class Reason { None, CatalogAbsent, CatalogInvalid, ProfileAbsent, ProfileInvalid,
  SkillAbsent, RecordAbsent, RecordUnsupported, EquipmentCapacity, SourceNotEquipped,
  AmbiguousEquipment, AmmoAbsent, RaceAbsent, InstanceEnchantment, NumericInvalid,
  ActiveRequiresDS7 };
inline const char* ReasonName(Reason r) {
  constexpr const char* names[] = {"NONE","CATALOG_ABSENT","CATALOG_INVALID","PROFILE_ABSENT",
    "PROFILE_INVALID","SKILL_UNSUPPORTED","RECORD_ABSENT","RECORD_UNSUPPORTED","EQUIPMENT_CAPACITY",
    "SOURCE_NOT_EQUIPPED","AMBIGUOUS_EQUIPMENT","AMMO_ABSENT","RACE_UNSUPPORTED",
    "INSTANCE_ENCHANTMENT_UNSUPPORTED","NUMERIC_INVALID","ACTIVE_REQUIRES_DS7"};
  return names[static_cast<unsigned>(r)];
}
enum class Skill : unsigned { OneHanded, TwoHanded, Marksman, Block, HeavyArmor, LightArmor, None };
inline constexpr std::array<const char*,6> SkillNames = {"OneHanded","TwoHanded","Marksman","Block","HeavyArmor","LightArmor"};
enum class Family : unsigned { Melee, Ranged, Unarmed };
inline constexpr std::array<const char*,3> FamilyNames = {"melee","ranged","unarmed"};
enum class Mode { Off, Shadow, Active };
struct Settings {
  std::array<Mode,3> modes{Mode::Off,Mode::Off,Mode::Off};
  double pve = 1, pvp = 1;
};
struct Scaling { double weaponMax = 0, armorBase = 0, armorMax = 0; };
inline bool InRange(double v, double max = 1e7) { return std::isfinite(v) && v >= 0 && v <= max; }
struct Value { bool supported = false; double value = 0; };
struct Profile {
  uint64_t revision = 0;
  uint64_t npcGeneration = 0;
  bool valid = false, player = false;
  uint32_t race = 0;
  std::array<Value,6> skills{};
  uint16_t unsupportedEffects = 0;
};
struct Trace {
  Status status = Status::Unsupported;
  Reason reason = Reason::ProfileAbsent;
  Family family = Family::Melee;
  uint64_t attackerRevision = 0, defenderRevision = 0;
  uint16_t attackerUnsupportedEffects = 0, defenderUnsupportedEffects = 0;
  double weaponBase = 0, ammoBase = 0, weaponSkill = 0, skillFactor = 1;
  double armor = 0, recordDamageResist = 0, armorReduction = 0, blockReduction = 0;
  double global = 1, preDefense = 0, candidate = 0;
  bool blockConfirmed = false;
};
// Instance identity is deliberately opaque; production installs tier zero only.
class RefinementTierProvider {
public:
  virtual ~RefinementTierProvider() = default;
  virtual unsigned Tier(const void* equippedInstance) const = 0;
};
class NeutralRefinement final : public RefinementTierProvider {
public:
  unsigned Tier(const void*) const override { return 0; }
};
inline double RefinementFactor(unsigned tier) { return tier <= 3 ? 1 + .25*tier : NAN; }
inline double ArmorCurve(double rating) {
  return rating <= 500 ? rating*.8/500 : rating >= 1000 ? .9 : .8+(rating-500)*.1/500;
}
inline double ArmorPiece(double base, double skill, const Scaling& g, unsigned tier = 0) {
  return base*RefinementFactor(tier)*(1+(g.armorMax-g.armorBase)*skill/100);
}
inline double Block(double skill) { return std::min(.85, .20+.003*skill); }
inline bool Finish(Trace& t, const Scaling& g, unsigned weaponTier, bool unarmed) {
  if (!InRange(t.weaponBase) || !InRange(t.ammoBase) || !InRange(t.weaponSkill,1000)
      || !InRange(t.armor) || !InRange(t.recordDamageResist) || !InRange(t.global,100)
      || !InRange(g.weaponMax,100) || !InRange(g.armorBase,100) || !InRange(g.armorMax,100)
      || g.weaponMax < 1 || g.armorMax < g.armorBase || weaponTier > 3
      || !InRange(t.blockReduction,.85)) {
    t.status=Status::Invalid; t.reason=Reason::NumericInvalid; return false;
  }
  t.skillFactor=unarmed ? 1 : 1+(g.weaponMax-1)*t.weaponSkill/100;
  t.preDefense=(t.weaponBase*RefinementFactor(weaponTier)+t.ammoBase)*t.skillFactor*t.global;
  t.armorReduction=ArmorCurve(t.armor+t.recordDamageResist);
  t.candidate=t.preDefense*(1-t.blockReduction)*(1-t.armorReduction);
  if (!InRange(t.candidate)) { t.status=Status::Invalid;t.reason=Reason::NumericInvalid;return false; }
  t.status=Status::Calculated;t.reason=Reason::None;return true;
}
}
