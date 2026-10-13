// Included once by MpActor.cpp. Keep D-P1 implementation out of maintainer files.
#include "aetherius_combat/WeaponPoison.h"
#include "libespm/RecordHeaderAccess.h"
#include <cstring>

namespace aetherius::poison {
inline bool PlayerSource(const MpActor& actor) {
  const auto* world = actor.GetParent();
  return world && world->HasEspm() && actor.IsCreatedAsPlayer() && actor.GetCallbacks().getUserId && actor.GetCallbacks().sendToUserDeferred &&
    actor.GetUserId() != Networking::InvalidUserId;
}
inline const char* Reason(Result result) {
  switch (result) {
    case Result::Applied: return "Applied";
    case Result::NoWeapon: return "NoWeapon";
    case Result::AmbiguousWeapon: return "AmbiguousWeapon";
    case Result::ItemAbsent: return "ItemAbsent";
    case Result::AlreadyPoisoned: return "AlreadyPoisoned";
    case Result::EffectsUnsupported: return "UNSUPPORTED";
    case Result::WrongWeapon: return "WrongWeapon";
    case Result::InvalidPoison: return "InvalidPoison";
    default: return "Rejected";
  }
}
inline std::string StableRecord(WorldState* world, uint32_t id) {
  return world && id ? FormDesc::FromFormId(id, world->pluginIndexMapping).ToString() : "none";
}
inline std::optional<espm::WEAP::AnimType> WeaponType(WorldState* world, uint32_t id) {
  if (!world || !world->HasEspm()) return std::nullopt;
  const auto found = world->GetEspm().GetBrowser().LookupById(id);
  const auto* weapon = espm::Convert<espm::WEAP>(found.rec);
  if (!weapon) return std::nullopt;
  const auto data = weapon->GetData(world->GetEspmCache());
  return data.weapDNAM ? std::optional(data.weapDNAM->animType) : std::nullopt;
}
inline bool HasConditions(const espm::RecordHeader* record, espm::CompressedFieldsCache& cache) {
  bool present = false;
  espm::RecordHeaderAccess::IterateFields(record, [&](const char* type, uint32_t, const char*) {
    if (!std::memcmp(type, "CTDA", 4)) present = true;
  }, cache);
  return present;
}
inline bool HasScript(const espm::RecordHeader* record, espm::CompressedFieldsCache& cache) {
  bool present = false;
  espm::RecordHeaderAccess::IterateFields(record, [&](const char* type, uint32_t, const char*) {
    if (!std::memcmp(type, "VMAD", 4)) present = true;
  }, cache);
  return present;
}
// Use the host's resource writer, enqueue publication separately. The ordinary
// DamageActorValue API calls NetSetPercentages (immediate transport).
inline uint32_t ResourceDamage(MpActor& actor, espm::ActorValue av, float magnitude) {
  auto* world = actor.GetParent();
  if (!world || !world->HasEspm() || !actor.GetCallbacks().getUserId)
    return static_cast<uint32_t>(Family::ResourceContext);
  auto& recipient = actor.GetActorToSendTo();
  if (!PlayerSource(recipient)) return static_cast<uint32_t>(Family::ResourceContext);
  const float maximum = actor.GetMaximumValues().GetValue(av);
  if (!std::isfinite(maximum) || maximum <= 0 || actor.IsDead()) return static_cast<uint32_t>(Family::ResourceContext);
  auto values = actor.GetChangeForm().actorValues;
  float* percentage = av == espm::ActorValue::Health ? &values.healthPercentage :
    av == espm::ActorValue::Magicka ? &values.magickaPercentage : &values.staminaPercentage;
  const float next = std::clamp(*percentage - magnitude / maximum, 0.f, 1.f);
  // Death calls gamemode callbacks in the existing host. Without a certified
  // poison kill owner, refuse this parcel instead of doing I/O in the hit/tick.
  if (av == espm::ActorValue::Health && next == 0.f) return static_cast<uint32_t>(Family::Lethal);
  *percentage = next;
  actor.SetPercentages(values);
  ChangeValuesMessage message; message.idx = actor.GetIdx();
  if (av == espm::ActorValue::Health) message.data.health = next;
  if (av == espm::ActorValue::Magicka) message.data.magicka = next;
  if (av == espm::ActorValue::Stamina) message.data.stamina = next;
  recipient.SendToUserDeferred(message, true, 3, false);
  return 0;
}
}

