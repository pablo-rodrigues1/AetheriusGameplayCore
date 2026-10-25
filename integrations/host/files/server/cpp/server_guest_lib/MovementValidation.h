#pragma once
#include "FormDesc.h"
#include "NiPoint3.h"
#include "PartOne.h"
#include "PluginIndexMapping.h"
#include <cstdint>
#include <chrono>
#include <memory>
#include <unordered_map>
#include <string>
#include <vector>

class MpActor;

namespace MovementValidation {
// Transport retry state only. Never stores or changes gameplay coordinates.
class NpcCorrections
{
public:
  ~NpcCorrections();
  enum class Result { None, Sent, Suppressed };
  using Clock = std::chrono::steady_clock;
  Result Correct(PartOne& partOne, MpActor& actor, Networking::UserId userId,
                 Clock::time_point now);
  void Reset(uint32_t actorId);

private:
  struct State;
  void Prune(PartOne& partOne);
  std::unordered_map<uint32_t, std::shared_ptr<State>> states;
};
bool Validate(PartOne& partOne, const NiPoint3& currentPos,
              const NiPoint3& currentRot, const FormDesc& currentCellOrWorld,
              const NiPoint3& newPos, const FormDesc& newCellOrWorld,
              Networking::UserId userId, MpActor* actor,
              const PluginIndexMapping& pluginIndexMapping,
              NpcCorrections* corrections = nullptr,
              NpcCorrections::Clock::time_point now = NpcCorrections::Clock::now(),
              bool teleportFlag = false);
}
