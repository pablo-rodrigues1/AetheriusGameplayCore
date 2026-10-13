#pragma once
#include "ArmorCurve.h"
#include "../perks/PerkRegistry.h"
namespace aetherius::combat {
inline double Nonnegative(double v) {
  if (!std::isfinite(v)) throw std::invalid_argument("nonfinite damage component");
  return std::max(0.0,v);
}
inline double BlockReduction(const CombatProfile& defender, const PerkRegistry& perks,
                             const CombatSettings& settings, CombatTrace& trace) {
  const double base = settings.blockBase + settings.blockPerSkill * defender.Skill("Block");
  const double multiplier = perks.Multiplier("ModPercentBlocked",defender,{},trace);
  return std::clamp(base*multiplier,0.0,settings.blockCap);
}
inline double ArmorPiece(double base, const std::string& skill, const CombatProfile& profile,
                         const std::vector<StableFormKey>& keywords, double flat, double itemMultiplier,
                         const PerkRegistry& perks, const CombatSettings& settings, CombatTrace& trace) {
  const double rating = Nonnegative(base+flat) * Nonnegative(itemMultiplier) *
    (1 + .005 * profile.Skill(skill)) * perks.Multiplier("ModArmorRating",profile,keywords,trace);
  trace.Add("armor.piece",rating);
  return rating + settings.hiddenArmorPerPiece;
}
inline DamageResult PhysicalDamage(const DamageContext& c, const CombatSettings& s,
                                   const PerkRegistry& perks, CombatRng& rng, CombatTrace& trace) {
  const double skill = c.attacker.Skill(c.weaponSkill);
  trace.Add("weapon.base",c.weaponBase); trace.Add("skill."+c.weaponSkill,skill);
  double damage = Nonnegative(c.weaponBase+c.flatItemDamage) * Nonnegative(c.itemMultiplier) * (1+.005*skill);
  damage *= perks.Multiplier("CalculateWeaponDamage",c.attacker,c.weaponKeywords,trace);
  damage *= perks.Multiplier("ModAttackDamage",c.attacker,c.weaponKeywords,trace);
  damage *= Nonnegative(c.attackMultiplier);
  // Critical base comes from the authorized weapon resolver, not the packet.
  if (rng.Roll(c.criticalChance)) {
    const auto critical = Nonnegative(c.criticalBase) * perks.Multiplier("CalculateMyCriticalHitDamage",c.attacker,c.weaponKeywords,trace);
    damage += critical; trace.Add("critical.component",critical);
  }
  damage *= s.physicalMultiplier; trace.Add("physical.preDefense",damage);
  const auto block = c.blocked ? BlockReduction(c.defender,perks,s,trace) : 0;
  const auto armor = ArmorReduction(c.armor,s);
  trace.Add("block.reduction",block); trace.Add("armor.effective",c.armor); trace.Add("armor.reduction",armor);
  damage = Nonnegative(damage*(1-block)*(1-armor)); trace.Add("physical.final",damage);
  return {damage,0,0,false};
}
}
