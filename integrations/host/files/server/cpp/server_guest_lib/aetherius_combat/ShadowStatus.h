#pragma once
#include <exception>

namespace aetherius::combat {
enum class UnsupportedReason {
  None, UnarmedRaceSnapshot, SourceNotEquipped, MissingRecord,
  WeaponData, EnchantedArmor, EquipmentCapacity, DuplicateWeapon, Magic
};
class ShadowUnsupported final : public std::exception {
public:
  explicit ShadowUnsupported(UnsupportedReason reason) : reason(reason) {}
  const char* what() const noexcept override { return "UNSUPPORTED shadow context"; }
  const UnsupportedReason reason;
};
}
