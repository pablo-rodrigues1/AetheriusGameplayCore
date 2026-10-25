#include "ActionListener.h"
#include "aetherius_combat/NpcObservation.h"
#include "AnimationSystem.h"
#include "ConditionsEvaluator.h"
#include "ConsoleCommands.h"
#include "CropRegeneration.h"
#include "Exceptions.h"
#include "GetBaseActorValues.h"
#include "HitData.h"
#include "MathUtils.h"
#include "MovementValidation.h"
#include "MpObjectReference.h"
#include "MsgType.h"
#include "Overloaded.h"
#include "WorldState.h"
#include "aetherius_combat/CombatProbe.h" // AETHERIUS DS-0b: dev-only, inert unless installed
#include "gamemode_events/CustomEvent.h"
#include "gamemode_events/EatItemEvent.h"
#include "gamemode_events/UpdateAppearanceAttemptEvent.h"
#include "gamemode_events/UpdateEquipmentAttemptEvent.h"
#include "script_objects/EspmGameObject.h"
#include <fmt/format.h>
#include <fmt/ranges.h>
#include <spdlog/spdlog.h>
#include <chrono>
#include <unordered_set>

#include "CustomPacketMessage.h"
#include "HostStartMessage.h"
#include "HostStopMessage.h"
#include "SpSnippet.h"
#include "UpdateAnimVariablesMessage.h"
#include "UpdateEquipmentMessage.h"

namespace {
// DS-0d: copies fixed scalar state only; no lookup/loading/maximum calculation.
void ProbeRejectedHit(WorldState& world, const HitData& hit, const char* reason,
                      const MpActor* aggressor, const MpObjectReference* target)
{
  if (auto* probe = aetherius::combat::ActiveCombatProbe()) {
    probe->RecordRejection(reason, aggressor ? aggressor->GetFormId() : hit.aggressor,
      target ? target->GetFormId() : hit.target, hit.source, hit.projectile,
      probe->CaptureState(aggressor, world), probe->CaptureState(target, world),
      aetherius::combat::CombatProbeNowMs(),
      std::string_view(reason) == "WEAPON_NOT_EQUIPPED" ? aggressor : nullptr);
  }
}

bool ProbeHitPermission(bool allowed, WorldState& world, const HitData& hit,
                        const char* reason, const MpActor* aggressor,
                        const MpObjectReference* target)
{
  if (!allowed) ProbeRejectedHit(world, hit, reason, aggressor, target);
  return allowed;
}

// Aetherius SkyDeath: fase gravada pelo gamemode (systems/skydeath). Ferido,
// espírito ou morto não equipa, atira, conjura, fabrica nem usa console.
bool SkyDeathBlocksActions(MpActor* actor)
{
  if (!actor) {
    return false;
  }
  const auto state = nlohmann::json::parse(
    actor->GetDynamicFields().GetValueDump("skyDeath"), nullptr, false);
  if (!state.is_object()) {
    return false;
  }
  const auto phase = state.value("phase", std::string("ALIVE"));
  return phase == "GHOST" || phase == "DOWNED" || phase == "DEAD";
}

// Aetherius SkyDeath: golpe aceito (anfitrião, origem e distância já conferidos).
// O gamemode decide se ele segue: no ferido, o golpe final o leva ao cemitério.
bool SkyDeathAllowsHit(MpActor* aggressor, MpObjectReference* target)
{
  CustomEvent finishingHit(target->GetFormId(), "onSkyDeathHit",
                           "[" + std::to_string(aggressor->GetFormId()) + "]");
  return finishingHit.Fire(target->GetParent());
}

// Aetherius SkySocial: inventário travado enquanto o diário de trocas/roubos se recupera.
bool SkySocialInventoryLocked(MpActor* actor)
{
  if (!actor) {
    return false;
  }
  const auto locked = nlohmann::json::parse(
    actor->GetDynamicFields().GetValueDump("skySocialInventoryLocked"), nullptr,
    false);
  return locked.is_boolean() && locked.get<bool>();
}

// Aetherius SkySocial: golpe em alguém do mesmo grupo é recusado antes dos scripts,
// dos efeitos e do golpe final do SkyDeath.
bool SkySocialAllowsHit(WorldState& worldState, MpActor* aggressor,
                        MpObjectReference* target, uint32_t source)
{
  CustomEvent socialHit(aggressor->GetFormId(), "onSkySocialHit",
                        "[" + std::to_string(target->GetFormId()) + "," +
                          std::to_string(source) + "]");
  return socialHit.Fire(&worldState);
}
}

namespace FormIdCasts {
uint32_t LongToNormal(uint64_t longFormId)
{
  return static_cast<uint32_t>(longFormId % 0x100000000);
}
}

MpActor* ActionListener::SendToNeighbours(uint32_t idx,
                                          Networking::UserId userId,
                                          Networking::PacketData data,
                                          size_t length, bool reliable)
{
  MpActor* myActor = partOne.serverState.ActorByUser(userId);
  // The old behavior is doing nothing in that case. This is covered by tests
  if (!myActor) {
    spdlog::warn("SendToNeighbours - No actor assigned to user");
    return nullptr;
  }

  MpForm* form = partOne.worldState.LookupFormByIdx(idx);
  MpActor* actor = form ? form->AsActor() : nullptr;
  if (!actor) {
    spdlog::error("SendToNeighbours - Target actor doesn't exist");
    return nullptr;
  }

  if (idx != myActor->GetIdx()) {
    // Possible fix for "players link to each other" bug
    // See also PartOne::SetUserActor
    Networking::UserId actorsOwningUserId =
      partOne.serverState.UserByActor(actor);
    if (actorsOwningUserId != Networking::InvalidUserId) {
      spdlog::error("SendToNeighbours - No permission to update actor {:x} "
                    "(already owned by user {})",
                    actor->GetFormId(), actorsOwningUserId);
      partOne.SendHostStop(userId, *actor);

      partOne.worldState.hosters.erase(actor->GetFormId());
      return nullptr;
    }

    auto it = partOne.worldState.hosters.find(actor->GetFormId());
    if (it == partOne.worldState.hosters.end() ||
        it->second != myActor->GetFormId()) {
      if (idx == 0) {
        spdlog::warn("SendToNeighbours - idx=0, <Message>::ReadJson or "
                     "similar is probably incorrect");
      }
      spdlog::error(
        "SendToNeighbours - No permission to update actor {:x} (not a hoster)",
        actor->GetFormId());
      partOne.SendHostStop(userId, *actor);
      return nullptr;
    }
  }

  for (auto listener : actor->GetActorListeners()) {
    auto targetuserId = partOne.serverState.UserByActor(listener);
    if (targetuserId != Networking::InvalidUserId) {
      partOne.GetSendTarget().Send(targetuserId, data, length, reliable);
    }
  }

  return actor;
}

MpActor* ActionListener::SendToNeighbours(uint32_t idx,
                                          const RawMessageData& rawMsgData,
                                          bool reliable)
{
  return SendToNeighbours(idx, rawMsgData.userId, rawMsgData.unparsed,
                          rawMsgData.unparsedLength, reliable);
}

void ActionListener::OnCustomPacket(const RawMessageData& rawMsgData,
                                    const CustomPacketMessage& msg)
{
  simdjson::dom::parser parser;
  auto content = parser.parse(msg.contentJsonDump).value();
  auto channel = content["channel"].get_string();
  if (!channel.error() && channel.value() == "aetherius.npc.observation") {
    OnNpcObservation(rawMsgData, msg.contentJsonDump); return;
  }
  if (!channel.error() && channel.value() == "aetherius.npc.observation.unavailable") {
    OnNpcObservationUnavailable(rawMsgData, msg.contentJsonDump); return;
  }
  for (auto& listener : partOne.GetListeners()) {
    listener->OnCustomPacket(rawMsgData.userId, content);
  }
}

void ActionListener::OnUpdateMovement(const RawMessageData& rawMsgData,
                                      const UpdateMovementMessage& msg)
{
  auto actor = SendToNeighbours(msg.idx, rawMsgData);
  if (actor) {
    bool teleportFlag = actor->GetTeleportFlag();
    actor->SetTeleportFlag(false);

    static const NiPoint3 kInfinityPos = {
      std::numeric_limits<float>::infinity(),
      std::numeric_limits<float>::infinity(),
      std::numeric_limits<float>::infinity()
    };

    auto& pluginIndexMapping = actor->GetParent()->pluginIndexMapping;

    const auto& currentPos = actor->GetPos();
    const auto& currentRot = actor->GetAngle();
    const auto& currentCellOrWorld = actor->GetCellOrWorld();

    if (!MovementValidation::Validate(
          partOne, currentPos, currentRot, currentCellOrWorld,
          teleportFlag
            ? kInfinityPos
            : NiPoint3{ msg.data.pos[0], msg.data.pos[1], msg.data.pos[2] },
          FormDesc::FromFormId(msg.data.worldOrCell, pluginIndexMapping),
          rawMsgData.userId, actor, pluginIndexMapping, &npcMovementCorrections,
          MovementValidation::NpcCorrections::Clock::now(), teleportFlag)) {
      if (auto* probe = aetherius::combat::ActiveCombatProbe()) {
        probe->RecordMovementAttempt(*actor, msg.data.pos, msg.data.worldOrCell, false, aetherius::combat::CombatProbeNowMs());
      }
      return;
    }

    if (!msg.data.isBlocking) {
      actor->IncreaseBlockCount();
    } else {
      actor->ResetBlockCount();
    }

    actor->SetPos(
      NiPoint3{ msg.data.pos[0], msg.data.pos[1], msg.data.pos[2] },
      SetPosMode::CalledByUpdateMovement);
    if (auto* probe = aetherius::combat::ActiveCombatProbe()) {
      probe->RecordMovementAttempt(*actor, msg.data.pos, msg.data.worldOrCell, true, aetherius::combat::CombatProbeNowMs());
      probe->RecordMovement(*actor, partOne.worldState, aetherius::combat::CombatProbeNowMs());
    }
    actor->SetAngle(
      NiPoint3{ msg.data.rot[0], msg.data.rot[1], msg.data.rot[2] },
      SetAngleMode::CalledByUpdateMovement);
    actor->SetAnimationVariableBool(
      AnimationVariableBool::kVariable_bInJumpState, msg.data.isInJumpState);
    actor->SetAnimationVariableBool(
      AnimationVariableBool::kVariable__skymp_isWeapDrawn,
      msg.data.isWeapDrawn);
    actor->SetAnimationVariableBool(
      AnimationVariableBool::kVariable_IsBlocking, msg.data.isBlocking);
    actor->SetAnimationVariableBool(
      AnimationVariableBool::kVariable_IsSneaking, msg.data.isSneaking);

    if (actor->GetBlockCount() == 5) {
      actor->SetIsBlockActive(false);
      actor->ResetBlockCount();
    }

    if (msg.data.runMode != "Standing") {
      actor->SetLastAnimEvent(std::nullopt);
    }

    if (partOne.worldState.lastMovUpdateByIdx.size() <= msg.idx) {
      auto newSize = static_cast<size_t>(msg.idx) + 1;
      partOne.worldState.lastMovUpdateByIdx.resize(newSize);
    }
    partOne.worldState.lastMovUpdateByIdx[msg.idx] =
      std::chrono::system_clock::now();
  }
}

