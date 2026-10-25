#pragma once
#include "ActorValues.h"
#include "libespm/Loader.h"
#include "libespm/espm.h"
#include <WorldState.h>
#include <cstdint>
#include <fmt/format.h>

#include "CreateActorMessage.h"

struct BaseActorValues : public ActorValues
{
  std::optional<std::array<float, 18>> npcSkills; // DS-0g: read-only, not used by damage.
  void VisitBaseActorValuesAndPercentages(BaseActorValues& baseActorValues,
                                          MpChangeForm& changeForm,
                                          CreateActorMessage& message);
};

BaseActorValues GetBaseActorValues(WorldState* worldState, uint32_t baseId,
                                   uint32_t raceIdOverride,
                                   const std::vector<FormDesc>& templateChain,
                                   std::optional<uint16_t> observedLevel = std::nullopt);
