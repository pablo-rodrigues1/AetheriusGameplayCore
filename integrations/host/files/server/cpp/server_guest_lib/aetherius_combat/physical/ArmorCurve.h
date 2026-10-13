#pragma once
#include "../config/CombatSettings.h"
namespace aetherius::combat {
inline double ArmorReduction(double armor, const CombatSettings& s = {}) {
  if (!std::isfinite(armor)) throw std::invalid_argument("nonfinite armor");
  if (armor <= 0) return 0;
  if (armor <= s.softRating) return armor * s.softReduction / s.softRating;
  if (armor >= s.hardRating) return s.hardReduction;
  return s.softReduction + (armor-s.softRating) * (s.hardReduction-s.softReduction) / (s.hardRating-s.softRating);
}
}