void ActionListener::OnUpdateAnimation(const RawMessageData& rawMsgData,
                                       const UpdateAnimationMessage& msg)
{
  MpActor* myActor = partOne.serverState.ActorByUser(rawMsgData.userId);
  if (!myActor) {
    return;
  }

  auto targetActor = SendToNeighbours(msg.idx, rawMsgData);

  if (!targetActor) {
    return;
  }

  // AETHERIUS DS-0b: every animation the host accepted (own or hosted actor).
  if (auto* probe = aetherius::combat::ActiveCombatProbe()) {
    probe->RecordAnimation(targetActor->GetFormId(), msg.data.animEventName,
                           aetherius::combat::CombatProbeNowMs());
  }

  // Only process animation system and set last anim event for player's actor
  if (targetActor != myActor) {
    return;
  }

  partOne.animationSystem.Process(targetActor, msg.data);
  targetActor->SetLastAnimEvent(msg.data);
}

void ActionListener::OnUpdateAppearance(const RawMessageData& rawMsgData,
                                        const UpdateAppearanceMessage& msg)
{
  MpActor* actor = partOne.serverState.ActorByUser(rawMsgData.userId);
  if (!actor || !msg.data.has_value()) {
    return;
  }

  const bool isAllowed = actor->IsRaceMenuOpen();

  if (isAllowed) {
    actor->SetRaceMenuOpen(false);
    actor->SetAppearance(&msg.data.value());
    SendToNeighbours(msg.idx, rawMsgData, true);
  }

  UpdateAppearanceAttemptEvent updateAppearanceAttemptEvent(
    actor, msg.data.value(), isAllowed);
  updateAppearanceAttemptEvent.Fire(actor->GetParent());
}

void ActionListener::OnUpdateEquipment(const RawMessageData& rawMsgData,
                                       const UpdateEquipmentMessage& msg)
{
  // Aetherius SkyDeath/SkySocial: ferido, espírito ou inventário em recuperação
  // não usa esta ação.
  if (SkyDeathBlocksActions(partOne.serverState.ActorByUser(rawMsgData.userId)) ||
      SkySocialInventoryLocked(partOne.serverState.ActorByUser(rawMsgData.userId))) {
    return;
  }

  MpActor* actor = partOne.serverState.ActorByUser(rawMsgData.userId);
  if (!actor) {
    return;
  }

  bool isAllowed = true;
  const auto actorFormId = actor->GetFormId();
  const Equipment& data = msg.data;
  const Inventory& equipmentInv = data.inv;
  uint32_t leftSpell = data.leftSpell.value_or(0);
  uint32_t rightSpell = data.rightSpell.value_or(0);
  uint32_t voiceSpell = data.voiceSpell.value_or(0);
  uint32_t instantSpell = data.instantSpell.value_or(0);

  enum class SpellSlotId : size_t
  {
    Left = 0,
    Right,
    Voice,
    Instant,
    kCount
  };

  std::array<uint32_t, static_cast<size_t>(SpellSlotId::kCount)>
    spellIdsToRemove = {};

  if (leftSpell > 0 && !actor->IsSpellLearned(leftSpell)) {
    spdlog::warn("ActionListener::OnUpdateEquipment {:x} - rejected equipment "
                 "update: spell {:x} is not learned",
                 actorFormId, leftSpell);
    isAllowed = false;
    spellIdsToRemove[static_cast<size_t>(SpellSlotId::Left)] = leftSpell;
  }

  if (rightSpell > 0 && !actor->IsSpellLearned(rightSpell)) {
    spdlog::warn("ActionListener::OnUpdateEquipment {:x} - rejected equipment "
                 "update: spell {:x} is not learned",
                 actorFormId, rightSpell);
    isAllowed = false;
    spellIdsToRemove[static_cast<size_t>(SpellSlotId::Right)] = rightSpell;
  }

  if (voiceSpell > 0 && !actor->IsSpellLearned(voiceSpell)) {
    spdlog::warn("ActionListener::OnUpdateEquipment {:x} - rejected equipment "
                 "update: spell {:x} is not learned",
                 actorFormId, voiceSpell);
    isAllowed = false;
    spellIdsToRemove[static_cast<size_t>(SpellSlotId::Voice)] = voiceSpell;
  }

  if (instantSpell > 0 && !actor->IsSpellLearned(instantSpell)) {
    spdlog::warn("ActionListener::OnUpdateEquipment {:x} - rejected equipment "
                 "update: spell {:x} is not learned",
                 actorFormId, instantSpell);
    isAllowed = false;
    spellIdsToRemove[static_cast<size_t>(SpellSlotId::Instant)] = instantSpell;
  }

  std::vector<uint32_t> itemIdsToUnequip;

  const auto& inventory = actor->GetInventory();
  for (auto& entry : equipmentInv.entries) {
    if (!inventory.HasItem(entry.baseId)) {
      spdlog::warn(
        "ActionListener::OnUpdateEquipment {:x} - rejected equipment "
        "update: inventory does not contain item {:x}",
        actorFormId, entry.baseId);
      isAllowed = false;
      break;
    }
  }

  if (isAllowed) {
    auto worldState = actor->GetParent();
    if (worldState) {
      uint32_t occupiedSlots = 0;
      // Track which item owns each bit so we can report conflicts
      std::array<uint32_t, 32> slotOwner = {};
      for (auto& entry : equipmentInv.entries) {
        if (entry.GetWorn() == Inventory::Worn::None) {
          continue;
        }
        auto lookupRes =
          worldState->GetEspm().GetBrowser().LookupById(entry.baseId);
        if (!lookupRes.rec || lookupRes.rec->GetType() != espm::ARMO::kType) {
          continue;
        }
        auto armoData = espm::GetData<espm::ARMO>(entry.baseId, worldState);
        uint32_t bodyPartFlags = 0;
        if (armoData.bod2.present) {
          bodyPartFlags = armoData.bod2.bodyPartFlags;
        } else if (armoData.bodt.present) {
          bodyPartFlags = armoData.bodt.bodyPartFlags;
        }
        if (bodyPartFlags == 0) {
          continue;
        }
        uint32_t overlap = occupiedSlots & bodyPartFlags;
        if (overlap) {
          // Collect all conflicting item IDs from slotOwner
          std::unordered_set<uint32_t> conflictingItems;
          conflictingItems.insert(entry.baseId);
          for (int bit = 0; bit < 32; ++bit) {
            if (overlap & (1u << bit)) {
              conflictingItems.insert(slotOwner[bit]);
            }
          }
          std::string conflictList;
          for (uint32_t id : conflictingItems) {
            if (!conflictList.empty()) {
              conflictList += ", ";
            }
            conflictList += fmt::format("{:x}", id);
          }
          std::string binaryStr(32, '0');
          for (int bit = 31; bit >= 0; --bit) {
            if (overlap & (1u << (31 - bit))) {
              binaryStr[bit] = '1';
            }
          }
          spdlog::warn(
            "ActionListener::OnUpdateEquipment {:x} - rejected equipment "
            "update: items [{}] share armor slot flags {:x} (0b{})",
            actorFormId, conflictList, overlap, binaryStr);
          isAllowed = false;
          for (uint32_t id : conflictingItems) {
            itemIdsToUnequip.push_back(id);
          }
          break;
        }
        for (int bit = 0; bit < 32; ++bit) {
          if (bodyPartFlags & (1u << bit)) {
            slotOwner[bit] = entry.baseId;
          }
        }
        occupiedSlots |= bodyPartFlags;
      }
    }
  }

  if (isAllowed) {
    // AETHERIUS D-P1: reconcile host poison; client feedback never triggers repeated owner projection.
    if (msg.idx != actor->GetIdx() || !actor->ReconcileWeaponPoisonEquipment(data)) {
      SendToNeighbours(msg.idx, rawMsgData, true);
      actor->SetEquipment(data);
    }
    // AETHERIUS DS-0b: accepted transition, as the host now holds it.
    if (auto* probe = aetherius::combat::ActiveCombatProbe()) {
      probe->RecordEquipment(actor->GetFormId(), actor->GetEquipment(),
                             aetherius::combat::CombatProbeNowMs());
    }
  } else {
    actor->SendInventoryUpdate();

    for (uint32_t spellId : spellIdsToRemove) {
      if (spellId == 0) {
        continue;
      }
      SpSnippetObjectArgument spellArg;
      spellArg.formId = spellId;
      spellArg.type = "Spell";
      std::vector<std::optional<
        std::variant<bool, double, std::string, SpSnippetObjectArgument>>>
        args;
      args.push_back(spellArg);
      SpSnippet("Actor", "RemoveSpell", args, actor->GetFormId())
        .Execute(actor, SpSnippetMode::kNoReturnResult);
    }

    // Calculate diff between current (server) equipment and new (rejected)
    // equipment. Items worn in the new set but not in the current set need
    // to be unequipped on the client to revert the unauthorized change.
    {
      const auto& currentEquip = actor->GetEquipment().inv;

      std::unordered_set<uint32_t> currentWornIds;
      for (const auto& entry : currentEquip.entries) {
        if (entry.GetWorn() != Inventory::Worn::None) {
          currentWornIds.insert(entry.baseId);
        }
      }

      for (const auto& entry : equipmentInv.entries) {
        if (entry.GetWorn() != Inventory::Worn::None &&
            currentWornIds.find(entry.baseId) == currentWornIds.end()) {
          spdlog::info(
            "ActionListener::OnUpdateEquipment {:x} - unequipping item {:x} "
            "(not in current equipment, unauthorized change)",
            actorFormId, entry.baseId);
          itemIdsToUnequip.push_back(entry.baseId);
        }
      }

      // TODO: consider doing EquipItem for items worn in current equipment
      // but not worn in the new equipment (client tried to unequip them)
    }

    for (uint32_t itemId : itemIdsToUnequip) {
      SpSnippetObjectArgument itemArg;
      itemArg.formId = itemId;
      itemArg.type = "Form";
      std::vector<std::optional<
        std::variant<bool, double, std::string, SpSnippetObjectArgument>>>
        args;
      args.push_back(itemArg);
      args.push_back(false);
      args.push_back(true);
      SpSnippet("Actor", "UnequipItem", args, actor->GetFormId())
        .Execute(actor, SpSnippetMode::kNoReturnResult);
    }
  }

  UpdateEquipmentAttemptEvent updateEquipmentAttemptEvent(actor, data,
                                                          isAllowed);
  updateEquipmentAttemptEvent.Fire(actor->GetParent());
}

