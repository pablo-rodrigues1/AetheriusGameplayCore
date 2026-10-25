#pragma once
// DS-5a/DS-5b: bounded arithmetic and compiled rules, without another actor store.
#include "Rules.h"
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
  ds5b::Table perks;
  std::array<Value,3> maxima{};
  std::optional<StableFormKey> identity;
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
  bool powerConfirmed=false,bashConfirmed=false,critical=false,criticalBaseMissing=false,powerSettingMissing=false;
  double powerFactor=1,criticalChance=0,criticalComponent=0,normal=0,rngRoll=0;
  uint64_t rngState=0;
  unsigned rngDraws=0;
  ds5b::Audit rules;
  unsigned attackerUnsupportedPerks=0,defenderUnsupportedPerks=0;
  unsigned attackerUnsupportedRules=0,defenderUnsupportedRules=0;
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
  t.normal=(t.weaponBase*RefinementFactor(weaponTier)+t.ammoBase)*t.skillFactor;
  t.preDefense=t.normal*t.global;
  t.armorReduction=ArmorCurve(t.armor+t.recordDamageResist);
  t.candidate=t.preDefense*(1-t.blockReduction)*(1-t.armorReduction);
  if (!InRange(t.candidate)) { t.status=Status::Invalid;t.reason=Reason::NumericInvalid;return false; }
  t.status=Status::Calculated;t.reason=Reason::None;return true;
}
// Same arithmetic kernel used by host, native tests and golden tests.
template<class Random>
inline void FinishPerks(Trace& t,const ds5b::Table& attackPerks,const ds5b::Table& defensePerks,
    const ds5b::Context& ac,const ds5b::Context& dc,Value criticalBase,Value powerBonus,Random& rng) {
    // Explicit entry-point stages. Set/Add operate on that stage's actual value.
    t.normal=ds5b::Apply(attackPerks,ds5b::EP::Attack,t.normal,ac,dc,t.rules);
    t.normal=ds5b::Apply(attackPerks,ds5b::EP::Weapon,t.normal,ac,dc,t.rules);
    if(t.powerConfirmed) {
      if(powerBonus.supported) {
        t.powerFactor=ds5b::Apply(attackPerks,ds5b::EP::Power,1+powerBonus.value,ac,dc,t.rules);
        t.normal*=std::max(0.,t.powerFactor);
      }else t.powerSettingMissing=true;
    }
    ds5b::Apply(attackPerks,ds5b::EP::Sneak,1,ac,dc,t.rules); // Always inactive, even if compiled SUPPORTED.
    t.criticalChance=std::clamp(ds5b::Apply(attackPerks,ds5b::EP::CritChance,t.criticalChance,ac,dc,t.rules),0.,100.);
    if(t.criticalChance>0) {
      if(!criticalBase.supported)t.criticalBaseMissing=true;
      else {
        t.rngState=rng.state;t.rngRoll=rng.Next();t.rngDraws=1;t.critical=t.rngRoll<t.criticalChance/100;
        if(t.critical)t.criticalComponent=std::max(0.,ds5b::Apply(attackPerks,ds5b::EP::CritDamage,criticalBase.value,ac,dc,t.rules));
      }
    }
    t.preDefense=(std::max(0.,t.normal)+t.criticalComponent)*t.global;
    t.preDefense=std::max(0.,ds5b::Apply(defensePerks,ds5b::EP::Incoming,t.preDefense,dc,ac,t.rules,true));
    const double rating=std::max(0.,ds5b::Apply(attackPerks,ds5b::EP::TargetArmor,t.armor+t.recordDamageResist,ac,dc,t.rules));
    t.armorReduction=ArmorCurve(rating);
    t.candidate=t.preDefense*(1-t.blockReduction)*(1-t.armorReduction);
    if(t.rules.invalid||!InRange(t.candidate)){t.status=Status::Invalid;t.reason=Reason::NumericInvalid;}
}
}