// AETHERIUS D-P1-fix2: invoked only by the server-side authenticated intent.
// Validate the supplied hand against equipment already held by the host; never
// import equipment, counts, charges, grants or identity from the packet.
void MpActor::RequestWeaponPoison(uint32_t poisonId, uint32_t weaponId, bool leftHand) {
  using namespace aetherius::poison;
  auto* world = GetParent();
  aetheriusPoisonResult = static_cast<uint32_t>(Result::Disabled);
  if (!world || !world->aetheriusWeaponPoison || !PlayerSource(*this)) return;
  const auto eq = GetEquipment();
  const auto hand = leftHand ? Inventory::Worn::Left : Inventory::Worn::Right;
  const auto held = std::count_if(eq.inv.entries.begin(), eq.inv.entries.end(), [&](const auto& item) {
    return item.count && item.baseId == weaponId && item.GetWorn() == hand;
  });
  if (held != 1 || !WeaponType(world, weaponId)) {
    aetheriusPoisonResult = static_cast<uint32_t>(Result::WrongWeapon);
    spdlog::info("AETHERIUS D-P1-fix2 actor={:x} reason=WrongWeapon", GetFormId()); return;
  }
  if (!TryUseWeaponPoison(poisonId)) {
    aetheriusPoisonResult = static_cast<uint32_t>(Result::InvalidPoison);
    spdlog::info("AETHERIUS D-P1-fix2 actor={:x} reason=InvalidPoison", GetFormId());
  }
}

bool MpActor::TryUseWeaponPoison(uint32_t baseId) {
  auto* world = GetParent();
  if (!world || !world->aetheriusWeaponPoison || !aetherius::poison::PlayerSource(*this)) return false;
  const auto record = world->GetEspm().GetBrowser().LookupById(baseId);
  const auto* alch = espm::Convert<espm::ALCH>(record.rec);
  if (!alch || !alch->GetData(world->GetEspmCache()).isPoison) return false;
  aetheriusPoisonUnsupported = 0;
  auto inv = GetInventory(); auto eq = GetEquipment();
  std::vector<size_t> candidates;
  for (size_t i = 0; i < eq.inv.entries.size(); ++i) {
    const auto& e = eq.inv.entries[i];
    const auto type = aetherius::poison::WeaponType(world, e.baseId);
    if (e.count && e.GetWorn() != Inventory::Worn::None && type && aetherius::poison::CanCoat(*type)) candidates.push_back(i);
  }
  const auto result = aetherius::poison::Coat(inv, eq, baseId, aetheriusPoisonDoseBonus, candidates);
  aetheriusPoisonResult = static_cast<uint32_t>(result);
  std::string weapons = "none";
  for (const auto index : candidates) {
    if (weapons == "none") weapons.clear(); else weapons += ",";
    weapons += aetherius::poison::StableRecord(world, eq.inv.entries[index].baseId);
  }
  // Item use is outside hit/tick. Keep synchronous host logging here only;
  // hit/tick outcomes remain in the existing in-memory diagnostic property.
  spdlog::info("AETHERIUS D-P1 actor={:x} weapon={} poison={} reason={}",
    GetFormId(), weapons, aetherius::poison::StableRecord(world, baseId),
    aetherius::poison::Reason(result));
  if (result == aetherius::poison::Result::Applied) {
    EditChangeForm([&](MpChangeForm& form) { form.inv = inv; form.equipment = eq; form.baseContainerAdded = true; });
    SendInventoryUpdate(); // existing deferred inventory publication
    PublishWeaponPoisonEquipment();
  } else if (!aetheriusPoisonOwnerPublished) {
    // One clean correction, even if the engine already poisoned locally.
    // Repeating either the refusal or UpdateEquipment cannot feed it back.
    SendInventoryUpdate();
    PublishWeaponPoisonEquipment();
  }
  return true; // handled even on refusal: poison is NEVER eaten when enabled
}