void ActionListener::OnActivate(const RawMessageData& rawMsgData,
                                const ActivateMessage& msg)
{
  if (!partOne.HasEspm())
    throw std::runtime_error("No loaded esm or esp files are found");

  const auto ac = partOne.serverState.ActorByUser(rawMsgData.userId);
  if (!ac)
    throw std::runtime_error("Can't do this without Actor attached");

  auto it =
    partOne.worldState.hosters.find(static_cast<uint32_t>(msg.data.caster));
  auto hosterId = it == partOne.worldState.hosters.end() ? 0 : it->second;

  if (msg.data.caster != 0x14) {
    if (hosterId != ac->GetFormId()) {
      std::stringstream ss;
      ss << std::hex << "Bad hoster is attached to caster 0x"
         << msg.data.caster << ", expected 0x" << ac->GetFormId()
         << ", but found 0x" << hosterId;
      throw std::runtime_error(ss.str());
    }
  }

  auto targetPtr = std::dynamic_pointer_cast<MpObjectReference>(
    partOne.worldState.LookupFormById(static_cast<uint32_t>(msg.data.target)));
  if (!targetPtr)
    return;

  constexpr bool kDefaultProcessingOnlyFalse = false;
  targetPtr->Activate(
    msg.data.caster == 0x14 ? *ac
                            : partOne.worldState.GetFormAt<MpObjectReference>(
                                static_cast<uint32_t>(msg.data.caster)),
    kDefaultProcessingOnlyFalse, msg.data.isSecondActivation);
  if (hosterId) {
    auto actor =
      std::dynamic_pointer_cast<MpActor>(partOne.worldState.LookupFormById(
        static_cast<uint32_t>(msg.data.caster)));
    if (actor) {
      actor->EquipBestWeapon();
    }
  }
}

void ActionListener::OnPutItem(const RawMessageData& rawMsgData,
                               const PutItemMessage& msg)
{
  MpActor* actor = partOne.serverState.ActorByUser(rawMsgData.userId);
  if (!actor) {
    return;
  }

  auto& ref = partOne.worldState.GetFormAt<MpObjectReference>(msg.target);

  auto worldState = actor->GetParent();
  if (!worldState) {
    return spdlog::error("No WorldState attached");
  }

  if (worldState->HasKeyword(msg.baseId, "SweetCantDrop")) {
    return spdlog::error("Attempt to put SweetCantDrop item {:x}",
                         actor->GetFormId());
  }

  Inventory::Entry entry;
  entry.baseId = msg.baseId;
  entry.count = msg.count;
  static_cast<Inventory::ExtraData&>(entry) =
    static_cast<const Inventory::ExtraData&>(msg);
  entry.SetWorn(Inventory::Worn::None);

  ref.PutItem(*actor, entry);
}

void ActionListener::OnTakeItem(const RawMessageData& rawMsgData,
                                const TakeItemMessage& msg)
{
  MpActor* actor = partOne.serverState.ActorByUser(rawMsgData.userId);
  if (!actor) {
    return;
  }

  auto& ref = partOne.worldState.GetFormAt<MpObjectReference>(msg.target);

  auto worldState = actor->GetParent();
  if (!worldState) {
    return spdlog::error("No WorldState attached");
  }

  if (worldState->HasKeyword(msg.baseId, "SweetCantDrop")) {
    return spdlog::error("Attempt to take SweetCantDrop item {:x}",
                         actor->GetFormId());
  }

  Inventory::Entry entry;
  entry.baseId = msg.baseId;
  entry.count = msg.count;
  static_cast<Inventory::ExtraData&>(entry) =
    static_cast<const Inventory::ExtraData&>(msg);

  ref.TakeItem(*actor, entry);
}

void ActionListener::OnDropItem(const RawMessageData& rawMsgData,
                                const DropItemMessage& msg)
{
  uint32_t baseId = FormIdCasts::LongToNormal(msg.baseId);
  MpActor* ac = partOne.serverState.ActorByUser(rawMsgData.userId);
  if (!ac) {
    return spdlog::error("Unable to drop an item from user with id: {}.",
                         rawMsgData.userId);
  }

  auto worldState = ac->GetParent();
  if (!worldState) {
    return spdlog::error("No WorldState attached");
  }

  if (worldState->HasKeyword(baseId, "SweetCantDrop")) {
    return spdlog::error("Attempt to drop SweetCantDrop item {:x}",
                         ac->GetFormId());
  }

  Inventory::Entry entry;
  entry.baseId = baseId;
  entry.count = msg.count;

  ac->DropItem(baseId, entry);
}

void ActionListener::OnPlayerBowShot(const RawMessageData& rawMsgData,
                                     const PlayerBowShotMessage& msg)
{
  // Aetherius SkyDeath/SkySocial: ferido, espírito ou inventário em recuperação
  // não usa esta ação.
  if (SkyDeathBlocksActions(partOne.serverState.ActorByUser(rawMsgData.userId)) ||
      SkySocialInventoryLocked(partOne.serverState.ActorByUser(rawMsgData.userId))) {
    return;
  }

  MpActor* ac = partOne.serverState.ActorByUser(rawMsgData.userId);
  if (!ac) {
    return spdlog::error("Unable to shot from user with id: {}.",
                         rawMsgData.userId);
  }

  auto worldState = ac->GetParent();
  if (!worldState) {
    return;
  }

  auto ammoLookupRes =
    worldState->GetEspm().GetBrowser().LookupById(msg.ammoId);
  if (!ammoLookupRes.rec) {
    return spdlog::error("ActionListener::OnPlayerBowShot {:x} - unable to "
                         "find espm record for {:x}",
                         ac->GetFormId(), msg.ammoId);
  }

  if (ammoLookupRes.rec->GetType().ToString() != "AMMO") {
    return spdlog::error(
      "ActionListener::OnPlayerBowShot {:x} - unable to shot not an ammo {:x}",
      ac->GetFormId(), msg.ammoId);
  }

  ac->RemoveItem(msg.ammoId, 1, nullptr);
}

void ActionListener::OnFinishSpSnippet(const RawMessageData& rawMsgData,
                                       const FinishSpSnippetMessage& msg)
{
  MpActor* actor = partOne.serverState.ActorByUser(rawMsgData.userId);
  if (!actor) {
    throw std::runtime_error(
      "Unable to finish SpSnippet: No Actor found for user " +
      std::to_string(rawMsgData.userId));
  }

  actor->ResolveSnippet(
    static_cast<uint32_t>(msg.snippetIdx),
    SpSnippet::VarValueFromSpSnippetReturnValue(msg.returnValue));
}

void ActionListener::OnEquip(const RawMessageData& rawMsgData,
                             const OnEquipMessage& msg)
{
  // Aetherius SkyDeath/SkySocial: ferido, espírito ou inventário em recuperação
  // não usa esta ação.
  if (SkyDeathBlocksActions(partOne.serverState.ActorByUser(rawMsgData.userId)) ||
      SkySocialInventoryLocked(partOne.serverState.ActorByUser(rawMsgData.userId))) {
    return;
  }

  MpActor* actor = partOne.serverState.ActorByUser(rawMsgData.userId);
  if (!actor) {
    throw std::runtime_error(
      "Unable to finish SpSnippet: No Actor found for user " +
      std::to_string(rawMsgData.userId));
  }

  std::ignore = actor->OnEquip(msg.baseId);
}

