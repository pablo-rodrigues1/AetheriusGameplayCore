#pragma once
#include "../state/ActorCombatState.h"
#include "../debug/CombatTrace.h"
namespace aetherius::combat {
enum class Resource { Health, Magicka, Stamina };
enum class Element { None, Fire, Frost, Shock, Poison };
struct CombatSnapshot {
  CombatProfile profile;
  double effectiveArmor = 0, magicResistance = 0;
  double fireResistance = 0, frostResistance = 0, shockResistance = 0, poisonResistance = 0;
  double absorptionChance = 0;
};
struct DamageContext {
  const CombatProfile& attacker;
  const CombatProfile& defender;
  std::string weaponSkill;
  std::vector<StableFormKey> weaponKeywords;
  double weaponBase = 0, flatItemDamage = 0, itemMultiplier = 1, armor = 0;
  double attackMultiplier = 1, criticalBase = 0, criticalChance = 0;
  bool blocked = false;
  // Only server-validated attack state belongs here. Raw packet flags are excluded.
};
struct DamageResult { double health = 0, magicka = 0, stamina = 0; bool absorbed = false; };
class CombatRng {
public:
  virtual ~CombatRng() = default;
  virtual double Unit() = 0;
  bool Roll(double chance) {
    if (!std::isfinite(chance) || chance < 0 || chance > 1) throw std::invalid_argument("invalid chance");
    if (chance == 0) return false;
    if (chance == 1) return true;
    const auto v = Unit();
    if (!std::isfinite(v) || v < 0 || v >= 1) throw std::invalid_argument("invalid RNG sample");
    return v < chance;
  }
};
}