bool MpActor::ReconcileWeaponPoisonEquipment(const Equipment& incoming) {
  auto* world = GetParent();
  if (!world || !world->aetheriusWeaponPoison || !aetherius::poison::PlayerSource(*this)) return false;
  for (const auto& item : incoming.inv.entries)
    if (!world->GetEspm().GetBrowser().LookupById(item.baseId).rec) return false;
  auto inv = GetInventory();
  const auto eq = aetherius::poison::ReconcileEquipment(inv, incoming, [world](uint32_t id) {
    return aetherius::poison::WeaponType(world, id).has_value();
  });
  auto previous = GetEquipment(); previous.numChanges = eq.numChanges;
  const bool changed = previous != eq;
  const bool correction = !aetheriusPoisonOwnerPublished && incoming.inv != eq.inv;
  EditChangeForm([&](MpChangeForm& form) { form.inv = inv; form.equipment = eq; });
  if (correction) {
    SendInventoryUpdate();
    PublishWeaponPoisonEquipment();
  } else if (changed) PublishWeaponPoisonEquipment(false); // observers only; no owner echo
  return true;
}

void MpActor::ApplyWeaponPoisonHit(MpActor& target, uint32_t source, bool blocked, bool bash, bool fatal) {
  using namespace aetherius::poison;
  auto* world = GetParent();
  if (!world || !world->aetheriusWeaponPoison || !PlayerSource(*this) || target.GetParent() != world ||
      !world->GetEspm().GetBrowser().LookupById(source).rec) return;
  aetheriusPoisonUnsupported = 0;
  aetheriusPoisonResult = static_cast<uint32_t>(Result::RejectedHit);
  if (blocked || bash || fatal || target.IsDead() || &target == this) return;
  const auto type = WeaponType(world, source);
  if (!type || !CanCoat(*type)) return;
  if (IsRanged(*type)) { aetheriusPoisonResult = static_cast<uint32_t>(Result::RangedUnsupported); return; }
  auto inv = GetInventory(); auto eq = GetEquipment();
  std::optional<size_t> wornIndex;
  for (size_t i = 0; i < eq.inv.entries.size(); ++i) {
    const auto& e = eq.inv.entries[i];
    if (e.count && e.baseId == source && e.GetWorn() != Inventory::Worn::None) {
      if (wornIndex) { aetheriusPoisonResult = static_cast<uint32_t>(Result::AmbiguousWeapon); return; }
      wornIndex = i;
    }
  }
  if (!wornIndex) return;
  auto& worn = eq.inv.entries[*wornIndex];
  const auto index = FindOwned(inv, worn);
  if (!index) { aetheriusPoisonResult = static_cast<uint32_t>(Result::AmbiguousWeapon); return; }
  auto& weapon = inv.entries[*index];
  aetheriusPoisonResult = static_cast<uint32_t>(Result::NoPoison);
  if (!weapon.poisonId.value_or(0) || !weapon.poisonCount.value_or(0)) return;
  const auto record = world->GetEspm().GetBrowser().LookupById(*weapon.poisonId);
  const auto* poison = espm::Convert<espm::ALCH>(record.rec);
  if (!poison) { aetheriusPoisonResult = static_cast<uint32_t>(Result::EffectsUnsupported); return; }
  const auto data = poison->GetData(world->GetEspmCache());
  if (!data.isPoison) return;
  size_t applied = 0;
  const bool conditions = HasConditions(record.rec, world->GetEspmCache());
  if (aetherius::poison::HasScript(record.rec, world->GetEspmCache())) aetheriusPoisonUnsupported |= static_cast<uint32_t>(Family::Conditions);
  for (const auto& raw : data.effects) {
    auto effect = raw; effect.effectId = record.ToGlobalId(raw.effectId);
    const auto lookup = world->GetEspm().GetBrowser().LookupById(effect.effectId);
    const auto* mgef = espm::Convert<espm::MGEF>(lookup.rec);
    if (!mgef) { aetheriusPoisonUnsupported |= static_cast<uint32_t>(Family::Archetype); continue; }
    const auto info = mgef->GetData(world->GetEspmCache()).data;
    if (aetherius::poison::HasScript(lookup.rec, world->GetEspmCache())) aetheriusPoisonUnsupported |= static_cast<uint32_t>(Family::Conditions);
    const auto family = target.ApplyWeaponPoisonEffect(effect, info, conditions || HasConditions(lookup.rec, world->GetEspmCache()), this);
    if (family) { aetheriusPoisonUnsupported |= family; continue; }
    ++applied;
  }
  if (!applied) { aetheriusPoisonResult = static_cast<uint32_t>(Result::EffectsUnsupported); return; }
  Spend(weapon); worn.poisonId = weapon.poisonId; worn.poisonCount = weapon.poisonCount;
  EditChangeForm([&](MpChangeForm& form) { form.inv = inv; form.equipment = eq; });
  SendInventoryUpdate();
  PublishWeaponPoisonEquipment();
  aetheriusPoisonResult = static_cast<uint32_t>(aetheriusPoisonUnsupported ? Result::PartialEffects : Result::Applied);
}