void ActionListener::OnConsoleCommand(const RawMessageData& rawMsgData,
                                      const ConsoleCommandMessage& msg)
{
  // Aetherius SkyDeath/SkySocial: ferido, espírito ou inventário em recuperação
  // não usa esta ação.
  if (SkyDeathBlocksActions(partOne.serverState.ActorByUser(rawMsgData.userId)) ||
      SkySocialInventoryLocked(partOne.serverState.ActorByUser(rawMsgData.userId))) {
    return;
  }

  MpActor* me = partOne.serverState.ActorByUser(rawMsgData.userId);
  if (me) {
    std::vector<ConsoleCommands::Argument> consoleArgs;
    consoleArgs.resize(msg.data.args.size());
    for (size_t i = 0; i < msg.data.args.size(); i++) {
      consoleArgs[i] = ConsoleCommands::Argument(msg.data.args[i]);
    }
    ConsoleCommands::Execute(*me, msg.data.commandName, consoleArgs);
  }
}

void ActionListener::OnCraftItem(const RawMessageData& rawMsgData,
                                 const CraftItemMessage& msg)
{
  // Aetherius SkyDeath/SkySocial: ferido, espírito ou inventário em recuperação
  // não usa esta ação.
  if (SkyDeathBlocksActions(partOne.serverState.ActorByUser(rawMsgData.userId)) ||
      SkySocialInventoryLocked(partOne.serverState.ActorByUser(rawMsgData.userId))) {
    return;
  }

  craftService->OnCraftItem(rawMsgData, msg.data.craftInputObjects,
                            msg.data.workbench, msg.data.resultObjectId);
}

void ActionListener::OnHostAttempt(const RawMessageData& rawMsgData,
                                   const HostMessage& msg)
{
  uint32_t remoteId = FormIdCasts::LongToNormal(msg.remoteId);

  MpActor* me = partOne.serverState.ActorByUser(rawMsgData.userId);
  if (!me) {
    throw std::runtime_error("Unable to host without actor attached");
  }

  auto& remote = partOne.worldState.GetFormAt<MpObjectReference>(remoteId);

  auto user = partOne.serverState.UserByActor(remote.AsActor());
  if (user != Networking::InvalidUserId) {
    return;
  }

  auto& hoster = partOne.worldState.hosters[remoteId];
  const uint32_t prevHoster = hoster;

  auto remoteIdx = remote.GetIdx();

  std::optional<std::chrono::system_clock::time_point> lastRemoteUpdate;
  if (partOne.worldState.lastMovUpdateByIdx.size() > remoteIdx) {
    lastRemoteUpdate = partOne.worldState.lastMovUpdateByIdx[remoteIdx];
  }

  const auto hostResetTimeout = std::chrono::seconds(2);

  if (hoster == 0 || !lastRemoteUpdate ||
      std::chrono::system_clock::now() - *lastRemoteUpdate >
        hostResetTimeout) {
    partOne.GetLogger().info("Hoster changed from {0:x} to {0:x}", prevHoster,
                             me->GetFormId());
    if (prevHoster != me->GetFormId()) npcMovementCorrections.Reset(remoteId);
    hoster = me->GetFormId();
    remote.UpdateHoster(hoster);

    // Prevents too fast host switch
    // Aetherius (FIX-1010 do GameplayCore): o vetor só cresce em OnUpdateMovement;
    // hospedar uma forma que ainda não mandou movimento escrevia além do fim
    // (corrupção do heap nativo, crash 0xC0000005 no V8).
    if (partOne.worldState.lastMovUpdateByIdx.size() <= remoteIdx) {
      partOne.worldState.lastMovUpdateByIdx.resize(
        static_cast<size_t>(remoteIdx) + 1);
    }
    partOne.worldState.lastMovUpdateByIdx[remoteIdx] =
      std::chrono::system_clock::now();

    auto remoteAsActor = remote.AsActor();
    if (remoteAsActor) {
      remoteAsActor->EquipBestWeapon();
    }

    uint64_t longFormId = remote.GetFormId();
    if (remoteAsActor && longFormId < 0xff000000) {
      longFormId += 0x100000000;
    }

    HostStartMessage message;
    message.target = longFormId;
    partOne.GetSendTarget().Send(rawMsgData.userId, message, true);

    // Otherwise, health percentage would remain unsynced until someone hits
    // npc
    auto formId = remote.GetFormId();
    partOne.worldState.SetTimer(std::chrono::seconds(1))
      .Then([this, formId](Viet::Void) {
        // Check if form is still here
        auto& remote = partOne.worldState.GetFormAt<MpActor>(formId);

        auto changeForm = remote.GetChangeForm();

        ChangeValuesMessage msg;
        msg.idx = remote.GetIdx();
        msg.data.health = changeForm.actorValues.healthPercentage;
        msg.data.magicka = changeForm.actorValues.magickaPercentage;
        msg.data.stamina = changeForm.actorValues.staminaPercentage;
        remote.GetActorToSendTo().SendToUser(msg, true);
      });

    auto& prevHosterForm = partOne.worldState.LookupFormById(prevHoster);
    if (MpActor* prevHosterActor =
          prevHosterForm ? prevHosterForm->AsActor() : nullptr) {
      auto prevHosterUser = partOne.serverState.UserByActor(prevHosterActor);
      if (prevHosterUser != Networking::InvalidUserId &&
          prevHosterUser != rawMsgData.userId) {
        HostStopMessage message;
        message.target = longFormId;
        partOne.GetSendTarget().Send(prevHosterUser, message, true);
      }
    }
  }
}

void ActionListener::OnCustomEvent(const RawMessageData& rawMsgData,
                                   const CustomEventMessage& msg)
{
  auto ac = partOne.serverState.ActorByUser(rawMsgData.userId);
  if (!ac) {
    return;
  }
  if (msg.eventName.empty() || msg.eventName[0] != '_') {
    return;
  }

  nlohmann::json jsonArray = nlohmann::json::array();

  for (auto& arg : msg.argsJsonDumps) {
    jsonArray.push_back(nlohmann::json::parse(arg));
  }

  const std::string jsonArrayDump = jsonArray.dump();

  for (auto& listener : partOne.GetListeners()) {
    CustomEvent customEvent(ac->GetFormId(), msg.eventName, jsonArrayDump);
    listener->OnMpApiEvent(customEvent);
  }
}

void ActionListener::OnChangeValues(const RawMessageData& rawMsgData,
                                    const ChangeValuesMessage& msg)
{
  MpActor* actor = partOne.serverState.ActorByUser(rawMsgData.userId);
  if (!actor) {
    return spdlog::error(
      "ActionListener::OnChangeValues - no Actor attached to userId {}",
      rawMsgData.userId);
  }

  if (actor->ShouldSkipRestoration()) {
    return;
  }

  const auto now = std::chrono::steady_clock::now();
  const float timeAfterRegeneration = CropPeriodAfterLastRegen(
    actor->GetDurationOfAttributesPercentagesUpdate(now).count());

  const auto& currentValues = actor->GetActorValues();

  ChangeValuesMessage outMsg;
  outMsg.idx = actor->GetIdx();
  bool sendOutMsg = false;

  auto process = [&](espm::ActorValue av, std::optional<float> inputVal,
                     float currentVal, std::optional<float>& outVal) {
    if (!inputVal.has_value()) {
      return;
    }

    if (MathUtils::IsNearlyEqual(currentVal, *inputVal)) {
      return;
    }

    float newVal = *inputVal;
    // AETHERIUS DEV-A1: reject nonfinite evidence only on the development path.
    if (actor->HasDevAttributes() && !std::isfinite(newVal)) {
      outVal = currentVal; sendOutMsg = true; return;
    }

    if (av == espm::ActorValue::Health) {
      newVal = CropHealthRegeneration(newVal, timeAfterRegeneration, actor);
    } else if (av == espm::ActorValue::Magicka) {
      newVal = CropMagickaRegeneration(newVal, timeAfterRegeneration, actor);
    } else if (actor->HasDevAttributes() && av == espm::ActorValue::Stamina) {
      newVal = CropStaminaRegeneration(newVal, timeAfterRegeneration, actor); // AETHERIUS DEV-A1
    }

    if (!MathUtils::IsNearlyEqual(newVal, *inputVal)) {
      outVal = newVal;
      sendOutMsg = true;
    }

    // Aetherius SkyDeath: vida informada pelo cliente (queda, afogamento,
    // regeneração) passa pelo gancho de NetSetPercentages, como o dano.
    if (av == espm::ActorValue::Health) {
      ActorValues updated = actor->GetActorValues();
      updated.healthPercentage = newVal;
      actor->NetSetPercentages(
        updated, nullptr, std::vector<espm::ActorValue>{ espm::ActorValue::Health });
      // AETHERIUS DS-0b: accepted client-reported health change.
      if (auto* probe = aetherius::combat::ActiveCombatProbe()) {
        probe->RecordHealth(actor->GetFormId(), currentVal, *inputVal,
                            actor->GetActorValues().healthPercentage,
                            aetherius::combat::CombatProbeNowMs());
      }
      return;
    }

    actor->SetPercentage(av, newVal);
  };

  process(espm::ActorValue::Health, msg.data.health,
          currentValues.healthPercentage, outMsg.data.health);
  process(espm::ActorValue::Magicka, msg.data.magicka,
          currentValues.magickaPercentage, outMsg.data.magicka);
  process(espm::ActorValue::Stamina, msg.data.stamina,
          currentValues.staminaPercentage, outMsg.data.stamina);

  if (sendOutMsg) {
    actor->SendToUser(outMsg, true);
  }
}

