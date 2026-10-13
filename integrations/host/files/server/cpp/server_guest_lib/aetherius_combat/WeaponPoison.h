#pragma once
#include "Equipment.h"
#include "libespm/WEAP.h"
#include "libespm/MGEF.h"
#include "libespm/Effects.h"
#include <cmath>
#include <algorithm>
#include <limits>

namespace aetherius::poison {
enum class Result : uint32_t {
  Disabled, Applied, NoWeapon, AmbiguousWeapon, ItemAbsent, AlreadyPoisoned,
  NoPoison, RejectedHit, RangedUnsupported, EffectsUnsupported, PartialEffects,
  WrongWeapon, InvalidPoison
};
enum class Family : uint32_t {
  DirectResource = 0, Duration = 1, Archetype = 2, ActorValue = 4,
  InvalidMagnitude = 8, Area = 16, Conditions = 32, Overlap = 64, ResourceContext = 128, Lethal = 256
};
inline Family Classify(const espm::Effects::Effect& effect,
                       const espm::MGEF::DATA& data, bool conditions = false) {
  if (conditions) return Family::Conditions;
  if (data.effectType != espm::MGEF::EffectType::ValueMod ||
      !data.IsFlagSet(espm::MGEF::Flags::Detrimental)) return Family::Archetype;
  if (data.primaryAV != espm::ActorValue::Health &&
      data.primaryAV != espm::ActorValue::Magicka &&
      data.primaryAV != espm::ActorValue::Stamina) return Family::ActorValue;
  if (effect.duration > 86400 && !data.IsFlagSet(espm::MGEF::Flags::NoDuration)) return Family::Duration;
  if (!std::isfinite(effect.magnitude) || effect.magnitude <= 0) return Family::InvalidMagnitude;
  if (effect.areaOfEffect) return Family::Area;
  return Family::DirectResource;
}
inline bool SameInstance(const Inventory::Entry& owned, const Inventory::Entry& reported) {
  // Asymmetric: only extras actually stored by the host identify an instance.
  // Charge is mutable client state; poison and hand are host state/selection,
  // not identity. Never import client-only extras into the owned inventory.
  return owned.baseId == reported.baseId &&
    (!owned.health || owned.health == reported.health) &&
    (!owned.enchantmentId || owned.enchantmentId == reported.enchantmentId) &&
    (!owned.maxCharge || owned.maxCharge == reported.maxCharge) &&
    (!owned.removeEnchantmentOnUnequip ||
      *owned.removeEnchantmentOnUnequip == reported.removeEnchantmentOnUnequip.value_or(false)) &&
    (!owned.name || owned.name == reported.name) &&
    (!owned.soul || owned.soul == reported.soul);
}
inline std::optional<size_t> FindOwned(const Inventory& inv, const Inventory::Entry& worn) {
  // Preserve the host's already equipped instance on a delayed client update.
  for (int pass = 0; pass < 2; ++pass) {
    std::optional<size_t> found;
    for (size_t i = 0; i < inv.entries.size(); ++i) {
      const auto& e = inv.entries[i];
      if (!e.count || !SameInstance(e, worn)) continue;
      if (pass == 0 && e.GetWorn() != worn.GetWorn()) continue;
      if (found) return std::nullopt;
      found = i;
    }
    if (found) return found;
  }
  return std::nullopt;
}
inline bool CanCoat(espm::WEAP::AnimType type) {
  return type >= espm::WEAP::AnimType::OneHandSword && type <= espm::WEAP::AnimType::Crossbow
    && type != espm::WEAP::AnimType::Staff;
}
inline bool IsRanged(espm::WEAP::AnimType type) {
  return type == espm::WEAP::AnimType::Bow || type == espm::WEAP::AnimType::Crossbow;
}
// Pure inventory transition. The host supplies record-validated candidates.
inline Result Coat(Inventory& inv, Equipment& eq, uint32_t poisonId, uint32_t bonus,
                   const std::vector<size_t>& candidates) {
  if (candidates.empty()) return Result::NoWeapon;
  if (candidates.size() != 1) return Result::AmbiguousWeapon;
  auto& worn = eq.inv.entries.at(candidates.front());
  const auto owned = FindOwned(inv, worn);
  if (!owned) return Result::AmbiguousWeapon;
  if (inv.entries[*owned].poisonId.value_or(0) && inv.entries[*owned].poisonCount.value_or(0))
    return Result::AlreadyPoisoned; // replacement is unverified: preserve the old dose
  auto dose = std::find_if(inv.entries.begin(), inv.entries.end(), [poisonId](const auto& e) {
    return e.baseId == poisonId && e.count;
  });
  if (dose == inv.entries.end()) return Result::ItemAbsent;
  if (bonus > 65534) return Result::EffectsUnsupported;
  --dose->count;
  auto& weapon = inv.entries[*owned];
  // ExtraPoison belongs to one physical item, never the entire stack.
  auto remainder = weapon; remainder.count = weapon.count - 1; remainder.SetWorn(Inventory::Worn::None);
  weapon.count = 1; weapon.SetWorn(worn.GetWorn());
  weapon.poisonId = poisonId; weapon.poisonCount = 1 + bonus;
  worn.poisonId = weapon.poisonId; worn.poisonCount = weapon.poisonCount; worn.count = 1;
  if (remainder.count) inv.entries.push_back(remainder);
  inv.entries.erase(std::remove_if(inv.entries.begin(), inv.entries.end(), [](const auto& e) { return !e.count; }), inv.entries.end());
  return Result::Applied;
}
inline void Spend(Inventory::Entry& entry) {
  if (entry.poisonCount.value_or(0) > 1) --*entry.poisonCount;
  else { entry.poisonId.reset(); entry.poisonCount.reset(); }
}
// Ignore client-supplied poison state. It is intent/evidence, never a writer.
template<class IsWeapon>
Equipment ReconcileEquipment(Inventory& inv, Equipment eq, IsWeapon isWeapon) {
  std::vector<std::pair<size_t, Inventory::Worn>> assignments;
  for (auto& item : eq.inv.entries) {
    if (!isWeapon(item.baseId)) continue;
    const auto owned = FindOwned(inv, item);
    item.poisonId.reset(); item.poisonCount.reset();
    if (owned) {
      auto& authoritative = inv.entries[*owned];
      item.poisonId = authoritative.poisonId; item.poisonCount = authoritative.poisonCount;
      // Equipment contains the whole client inventory, including spare copies.
      // A spare must never undo an earlier assignment of the equipped copy.
      if (item.GetWorn() != Inventory::Worn::None)
        assignments.emplace_back(*owned, item.GetWorn());
    }
  }
  for (auto& item : inv.entries) if (isWeapon(item.baseId)) item.SetWorn(Inventory::Worn::None);
  for (const auto& [index, hand] : assignments) inv.entries[index].SetWorn(hand);
  return eq;
}
}