uint32_t MpActor::ApplyWeaponPoisonEffect(const espm::Effects::Effect& effect,
                                        const espm::MGEF::DATA& data, bool conditions, MpActor* poisoner) {
  if (!poisoner) poisoner = this;
  auto* world = GetParent();
  if (!aetherius::poison::PlayerSource(*poisoner) || !world || world != poisoner->GetParent() ||
      !world->aetheriusWeaponPoison) return static_cast<uint32_t>(aetherius::poison::Family::ResourceContext);
  if (!espm::Convert<espm::MGEF>(world->GetEspm().GetBrowser().LookupById(effect.effectId).rec))
    return static_cast<uint32_t>(aetherius::poison::Family::ResourceContext);
  const auto family = aetherius::poison::Classify(effect, data, conditions);
  if (family != aetherius::poison::Family::DirectResource) return static_cast<uint32_t>(family);
  const bool timed = effect.duration && !data.IsFlagSet(espm::MGEF::Flags::NoDuration);
  if (timed && GetActiveMagicEffects().Has(data.primaryAV)) return static_cast<uint32_t>(aetherius::poison::Family::Overlap);
  // Host resource authority. Magnitude is damage per second for a timed ValueMod.
  const auto damage = aetherius::poison::ResourceDamage(*this, data.primaryAV, effect.magnitude);
  if (damage) return damage;
  if (timed && effect.duration > 1) {
    ActiveMagicEffectsMap::Entry entry;
    entry.data = effect; entry.weaponPoison = true; entry.weaponPoisonTicks = effect.duration - 1;
    entry.endTime = std::chrono::system_clock::now() + std::chrono::seconds(effect.duration);
    EditChangeForm([&](MpChangeForm& form) { form.activeMagicEffects.Add(data.primaryAV, entry); });
    ScheduleWeaponPoisonTick(data.primaryAV, world->FindLoadedForm(poisoner->GetFormId()), poisoner->GetUserId());
  }
  return 0;
}