namespace {

bool IsUnarmedAttack(const uint32_t sourceFormId)
{
  return sourceFormId == 0x1f4;
}

float CalculateCurrentHealthPercentage(const MpActor& actor, float damage,
                                       float healthPercentage,
                                       float* outBaseHealth)
{
  const float baseHealth = actor.GetMaximumValues().health; // AETHERIUS DEV-A1

  if (outBaseHealth) {
    *outBaseHealth = baseHealth;
  }

  const float damagePercentage = damage / baseHealth;
  const float currentHealthPercentage = healthPercentage - damagePercentage;

  /// TODO add check for nan and inf!
  return currentHealthPercentage <= 0.f ? 0.f : currentHealthPercentage;
}

float GetReach(const MpActor& actor, const uint32_t source,
               float reachHotfixMult)
{
  auto espmProvider = actor.GetParent();
  if (IsUnarmedAttack(source)) {
    uint32_t raceId = actor.GetRaceId();
    return reachHotfixMult *
      espm::GetData<espm::RACE>(raceId, espmProvider).unarmedReach;
  }
  auto weapDNAM = espm::GetData<espm::WEAP>(source, espmProvider).weapDNAM;
  float fCombatDistance =
    espm::GetData<espm::GMST>(espm::GMST::kFCombatDistance, espmProvider)
      .value;
  float weaponReach = weapDNAM ? weapDNAM->reach : 0;
  return reachHotfixMult * weaponReach * fCombatDistance;
}

NiPoint3 RotateZ(const NiPoint3& point, float angle)
{
  static const float kPi = std::acos(-1.f);
  static const float kAngleToRadians = kPi / 180.f;
  float cos = std::cos(angle * kAngleToRadians);
  float sin = std::sin(angle * kAngleToRadians);

  return { point.x * cos - point.y * sin, point.x * sin + point.y * cos,
           point.z };
}

float GetSqrDistanceToBounds(const MpActor& actor, const MpActor& target)
{
  // TODO(#491): Figure out where to take the missing reach component
  constexpr float kPatch = 15.f;

  auto bounds = actor.GetBounds();
  auto targetBounds = target.GetBounds();

  // "Y" is "face" of character
  const float angleZ = 90.f - target.GetAngle().z;
  float direction = actor.GetAngle().z;

  // vector from target to the actor
  NiPoint3 position = actor.GetPos() - target.GetPos();
  position += RotateZ(
    NiPoint3(kPatch + bounds.pos2[1], 0.f, 0.f + bounds.pos2[2]), direction);

  NiPoint3 pos = RotateZ(position, angleZ);

  bool isProjectionInside[3] = {
    (targetBounds.pos1[0] <= pos.x && pos.x <= targetBounds.pos2[0]),
    (targetBounds.pos1[1] <= pos.y && pos.y <= targetBounds.pos2[1]),
    (targetBounds.pos1[2] <= pos.z && pos.z <= targetBounds.pos2[2])
  };

  NiPoint3 nearestCorner = {
    pos[0] > 0 ? 0.f + targetBounds.pos2[0] : 0.f + targetBounds.pos1[0],
    pos[1] > 0 ? 0.f + targetBounds.pos2[1] : 0.f + targetBounds.pos1[1],
    pos[2] > 0 ? 0.f + targetBounds.pos2[2] : 0.f + targetBounds.pos1[2],
  };

  return NiPoint3(isProjectionInside[0] ? 0.f : pos.x - nearestCorner.x,
                  isProjectionInside[1] ? 0.f : pos.y - nearestCorner.y,
                  isProjectionInside[2] ? 0.f : pos.z - nearestCorner.z)
    .SqrLength();
}

bool IsBowOrCrossbowShot(const HitData& hitData, WorldState* worldState)
{
  if (!worldState || !worldState->HasEspm()) {
    return false;
  }

  if (hitData.isBashAttack) {
    return false;
  }

  auto sourceLookupRes =
    worldState->GetEspm().GetBrowser().LookupById(hitData.source);
  if (!sourceLookupRes.rec) {
    return false;
  }

  auto source = espm::Convert<espm::WEAP>(sourceLookupRes.rec);
  if (!source) {
    return false;
  }

  auto weapDNAM = source->GetData(worldState->GetEspmCache()).weapDNAM;

  if (weapDNAM->animType != espm::WEAP::AnimType::Bow &&
      weapDNAM->animType != espm::WEAP::AnimType::Crossbow) {
    return false;
  }

  return true;
}

bool IsDistanceValid(const MpActor& actor, const MpActor& targetActor,
                     const HitData& hitData)
{
  float sqrDistance = GetSqrDistanceToBounds(actor, targetActor);

  // TODO: fix bounding boxes for creatures such as chicken, mudcrab, etc
  float reachPveHotfixMult =
    (actor.GetBaseId() <= 0x7 && targetActor.GetBaseId() <= 0x7)
    ? 1.f
    : std::numeric_limits<float>::infinity();

  float reach = GetReach(actor, hitData.source, reachPveHotfixMult);

  // For bow/crossbow shots we don't want to check melee radius
  if (IsBowOrCrossbowShot(hitData, actor.GetParent())) {
    constexpr float kExteriorCellWidthUnits = 4096.f;
    reach = kExteriorCellWidthUnits * 2;
  }

  return reach * reach > sqrDistance;
}

bool CanHit(const MpActor& actor, const HitData& hitData,
            const std::chrono::duration<float>& timePassed)
{
  WorldState* espmProvider = actor.GetParent();
  auto weapDNAM =
    espm::GetData<espm::WEAP>(hitData.source, espmProvider).weapDNAM;

  if (weapDNAM) {
    float speedMult = weapDNAM->speed;
    return timePassed.count() >= (1.1 * (1 / speedMult)) -
      (1.1 * (1 / speedMult) * (speedMult <= 0.75 ? 0.45 : 0.3));
  }

  throw std::runtime_error(
    fmt::format("Cannot get weapon speed from source: {0:x}", hitData.source));
}

bool ShouldBeBlocked(const MpActor& aggressor, const MpActor& target)
{
  NiPoint3 targetViewDirection = target.GetViewDirection();
  NiPoint3 aggressorDirection = aggressor.GetPos() - target.GetPos();
  if (targetViewDirection * aggressorDirection <= 0) {
    return false;
  }
  float angle =
    std::acos((targetViewDirection * aggressorDirection) /
              (targetViewDirection.Length() * aggressorDirection.Length()));
  return angle < 1;
}
}

void ActionListener::OnHit(const RawMessageData& rawMsgData,
                           const HitMessage& msg)
{
  MpActor* myActor = partOne.serverState.ActorByUser(rawMsgData.userId);

  if (!myActor) {
    ProbeRejectedHit(partOne.worldState, msg.data, "NO_USER_ACTOR", nullptr, nullptr);
    return spdlog::error(
      "ActionListener::OnHit - no Actor attached to userId {}",
      rawMsgData.userId);
  }

  MpActor* aggressor = nullptr;

  HitData hitData = msg.data;
  if (hitData.aggressor == 0x14) {
    aggressor = myActor;
    hitData.aggressor = aggressor->GetFormId();
  } else {
    aggressor = &partOne.worldState.GetFormAt<MpActor>(hitData.aggressor);
    auto it = partOne.worldState.hosters.find(hitData.aggressor);
    if (it == partOne.worldState.hosters.end() ||
        it->second != myActor->GetFormId()) {
      spdlog::error("SendToNeighbours - No permission to send OnHit with "
                    "aggressor actor {:x}",
                    aggressor->GetFormId());
      ProbeRejectedHit(partOne.worldState, hitData, "NO_HOST_PERMISSION", aggressor, nullptr);
      return;
    }
  }

  if (hitData.target == 0x14) {
    hitData.target = myActor->GetFormId();
  }

  MpForm* targetForm = partOne.worldState.LookupFormById(hitData.target).get();
  MpObjectReference* targetRef =
    targetForm ? targetForm->AsObjectReference() : nullptr;
  if (!targetRef) {
    ProbeRejectedHit(partOne.worldState, hitData, "TARGET_NOT_FOUND", aggressor, nullptr);
    spdlog::error("ActionListener::OnHit - MpObjectReference not found for "
                  "hitData.target {:x}",
                  hitData.target);
    return;
  }

  const FormDesc& aggressorCellOrWorld = aggressor->GetCellOrWorld();
  const FormDesc& targetCellOrWorld = targetRef->GetCellOrWorld();

  if (aggressorCellOrWorld != targetCellOrWorld) {
    ProbeRejectedHit(partOne.worldState, hitData, "DIFFERENT_CELL", aggressor, targetRef);
    const PluginIndexMapping& pluginIndexMapping = partOne.worldState.pluginIndexMapping;
    spdlog::error(
      "ActionListener::OnHit - aggressor and targetRef are in different cells "
      "or world. Aggressor: {:x}, targetRef: {:x}, cellOrWorld of aggressor: "
      "{:x}, cellOrWorld of targetRef: {:x}",
      aggressor->GetFormId(), targetRef->GetFormId(),
      aggressorCellOrWorld.ToFormId(pluginIndexMapping),
      targetCellOrWorld.ToFormId(pluginIndexMapping));
    return;
  }

  // TODO: repair IsDistanceValid instead
  if (!IsBowOrCrossbowShot(hitData, &partOne.worldState)) {
    const NiPoint3& aggressorPos = aggressor->GetPos();
    const NiPoint3& targetPos = targetRef->GetPos();
    constexpr float kExteriorCellWidthUnits = 4096.f;
    if ((aggressorPos - targetPos).SqrLength() >
        kExteriorCellWidthUnits * kExteriorCellWidthUnits) {
      ProbeRejectedHit(partOne.worldState, hitData, "TOO_DISTANT", aggressor, targetRef);
      spdlog::error("ActionListener::OnHit - aggressor and targetRef are too "
                    "distant. Aggressor: {:x}, targetRef: {:x}",
                    aggressor->GetFormId(), targetRef->GetFormId());
      return;
    }
  }

  if (aggressor->IsDead()) {
    ProbeRejectedHit(partOne.worldState, hitData, "AGGRESSOR_DEAD", aggressor, targetRef);
    spdlog::debug(fmt::format("{:x} actor is dead and can't attack. "
                              "requesting respawn in order to fix death state",
                              aggressor->GetFormId()));
    aggressor->RespawnWithDelay(true);
    return;
  }

  auto sourceInEspm =
    partOne.GetEspm().GetBrowser().LookupById(hitData.source);

  const bool isSourceSpell =
    sourceInEspm.rec && sourceInEspm.rec->GetType() == espm::SPEL::kType;

  const auto equipment = aggressor->GetEquipment();

  if (isSourceSpell && equipment.IsSpellEquipped(hitData.source)) {
    if (!ProbeHitPermission(SkySocialAllowsHit(partOne.worldState, aggressor, targetRef,
                            hitData.source), partOne.worldState, hitData, "SKYSOCIAL_DENIED", aggressor, targetRef) ||
        !ProbeHitPermission(SkyDeathAllowsHit(aggressor, targetRef), partOne.worldState, hitData, "SKYDEATH_DENIED", aggressor, targetRef)) {
      return;
    }
    OnSpellHit(aggressor, targetRef, hitData);
    return;
  }

  const bool isUnarmed = IsUnarmedAttack(hitData.source);

  if (equipment.inv.HasItem(hitData.source) || isUnarmed) {
    if (!ProbeHitPermission(SkySocialAllowsHit(partOne.worldState, aggressor, targetRef,
                            hitData.source), partOne.worldState, hitData, "SKYSOCIAL_DENIED", aggressor, targetRef) ||
        !ProbeHitPermission(SkyDeathAllowsHit(aggressor, targetRef), partOne.worldState, hitData, "SKYDEATH_DENIED", aggressor, targetRef)) {
      return;
    }
    OnWeaponHit(aggressor, targetRef, hitData, isUnarmed);
    return;
  }

  ProbeRejectedHit(partOne.worldState, hitData, "WEAPON_NOT_EQUIPPED", aggressor, targetRef);
  if (aggressor->GetInventory().HasItem(hitData.source) == false) {
    spdlog::debug("{:x} actor has no {:x} weapon and can't attack",
                  hitData.aggressor, hitData.source);
  }

  spdlog::debug("{:x} weapon is not equipped by {:x} actor and cannot be used",
                hitData.source, hitData.aggressor);
}

