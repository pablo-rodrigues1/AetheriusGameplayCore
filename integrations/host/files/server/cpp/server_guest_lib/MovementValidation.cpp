#include "MovementValidation.h"
#include "FormDesc.h"
#include "NiPoint3.h"
#include "PartOne.h"
#include "TeleportMessage.h"
#include "TeleportMessage2.h"
#include "aetherius_combat/CombatProbe.h"
#include <nlohmann/json.hpp>
#include <string>

namespace MovementValidation {

struct NpcCorrections::State : MpActor::DestroyEventSink
{
  std::weak_ptr<MpForm> identity, hosterIdentity;
  uint32_t hoster = 0;
  std::optional<Clock::time_point> lastSent;
  void BeforeDestroy(MpActor&) override
  {
    // Also runs when DestroyForm retains a shared_ptr outside the world.
    identity.reset(); hosterIdentity.reset(); lastSent.reset(); hoster = 0;
  }
};

NpcCorrections::~NpcCorrections()
{
  while (!states.empty()) Reset(states.begin()->first);
}

void NpcCorrections::Reset(uint32_t actorId)
{
  auto it = states.find(actorId);
  if (it == states.end()) return;
  if (auto form = it->second->identity.lock()) {
    if (auto actor = form->AsActor()) actor->RemoveEventSink(it->second);
  }
  states.erase(it);
}

void NpcCorrections::Prune(PartOne& partOne)
{
  for (auto it = states.begin(); it != states.end();) {
    const auto& state = *it->second;
    auto form = state.identity.lock();
    auto hoster = state.hosterIdentity.lock();
    auto currentHoster = partOne.worldState.hosters.find(it->first);
    if (!form || !hoster ||
        partOne.worldState.FindLoadedForm(it->first).lock() != form ||
        partOne.worldState.FindLoadedForm(state.hoster).lock() != hoster ||
        currentHoster == partOne.worldState.hosters.end() ||
        currentHoster->second != state.hoster) {
      auto id = it++->first;
      Reset(id);
    } else ++it;
  }
}

NpcCorrections::Result NpcCorrections::Correct(
  PartOne& partOne, MpActor& actor, Networking::UserId userId,
  Clock::time_point now)
{
  Prune(partOne);
  auto hoster = partOne.serverState.ActorByUser(userId);
  auto currentHoster = partOne.worldState.hosters.find(actor.GetFormId());
  auto identity = partOne.worldState.FindLoadedForm(actor.GetFormId()).lock();
  if (!hoster || hoster == &actor ||
      partOne.serverState.UserByActor(&actor) != Networking::InvalidUserId ||
      currentHoster == partOne.worldState.hosters.end() ||
      currentHoster->second != hoster->GetFormId() || !identity ||
      identity.get() != &actor ||
      partOne.worldState.LookupFormByIdx(actor.GetIdx()) != &actor)
    return Result::None;

  auto& state = states[actor.GetFormId()];
  if (!state) {
    state = std::make_shared<State>();
    state->identity = identity;
    state->hosterIdentity = partOne.worldState.FindLoadedForm(hoster->GetFormId());
    state->hoster = hoster->GetFormId();
    actor.AddEventSink(state);
  }
  if (state->lastSent && now - *state->lastSent < std::chrono::seconds(1))
    return Result::Suppressed;

  // Synchronous: no queued retry retaining an idx or a position. The next
  // rejected movement rechecks the current identity and hoster above.
  TeleportMessage msg;
  msg.idx = actor.GetIdx();
  const auto& pos = actor.GetPos();
  const auto& rot = actor.GetAngle();
  msg.pos = { pos[0], pos[1], pos[2] };
  msg.rot = { rot[0], rot[1], rot[2] };
  msg.worldOrCell = actor.GetCellOrWorld().ToFormId(partOne.worldState.pluginIndexMapping);
  partOne.GetSendTarget().Send(userId, msg, true);
  state->lastSent = now;
  return Result::Sent;
}

bool Validate(PartOne& partOne, const NiPoint3& currentPos,
              const NiPoint3& currentRot, const FormDesc& currentCellOrWorld,
              const NiPoint3& newPos, const FormDesc& newCellOrWorld,
              Networking::UserId userId, MpActor* actor,
              const PluginIndexMapping& pluginIndexMapping,
              NpcCorrections* corrections, NpcCorrections::Clock::time_point now,
              bool teleportFlag)
{
  constexpr float kSqrMaxDistance = 4096.f * 4096.f;

  PartOneSendTargetWrapper& sendTarget = partOne.GetSendTarget();

  if (currentCellOrWorld != newCellOrWorld ||
      (currentPos - newPos).SqrLength() >= kSqrMaxDistance) {

    bool isMe = actor && partOne.serverState.ActorByUser(userId) == actor;
    if (isMe) {
      TeleportMessage2 msg;
      msg.pos = { currentPos[0], currentPos[1], currentPos[2] };
      msg.rot = { currentRot[0], currentRot[1], currentRot[2] };
      msg.worldOrCell = currentCellOrWorld.ToFormId(pluginIndexMapping);
      sendTarget.Send(userId, msg, true);
    } else if (actor && corrections) {
      auto result = corrections->Correct(partOne, *actor, userId, now);
      if (result != NpcCorrections::Result::None) {
        if (auto* probe = aetherius::combat::ActiveCombatProbe()) {
          const char* reason = teleportFlag ? "TELEPORT_FLAG" :
            currentCellOrWorld != newCellOrWorld ? "WORLD_OR_CELL" : "DISTANCE";
          probe->RecordNpcMovementRejection(*actor, partOne.worldState, reason,
            result == NpcCorrections::Result::Sent,
            aetherius::combat::CombatProbeNowMs());
        }
      }
    }
    return false;
  }
  if (actor && corrections) corrections->Reset(actor->GetFormId());
  return true;
}

} // namespace MovementValidation