// Same host effect store/timer. Transient entries neither reapply as restoration
// nor survive restart. Overlapping effects on the same AV are explicitly refused.
void MpActor::ScheduleWeaponPoisonTick(espm::ActorValue av, std::weak_ptr<MpForm> poisoner, Networking::UserId user) {
  auto* world = GetParent();
  const auto source = poisoner.lock();
  auto* sourceActor = source ? source->AsActor() : nullptr;
  if (!world || !sourceActor || sourceActor->GetParent() != world ||
      !aetherius::poison::PlayerSource(*sourceActor) || sourceActor->GetUserId() != user || !world->aetheriusWeaponPoison) return;
  const auto active = GetActiveMagicEffects().Get(av);
  if (!active || !active->get().weaponPoison) return;
  auto entry = active->get();
  const auto weak = world->FindLoadedForm(GetFormId());
  uint32_t timerId;
  auto timer = world->SetEffectTimer(std::chrono::seconds(1), &timerId);
  entry.timerId = timerId;
  EditChangeForm([&](MpChangeForm& form) { form.activeMagicEffects.Add(av, entry); });
  timer.Then([weak, poisoner, user, av, timerId](Viet::Void) {
    const auto form = weak.lock(); auto* actor = form ? form->AsActor() : nullptr;
    if (!actor || !actor->GetParent()) return;
    const auto active = actor->GetActiveMagicEffects().Get(av);
    if (!active || !active->get().weaponPoison || active->get().timerId != timerId) return;
    auto entry = active->get();
    const auto source = poisoner.lock(); auto* sourceActor = source ? source->AsActor() : nullptr;
    if (!sourceActor || sourceActor->GetParent() != actor->GetParent() ||
        !aetherius::poison::PlayerSource(*sourceActor) || sourceActor->GetUserId() != user ||
        !actor->GetParent()->GetEspm().GetBrowser().LookupById(entry.data.effectId).rec ||
        !actor->GetParent()->aetheriusWeaponPoison || actor->IsDead()) {
      actor->EditChangeForm([&](MpChangeForm& form) { form.activeMagicEffects.Remove(av); }); return;
    }
    const auto refused = aetherius::poison::ResourceDamage(*actor, av, entry.data.magnitude);
    if (refused) {
      actor->aetheriusPoisonUnsupported |= refused;
      actor->aetheriusPoisonResult = static_cast<uint32_t>(aetherius::poison::Result::EffectsUnsupported);
      actor->EditChangeForm([&](MpChangeForm& form) { form.activeMagicEffects.Remove(av); }); return;
    }
    --entry.weaponPoisonTicks;
    actor->EditChangeForm([&](MpChangeForm& form) {
      if (entry.weaponPoisonTicks) form.activeMagicEffects.Add(av, entry);
      else form.activeMagicEffects.Remove(av);
    });
    if (entry.weaponPoisonTicks) actor->ScheduleWeaponPoisonTick(av, poisoner, user);
  });
}

void MpActor::PublishWeaponPoisonEquipment(bool toOwner) {
  if (!aetherius::poison::PlayerSource(*this) || !GetParent()->aetheriusWeaponPoison) return;
  UpdateEquipmentMessage msg; msg.data = GetEquipment(); msg.idx = GetIdx();
  // Enqueue native projection; no socket, gamemode, database or file call here.
  if (toOwner) {
    aetheriusPoisonOwnerPublished = true;
    SendToUserDeferred(msg, true, 2, false);
  }
  // Several nearby NPC listeners can route back to one hoster. Exclude the
  // owner after routing too, and send once per actual connected recipient.
  std::set<MpActor*> recipients{this};
  for (auto* listener : GetActorListeners()) {
    if (listener && listener != this && listener->GetParent() == GetParent() && listener->GetCallbacks().getUserId) {
      auto& recipient = listener->GetActorToSendTo();
      if (aetherius::poison::PlayerSource(recipient) && recipients.insert(&recipient).second)
        recipient.SendToUserDeferred(msg, true, 2, false);
    }
  }
}