void ActionListener::OnUpdateAnimVariables(
  const RawMessageData& rawMsgData, const UpdateAnimVariablesMessage& msg)
{
  const MpActor* myActor = partOne.serverState.ActorByUser(rawMsgData.userId);
  if (!myActor) {
    throw std::runtime_error("Unable to change values without Actor attached");
  }

  SendToNeighbours(myActor->idx, rawMsgData);
}

void ActionListener::OnSpellCast(const RawMessageData& rawMsgData,
                                 const SpellCastMessage& msg)
{
  // Aetherius SkyDeath/SkySocial: ferido, espírito ou inventário em recuperação
  // não usa esta ação.
  if (SkyDeathBlocksActions(partOne.serverState.ActorByUser(rawMsgData.userId)) ||
      SkySocialInventoryLocked(partOne.serverState.ActorByUser(rawMsgData.userId))) {
    return;
  }

  MpActor* myActor = partOne.serverState.ActorByUser(rawMsgData.userId);

  if (!myActor) {
    throw std::runtime_error("Unable to change values without Actor attached");
  }

  MpActor* caster = nullptr;

  SpellCastData spellCastData = msg.data;

  if (spellCastData.caster == 0x14 ||
      spellCastData.caster == myActor->GetFormId()) {
    caster = myActor;
    spellCastData.caster = caster->GetFormId();
  } else {
    caster = &partOne.worldState.GetFormAt<MpActor>(spellCastData.caster);
    const auto it = partOne.worldState.hosters.find(spellCastData.caster);

    if (it == partOne.worldState.hosters.end() ||
        it->second != myActor->GetFormId()) {
      spdlog::error(
        "SendToNeighbours - No permission to send OnSpellCast with "
        "caster actor {:x}",
        caster->GetFormId());
      return;
    }
  }

  if (spellCastData.target == 0x14) {
    spellCastData.target = myActor->GetFormId();
  }

  if (caster->IsDead()) {
    spdlog::info(fmt::format("{:x} actor is dead and can't spell cast. "
                             "requesting respawn in order to fix death state",
                             caster->GetFormId()));
    caster->RespawnWithDelay(true);
    return;
  }

  const auto equipment = caster->GetEquipment();

  if (equipment.IsSpellEquipped(spellCastData.spell) == false) {
    spdlog::info("ActionListener::OnSpellCast - spell {0:x} not "
                 "found in equipment",
                 spellCastData.spell);
    return;
  }

  // Aetherius SkySocial: conjuração já autenticada (dono e magia equipada). Magias de
  // cura são resolvidas pelo gamemode, que pode redirecionar para um aliado do grupo.
  const auto socialMaximum = caster->GetMaximumValues();
  const std::string socialArgs = "[" + std::to_string(spellCastData.spell) +
    "," + std::to_string(spellCastData.target) + "," +
    (spellCastData.interruptCast ? "true" : "false") + "," +
    (spellCastData.isDualCasting ? "true" : "false") + "," +
    std::to_string(spellCastData.castingSource) + "," +
    std::to_string(socialMaximum.magicka) + "]";
  CustomEvent socialCast(caster->GetFormId(), "onSkySocialSpellCast",
                         socialArgs);
  if (!socialCast.Fire(&partOne.worldState)) {
    return;
  }

  SendToNeighbours(myActor->idx, rawMsgData);

  if (spellCastData.interruptCast) {
    return;
  }

  auto& browser = partOne.worldState.GetEspm().GetBrowser();

  const std::array<VarValue, 1> args{ VarValue(
    std::make_shared<EspmGameObject>(
      browser.LookupById(spellCastData.spell))) };

  caster->SendPapyrusEvent("OnSpellCast", args.data(), args.size());

  const auto targetRef = std::dynamic_pointer_cast<MpObjectReference>(
    partOne.worldState.LookupFormById(spellCastData.target));

  if (!targetRef) {
    spdlog::info(
      "ActionListener::OnSpellCast - MpObjectReference not found for "
      "spellCastData.target {:x}",
      spellCastData.target);
    return;
  }

  // TODO: apply magic effects if this is not a fireball-like spell.
  // Previous attempt was not successful, so it was deleted.
}

void ActionListener::OnUnknown(const RawMessageData& rawMsgData)
{
  spdlog::warn("ActionListener::OnUnknown - Got unhandled message");
}

namespace {
// Aetherius: modo invulnerável do painel da staff. O gamemode grava no ator
// "aetheriusInvulnerableUntil" (epoch em ms) e renova a cada poucos segundos
// enquanto o modo estiver ativo; sem renovação (staff saiu, servidor caiu) a
// proteção vence sozinha. Golpes de arma e magia nesse alvo não causam dano.
bool IsAetheriusInvulnerable(const MpObjectReference& target)
{
  const auto& dump =
    target.GetDynamicFields().GetValueDump("aetheriusInvulnerableUntil");
  if (dump == "null") {
    return false;
  }
  double until = 0.0;
  try {
    const auto value = nlohmann::json::parse(dump);
    if (!value.is_number()) {
      return false;
    }
    until = value.get<double>();
  } catch (...) {
    return false;
  }
  const double now = std::chrono::duration<double, std::milli>(
                       std::chrono::system_clock::now().time_since_epoch())
                       .count();
  return until > now;
}

// AETHERIUS DS-0b: copies an accepted hit into the development probe. Called
// only when the probe is installed; reads host state, changes nothing.
void ProbeAcceptedHit(aetherius::combat::CombatProbe& probe, WorldState& world,
                      const MpActor& aggressor, const MpActor& target,
                      const HitData& hit, bool clientBlocked, bool magic,
                      float damage, float healthBefore, float healthCandidate, float maximumHealth)
{
  using Family = aetherius::combat::CombatProbe::Family;
  aetherius::combat::CombatProbe::HitInput input;
  input.aggressor = aggressor.GetFormId();
  input.target = target.GetFormId();
  input.source = hit.source;
  input.projectile = hit.projectile;
  input.family = magic ? Family::Magic
    : IsUnarmedAttack(hit.source)
    ? Family::Unarmed
    : (IsBowOrCrossbowShot(hit, &world) ? Family::Ranged : Family::Melee);
  input.power = hit.isPowerAttack;
  input.sneak = hit.isSneakAttack;
  input.bash = hit.isBashAttack;
  input.blocked = hit.isHitBlocked;
  input.clientBlocked = clientBlocked;
  input.damage = damage;
  if (!magic) input.cadence = probe.LatestCadence(aggressor.GetFormId());
  input.targetMaximumHealth = maximumHealth;
  input.healthBefore = healthBefore;
  input.healthCandidate = healthCandidate;
  // Effective value after NetSetPercentages and its hooks (SkyDeath).
  input.healthAfter = target.GetActorValues().healthPercentage;
  input.aggressorBlockActive = aggressor.IsBlockActive();
  input.aggressorIsBlocking = aggressor.GetAnimationVariableBool("IsBlocking");
  input.targetBlockActive = target.IsBlockActive();
  input.targetIsBlocking = target.GetAnimationVariableBool("IsBlocking");
  input.aggressorSneaking = aggressor.GetAnimationVariableBool("IsSneaking");
  input.aggressorState = probe.CaptureState(&aggressor, world);
  input.targetState = probe.CaptureState(&target, world);
  probe.RecordHit(input, aetherius::combat::CombatProbeNowMs());
}
}

