#include "AetheriusDamageFormula.h"
#include "MpActor.h"
#include "libespm/espm.h"
#include <limits>

namespace aetherius::combat {
AetheriusDamageFormula::AetheriusDamageFormula(const espm::CombineBrowser& browser,
  const std::vector<StableFormKey>& physicalRecords)
{
  if (physicalRecords.size() > 4096)
    throw std::invalid_argument("shadow record capacity exceeded");
  auto& cache = browser.GetCache();
  for (const auto& key : physicalRecords) {
    const auto source = browser.FindSourceByFilename(key.plugin.c_str());
    if (!source) throw std::invalid_argument("missing shadow plugin: " + key.plugin);
    const auto id = browser.ToRuntimeFormId(*source, key.localId);
    const auto row = browser.LookupById(id);
    if (!row.rec) throw std::invalid_argument("missing shadow record: " + key.ToString());
    if (records.count(id)) throw std::invalid_argument("duplicate shadow record");
    if (const auto weapon = espm::Convert<espm::WEAP>(row.rec)) {
    const auto data = weapon->GetData(cache);
    const char* skill = nullptr;
    if (data.weapDNAM) {
      switch (data.weapDNAM->animType) {
        case espm::WEAP::AnimType::OneHandSword:
        case espm::WEAP::AnimType::OneHandDagger:
        case espm::WEAP::AnimType::OneHandAxe:
        case espm::WEAP::AnimType::OneHandMace: skill = "OneHanded"; break;
        case espm::WEAP::AnimType::TwoHandSword:
        case espm::WEAP::AnimType::TwoHandAxe: skill = "TwoHanded"; break;
        case espm::WEAP::AnimType::Bow:
        case espm::WEAP::AnimType::Crossbow: skill = "Marksman"; break;
        default: break;
      }
    }
    records.emplace(id, Record{Kind::Weapon,
      data.weapData ? static_cast<double>(data.weapData->damage) : 0,
      skill, data.weapData && skill});
    } else if (const auto armor = espm::Convert<espm::ARMO>(row.rec)) {
    const auto data = armor->GetData(cache);
    const auto skill = data.bod2.present ? data.bod2.skill : data.bodt.skill;
    records.emplace(id, Record{Kind::Armor,
      data.baseRatingX100 / 100.0,
      skill == 0 ? "LightArmor" : skill == 1 ? "HeavyArmor" : "",
      data.enchantmentFormId == 0});
    } else throw std::invalid_argument("shadow record must be WEAP or ARMO");
  }
}

float AetheriusDamageFormula::CalculateDamage(const MpActor& attacker,
  const MpActor& defender, const HitData& hit) const
{
  if (hit.source == 0x1f4)
    throw ShadowUnsupported(UnsupportedReason::UnarmedRaceSnapshot);
  const auto& offense = attacker.GetEquipment().inv.entries;
  const auto& defense = defender.GetEquipment().inv.entries;
  if (offense.size() > kMaxEquipmentEntries || defense.size() > kMaxEquipmentEntries)
    throw ShadowUnsupported(UnsupportedReason::EquipmentCapacity);
  unsigned equipped = 0;
  for (const auto& entry : offense)
    if (entry.baseId == hit.source && entry.count && entry.GetWorn() != Inventory::Worn::None)
      ++equipped;
  if (!equipped) throw ShadowUnsupported(UnsupportedReason::SourceNotEquipped);
  if (equipped > 1) throw ShadowUnsupported(UnsupportedReason::DuplicateWeapon);
  const auto weapon = records.find(hit.source);
  if (weapon == records.end()) throw ShadowUnsupported(UnsupportedReason::MissingRecord);
  if (weapon->second.kind != Kind::Weapon || !weapon->second.supported)
    throw ShadowUnsupported(UnsupportedReason::WeaponData);

  CombatTrace trace(false); // Never enables the unbounded trace vector in shadow.
  double armor = 0;
  for (const auto& entry : defense) {
    if (!entry.count || entry.GetWorn() == Inventory::Worn::None) continue;
    const auto row = records.find(entry.baseId);
    if (row == records.end()) throw ShadowUnsupported(UnsupportedReason::MissingRecord);
    if (row->second.kind != Kind::Armor) continue;
    if (!row->second.supported || entry.enchantmentId.value_or(0))
      throw ShadowUnsupported(UnsupportedReason::EnchantedArmor);
    armor += ArmorPiece(row->second.base, row->second.skill, neutralProfile, {},
      0, 1, noPerks, settings, trace);
  }
  DamageContext context{neutralProfile, neutralProfile, weapon->second.skill,
    {}, weapon->second.base, 0, 1, armor};
  // Preserve the original candidate rule. Block geometry remains a host
  // limitation; packet power/sneak/bash cannot grant candidate multipliers.
  context.blocked = hit.isHitBlocked && defender.IsBlockActive();
  class NoCriticalRng final : public CombatRng {
    double Unit() override { throw std::logic_error("shadow has no critical context"); }
  } rng;
  const auto damage = PhysicalDamage(context, settings, noPerks, rng, trace).health;
  if (!std::isfinite(damage) || damage > std::numeric_limits<float>::max())
    throw std::overflow_error("shadow physical damage overflow");
  return static_cast<float>(damage);
}

float AetheriusDamageFormula::CalculateDamage(const MpActor&, const MpActor&,
  const SpellCastData&) const
{
  throw ShadowUnsupported(UnsupportedReason::Magic);
}
}