void ActionListener::OnSpellHit(MpActor* aggressor,
                                MpObjectReference* targetRef,
                                const HitData& hitData)
{
  // Aetherius SkySocial: magia de cura não entra no caminho de dano.
  CustomEvent socialSpellHit(aggressor->GetFormId(), "onSkySocialSpellHit",
                             "[" + std::to_string(hitData.source) + "," +
                               std::to_string(targetRef ? targetRef->GetFormId() : 0) +
                               "]");
  if (!socialSpellHit.Fire(&partOne.worldState)) {
    ProbeRejectedHit(partOne.worldState, hitData, "SKYSOCIAL_SPELL_DENIED", aggressor, targetRef);
    return;
  }

  SendPapyrusOnHitEvent(aggressor, targetRef, hitData);

  auto* targetActorPtr = targetRef ? targetRef->AsActor() : nullptr;
  if (!targetActorPtr) {
    ProbeRejectedHit(partOne.worldState, hitData, "TARGET_NOT_ACTOR", aggressor, targetRef);
    return; // Not an actor, damage calculation is not needed
  }

  if (IsAetheriusInvulnerable(*targetActorPtr)) {
    ProbeRejectedHit(partOne.worldState, hitData, "TARGET_INVULNERABLE", aggressor, targetRef);
    spdlog::info("OnSpellHit - Target {:x} is invulnerable (staff mode)",
                 targetActorPtr->GetFormId());
    return;
  }

  auto targetActorValues = targetActorPtr->GetChangeForm().actorValues;
  const float probeHealthBefore = targetActorValues.healthPercentage; // AETHERIUS DS-0b

  SpellCastData spellCastData{ aggressor->GetFormId(),
                               targetActorPtr->GetFormId(),
                               hitData.source,
                               false,
                               false,
                               SpellType::Left };

  float damage =
    partOne.CalculateDamage(*aggressor, *targetActorPtr, spellCastData);
  damage = damage <= 0.f ? 0.f : damage;

  float probeMaximumHealth = 0; // DS-0d: reuse the existing maximum calculation
  targetActorValues.healthPercentage = CalculateCurrentHealthPercentage(
    *targetActorPtr, damage, targetActorValues.healthPercentage, &probeMaximumHealth);

  static const auto kHealthAvFilter =
    std::vector<espm::ActorValue>{ espm::ActorValue::Health };

  targetActorPtr->NetSetPercentages(targetActorValues, aggressor,
                                    kHealthAvFilter, hitData.source);
  if (auto* probe = aetherius::combat::ActiveCombatProbe()) { // AETHERIUS DS-0b
    ProbeAcceptedHit(*probe, partOne.worldState, *aggressor, *targetActorPtr,
                     hitData, hitData.isHitBlocked, true, damage,
                     probeHealthBefore, targetActorValues.healthPercentage, probeMaximumHealth);
  }

  spdlog::info("OnSpellHit - Target {0:x} is hit by {1:x} spell on {2} "
               "damage. By caster: {3:x})",
               spellCastData.target, spellCastData.spell, damage,
               spellCastData.caster);
}

void ActionListener::OnWeaponHit(MpActor* aggressor,
                                 MpObjectReference* targetRef, HitData hitData,
                                 [[maybe_unused]] bool isUnarmed)
{
  const auto currentHitTime = std::chrono::steady_clock::now();
  const bool probeClientBlocked = hitData.isHitBlocked; // AETHERIUS DS-0b

  SendPapyrusOnHitEvent(aggressor, targetRef, hitData);

  auto* targetActorPtr = targetRef ? targetRef->AsActor() : nullptr;
  if (!targetActorPtr) {
    ProbeRejectedHit(partOne.worldState, hitData, "TARGET_NOT_ACTOR", aggressor, targetRef);
    return; // Not an actor, damage calculation is not needed
  }

  auto& targetActor = *targetActorPtr;

  if (IsAetheriusInvulnerable(targetActor)) {
    ProbeRejectedHit(partOne.worldState, hitData, "TARGET_INVULNERABLE", aggressor, targetRef);
    spdlog::info("OnWeaponHit - Target {:x} is invulnerable (staff mode)",
                 targetActor.GetFormId());
    return;
  }

  const auto lastHitTimeAnyTarget = aggressor->GetLastHitTime(std::nullopt);
  const std::chrono::duration<float> timePassedAnyTarget =
    currentHitTime - lastHitTimeAnyTarget;

  if (auto* probe = aetherius::combat::ActiveCombatProbe()) {
    const auto lookup = aggressor->GetParent()->GetEspm().GetBrowser().LookupById(hitData.source);
    const auto* weapon = espm::Convert<espm::WEAP>(lookup.rec);
    const auto speed = weapon ? weapon->GetData(aggressor->GetParent()->GetEspmCache()).weapDNAM : nullptr;
    probe->RecordAttackAttempt(aggressor->GetFormId(), speed ? speed->speed : 0, speed != nullptr,
      timePassedAnyTarget.count() * 1000.f, lastHitTimeAnyTarget != std::chrono::steady_clock::time_point{}, currentHitTime);
  }
  constexpr float kSplashTimeWindow = 0.1f;
  constexpr size_t kMaxSplashTargets = 4;

  // Splash attack detection. Non-vanilla feature, fixes anticheat-vs-mod
  // issues
  const bool isSplash = timePassedAnyTarget.count() < kSplashTimeWindow;

  if (isSplash) {
    spdlog::info("Splash attack detected from aggressor {:x} to target {:x}",
                 aggressor->GetFormId(), targetActor.GetFormId());

    // Check if THIS specific target was hit recently
    auto lastHitSpecific = aggressor->GetLastHitTime(targetActor.GetFormId());
    std::chrono::duration<float> timeSinceSpecific =
      currentHitTime - lastHitSpecific;

    // If the specific target was hit faster than the splash window
    if (timeSinceSpecific.count() < kSplashTimeWindow) {
      ProbeRejectedHit(partOne.worldState, hitData, "SPLASH_TARGET_COOLDOWN", aggressor, targetRef);
      spdlog::warn("Splash attack from {:x} to {:x} ignored, target hit "
                   "too recently",
                   aggressor->GetFormId(), targetActor.GetFormId());
      return;
    }

    if (aggressor->CountRecentHits(std::chrono::duration<float>(
          kSplashTimeWindow)) >= kMaxSplashTargets) {
      ProbeRejectedHit(partOne.worldState, hitData, "SPLASH_TARGET_LIMIT", aggressor, targetRef);
      spdlog::warn("Splash attack from {:x} to {:x} ignored, too many "
                   "targets hit recently",
                   aggressor->GetFormId(), targetActor.GetFormId());
      return;
    }
  } else if (!CanHit(*aggressor, hitData, timePassedAnyTarget)) {
    ProbeRejectedHit(partOne.worldState, hitData, "ATTACK_COOLDOWN", aggressor, targetRef);
    WorldState* espmProvider = targetActor.GetParent();
    auto weapDNAM =
      espm::GetData<espm::WEAP>(hitData.source, espmProvider).weapDNAM;
    float expectedAttackTime = (1.1 * (1 / weapDNAM->speed)) -
      (1.1 * (1 / weapDNAM->speed) * (weapDNAM->speed <= 0.75 ? 0.45 : 0.3));
    spdlog::debug(
      "OnWeaponHit - Target {0:x} is not available for attack due to fast "
      "attack speed. Weapon: {1:x}. Elapsed time: {2}. Expected attack time: "
      "{3}",
      hitData.target, hitData.source, timePassedAnyTarget.count(),
      expectedAttackTime);
    return;
  }

  // if (IsDistanceValid(*aggressor, targetActor, hitData) == false) {
  //   float distance =
  //     std::sqrt(GetSqrDistanceToBounds(*aggressor, targetActor));

  //   // TODO: fix bounding boxes for creatures such as chicken, mudcrab, etc
  //   float reachPveHotfixMult =
  //     (aggressor->GetBaseId() <= 0x7 && targetActor.GetBaseId() <= 0x7)
  //     ? 1.f
  //     : std::numeric_limits<float>::infinity();

  //   float reach = GetReach(*aggressor, hitData.source, reachPveHotfixMult);
  //   uint32_t aggressorId = aggressor->GetFormId();
  //   uint32_t targetId = targetActor.GetFormId();
  //   spdlog::debug(
  //     fmt::format("{:x} actor can't reach {:x} target because distance {} is
  //     "
  //                 "greater then first actor attack radius {}",
  //                 aggressorId, targetId, distance, reach));
  //   return;
  // }

  ActorValues currentActorValues = targetActor.GetChangeForm().actorValues;

  float healthPercentage = currentActorValues.healthPercentage;

  if (targetActor.IsBlockActive()) {
    if (ShouldBeBlocked(*aggressor, targetActor)) {
      bool isRemoteBowAttack = false;

      auto sourceLookupResult =
        targetActor.GetParent()->GetEspm().GetBrowser().LookupById(
          hitData.source);
      if (sourceLookupResult.rec &&
          sourceLookupResult.rec->GetType() == espm::WEAP::kType) {
        auto weapData =
          espm::GetData<espm::WEAP>(hitData.source, targetActor.GetParent());
        if (weapData.weapDNAM) {
          if (weapData.weapDNAM->animType == espm::WEAP::AnimType::Bow ||
              weapData.weapDNAM->animType == espm::WEAP::AnimType::Crossbow) {
            if (!hitData.isBashAttack) {
              isRemoteBowAttack = true;
            }
          }
        }
      }

      bool isBlockingByShield = false;

      auto targetActorEquipmentEntries =
        targetActor.GetEquipment().inv.entries;
      for (auto& entry : targetActorEquipmentEntries) {
        if (entry.GetWorn() != Inventory::Worn::None) {
          auto res =
            targetActor.GetParent()->GetEspm().GetBrowser().LookupById(
              entry.baseId);
          if (res.rec && res.rec->GetType() == espm::ARMO::kType) {
            auto data =
              espm::GetData<espm::ARMO>(entry.baseId, targetActor.GetParent());
            bool isShield = data.equipSlotId > 0;
            if (isShield) {
              isBlockingByShield = isShield;
            }
          }
        }
      }

      if (!isRemoteBowAttack || isBlockingByShield) {
        hitData.isHitBlocked = true;
      }
    }
  }

  float damage = partOne.CalculateDamage(*aggressor, targetActor, hitData);
  damage = damage < 0.f ? 0.f : damage;
  float outBaseHealth = 0.f;
  currentActorValues.healthPercentage = CalculateCurrentHealthPercentage(
    targetActor, damage, healthPercentage, &outBaseHealth);

  currentActorValues.healthPercentage =
    currentActorValues.healthPercentage < 0.f
    ? 0.f
    : currentActorValues.healthPercentage;

  targetActor.NetSetPercentages(
    currentActorValues, aggressor,
    std::vector<espm::ActorValue>{ espm::ActorValue::Health }, hitData.source);
  aggressor->SetLastHitTime(targetActor.GetFormId(), currentHitTime);
  if (auto* probe = aetherius::combat::ActiveCombatProbe()) { // AETHERIUS DS-0b
    ProbeAcceptedHit(*probe, partOne.worldState, *aggressor, targetActor,
                     hitData, probeClientBlocked, false, damage,
                     healthPercentage, currentActorValues.healthPercentage, outBaseHealth);
  }
  // AETHERIUS D-P1: accepted physical hit; damage calculation above is untouched.
  if (partOne.worldState.aetheriusWeaponPoison) {
    aggressor->ApplyWeaponPoisonHit(targetActor, hitData.source, hitData.isHitBlocked,
      hitData.isBashAttack, currentActorValues.healthPercentage <= 0.f);
  }

  spdlog::debug(
    "OnWeaponHit - Target {0:x} is hit by {1} damage. Percentage was: {3}, "
    "percentage now: {2}, base health: {4})",
    hitData.target, damage, currentActorValues.healthPercentage,
    healthPercentage, outBaseHealth);
}

void ActionListener::SendPapyrusOnHitEvent(MpActor* aggressor,
                                           MpObjectReference* target,
                                           const HitData& hitData)
{
  auto& browser = partOne.worldState.GetEspm().GetBrowser();
  std::array<VarValue, 7> args;
  args[0] = VarValue(aggressor->ToGameObject()); // akAggressor
  args[1] = VarValue(std::make_shared<EspmGameObject>(
    browser.LookupById(hitData.source)));    // akSource
  args[2] = VarValue::None();                // akProjectile
  args[3] = VarValue(hitData.isPowerAttack); // abPowerAttack
  args[4] = VarValue(hitData.isSneakAttack); // abSneakAttack
  args[5] = VarValue(hitData.isBashAttack);  // abBashAttack
  args[6] = VarValue(hitData.isHitBlocked);  // abHitBlocked
  target->SendPapyrusEvent("OnHit", args.data(), args.size());
}

void ActionListener::OnNpcObservation(const RawMessageData& raw, const std::string& dump)
{
  uint32_t actorId = 0, level = 0, version = 0;
  uint32_t candidates = std::numeric_limits<uint32_t>::max();
  FormDesc key;
  uint64_t generation = 0;
  auto record = [&](const char* reason) {
    if (auto* probe = aetherius::combat::ActiveCombatProbe())
      probe->RecordNpcReport(actorId, version == 1 ? key : FormDesc{}, level, generation,
        reason, aetherius::combat::CombatProbeNowMs(), version, version == 2 ? key : FormDesc{}, candidates);
  };
  if (dump.size() > 1024) { record("INVALID_PACKET_SIZE"); return; }
  size_t keys = 0;
  const auto p = nlohmann::json::parse(dump, [&](int, nlohmann::json::parse_event_t event, nlohmann::json&) {
    if (event == nlohmann::json::parse_event_t::key) ++keys;
    return true;
  }, false);
  auto uint = [&](const char* field, uint64_t max) {
    return p.contains(field) && p[field].is_number_unsigned() && p[field].get<uint64_t>() <= max;
  };
  if (p.is_object() && uint("v", 2) && p["v"] != 0) version = p["v"].get<uint32_t>();
  const auto* field = version == 2 ? "race" : "base";
  if (!p.is_object() || p.size() != 6 || keys != 6 || !version ||
      p.value("channel", nlohmann::json()) != "aetherius.npc.observation" ||
      !uint("actor", std::numeric_limits<uint32_t>::max()) || !uint("level", 65535) || p["level"] == 0 ||
      !uint("generation", 9007199254740991ull) || p["generation"] == 0 ||
      !p.contains(field) || !p[field].is_string()) { record("INVALID_PACKET"); return; }
  actorId = p["actor"].get<uint32_t>(); level = p["level"].get<uint32_t>(); generation = p["generation"].get<uint64_t>();
  auto* myActor = partOne.serverState.ActorByUser(raw.userId);
  const auto ref = partOne.worldState.LookupFormById(actorId);
  auto* actor = ref ? ref->AsActor() : nullptr;
  if (!myActor) { record("NO_SESSION_ACTOR"); return; }
  if (!actor || actor->IsCreatedAsPlayer()) { record("NOT_AN_NPC"); return; }
  if (partOne.serverState.UserByActor(actor) != Networking::InvalidUserId) { record("ACTOR_OWNED_BY_USER"); return; }
  const auto hoster = partOne.worldState.hosters.find(actorId);
  if (hoster == partOne.worldState.hosters.end() || hoster->second != myActor->GetFormId()) { record("NOT_CURRENT_HOSTER"); return; }
  if (actor->IsDead()) { record("NPC_DEAD"); return; }
  const auto text = p[field].get<std::string>();
  const auto* invalidKey = version == 2 ? "INVALID_RACE_KEY" : "INVALID_BASE_KEY";
  const auto colon = text.find(':');
  if (colon == std::string::npos || colon == 0 || colon > 6 || text.size() > 268 ||
      text.find_first_of("/\\") != std::string::npos ||
      !std::all_of(text.begin(), text.begin() + colon, [](unsigned char c) { return std::isxdigit(c); }) ||
      text.find(':', colon + 1) != std::string::npos || text.find('\0') != std::string::npos) { record(invalidKey); return; }
  try { key = FormDesc::FromString(text); }
  catch (const std::exception&) { record(invalidKey); return; }
  if (key.file.empty() || !key.shortFormId || key.shortFormId > 0xffffff) { record(invalidKey); return; }
  const char* reason;
  try { reason = version == 2 ? actor->AdoptNpcRaceObservation(key, level, generation, &candidates)
                            : actor->AdoptNpcObservation(key, level, generation); }
  catch (const std::out_of_range&) { record(version == 2 ? "RACE_PLUGIN_ABSENT" : "BASE_PLUGIN_ABSENT"); return; }
  record(reason);
}

// DS-0g-fix2: diagnostic evidence only. Never adopts or writes actor state.
void ActionListener::OnNpcObservationUnavailable(const RawMessageData& raw, const std::string& dump)
{
  uint32_t actorId = 0;
  uint64_t generation = 0;
  std::string reason;
  auto record = [&](const char* result) {
    if (auto* probe = aetherius::combat::ActiveCombatProbe())
      probe->RecordNpcUnavailable(actorId, generation, reason, result, aetherius::combat::CombatProbeNowMs());
  };
  if (dump.size() > 1024) { record("INVALID_PACKET_SIZE"); return; }
  size_t keys = 0;
  const auto p = nlohmann::json::parse(dump, [&](int, nlohmann::json::parse_event_t event, nlohmann::json&) {
    if (event == nlohmann::json::parse_event_t::key) ++keys;
    return true;
  }, false);
  auto uint = [&](const char* key, uint64_t max) {
    return p.contains(key) && p[key].is_number_unsigned() && p[key].get<uint64_t>() <= max;
  };
  if (!p.is_object() || p.size() != 5 || keys != 5 ||
      p.value("channel", nlohmann::json()) != "aetherius.npc.observation.unavailable" ||
      !uint("v", 1) || p["v"] != 1 || !uint("actor", std::numeric_limits<uint32_t>::max()) ||
      !uint("generation", 9007199254740991ull) || p["generation"] == 0 ||
      !p.contains("reason") || !p["reason"].is_string()) { record("INVALID_PACKET"); return; }
  actorId = p["actor"].get<uint32_t>(); generation = p["generation"].get<uint64_t>();
  const auto reportedReason = p["reason"].get<std::string>();
  if (!aetherius::npc::IsUnavailableReason(reportedReason)) { record("INVALID_REASON"); return; }
  reason = reportedReason; // Only the closed vocabulary reaches the probe.
  auto* myActor = partOne.serverState.ActorByUser(raw.userId);
  const auto ref = partOne.worldState.LookupFormById(actorId);
  auto* actor = ref ? ref->AsActor() : nullptr;
  if (!myActor) { record("NO_SESSION_ACTOR"); return; }
  if (!actor || actor->IsCreatedAsPlayer()) { record("NOT_AN_NPC"); return; }
  if (partOne.serverState.UserByActor(actor) != Networking::InvalidUserId) { record("ACTOR_OWNED_BY_USER"); return; }
  const auto hoster = partOne.worldState.hosters.find(actorId);
  if (hoster == partOne.worldState.hosters.end() || hoster->second != myActor->GetFormId()) { record("NOT_CURRENT_HOSTER"); return; }
  if (actor->IsDead()) { record("NPC_DEAD"); return; }
  if (!actor->NeedsNpcObservation()) { record("NOT_AN_OBSERVABLE_NPC"); return; }
  if (generation != actor->GetNpcGeneration()) { record("STALE_GENERATION"); return; }
  record("ACCEPTED");
}
