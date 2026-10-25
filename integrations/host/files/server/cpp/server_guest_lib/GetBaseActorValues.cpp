#include "GetBaseActorValues.h"
#include "EvaluateTemplate.h"
#include "aetherius_combat/NpcObservation.h"
#include "WorldState.h"
#include <spdlog/spdlog.h>
#include <limits>

void BaseActorValues::VisitBaseActorValuesAndPercentages(
  BaseActorValues& baseActorValues, MpChangeForm& changeForm,
  CreateActorMessage& message)
{
  message.props.health = baseActorValues.health;
  message.props.stamina = baseActorValues.stamina;
  message.props.magicka = baseActorValues.magicka;
  message.props.healRate = baseActorValues.healRate;
  message.props.staminaRate = baseActorValues.staminaRate;
  message.props.magickaRate = baseActorValues.magickaRate;
  message.props.healRateMult = baseActorValues.healRateMult;
  message.props.staminaRateMult = baseActorValues.staminaRateMult;
  message.props.magickaRateMult = baseActorValues.magickaRateMult;
  message.props.healthPercentage = changeForm.actorValues.healthPercentage;
  message.props.staminaPercentage = changeForm.actorValues.staminaPercentage;
  message.props.magickaPercentage = changeForm.actorValues.magickaPercentage;
}

BaseActorValues GetBaseActorValues(WorldState* worldState, uint32_t baseId,
                                   uint32_t raceIdOverride,
                                   const std::vector<FormDesc>& templateChain,
                                   std::optional<uint16_t> observedLevel)
{

  auto npcData = espm::GetData<espm::NPC_>(baseId, worldState);

  uint32_t raceId = raceIdOverride
    ? raceIdOverride
    : EvaluateTemplate<espm::NPC_::UseTraits>(
        worldState, baseId, templateChain,
        [](const auto& npcLookupResult, const auto& npcData) {
          return npcLookupResult.ToGlobalId(npcData.race);
        });
  auto raceData = espm::GetData<espm::RACE>(raceId, worldState);

  espm::NPC_::Data attributesNpcData = EvaluateTemplate<espm::NPC_::UseStats>(
    worldState, baseId, templateChain,
    [](const auto&, const auto& npcData) { return npcData; });

  BaseActorValues actorValues;
  const auto statsLookup = EvaluateTemplate<espm::NPC_::UseStats>(worldState, baseId, templateChain,
    [](const auto& lookup, const auto&) { return lookup; });
  const auto fields = aetherius::npc::ReadNpc(statsLookup, worldState->GetEspmCache());
  // PC level mult without an observation retains the declared pre-DS-0g baseline.
  // Fixed NPCs have their record level even before an observation.
  const uint32_t level = observedLevel ? *observedLevel : (fields.pcMult ? 0 : fields.level);
  std::array<float, 3> growth{};
  if (baseId != FormDesc::FromString("7:Skyrim.esm").ToFormId(worldState->pluginIndexMapping)) {
    if (!fields.present) throw std::runtime_error("UNSUPPORTED: NPC_ACBS_ABSENT");
    if (fields.autoCalc && level) {
      const auto cls = aetherius::npc::ReadClass(worldState->GetEspm().GetBrowser().LookupById(fields.classId), worldState->GetEspmCache());
      if (!cls.present) throw std::runtime_error("UNSUPPORTED: NPC_CLASS_ABSENT");
      const auto hmsPoints = aetherius::npc::Setting<int32_t>(*worldState, "21a73:Skyrim.esm", "iAVDhmsLevelUp");
      const auto skillPoints = aetherius::npc::Setting<int32_t>(*worldState, "c790f:Skyrim.esm", "iAVDSkillsLevelUp");
      const auto skillStart = aetherius::npc::Setting<int32_t>(*worldState, "803:Aetherius.esp", "iAVDSkillStart");
      if (hmsPoints > 255 || skillPoints > 255 || skillStart > 100)
        throw std::runtime_error("UNSUPPORTED: NPC_GMST_NUMERIC_DOMAIN");
      // Winning GMSTs, not the vanilla 10/8/15 defaults. See sources in §6.
      aetherius::npc::Distribute(growth, cls.stats, hmsPoints * (level - 1), std::numeric_limits<float>::max());
      const auto gmst = aetherius::npc::Setting<float>(*worldState, "23bb9:Skyrim.esm", "fNPCHealthLevelBonus");
      growth[0] += gmst * (level - 1);
      actorValues.npcSkills = aetherius::npc::AutoSkills(worldState->GetEspm().GetBrowser().LookupById(raceId).rec,
        worldState->GetEspmCache(), cls, level, skillStart, skillPoints);
    } else if (!fields.autoCalc && fields.skillsPresent) actorValues.npcSkills = fields.skills;
  }

  actorValues.health =
    raceData.startingHealth + attributesNpcData.healthOffset + growth[0];
  if (actorValues.health <= 0) {
    spdlog::warn("GetBaseActorValues {:x} {:x} - Negative Health found: "
                 "startingHealth={}, healthOffset={}, defaulting to 100",
                 baseId, raceIdOverride, raceData.startingHealth,
                 attributesNpcData.healthOffset);
    actorValues.health = 100.f;
  }

  actorValues.magicka =
    raceData.startingMagicka + attributesNpcData.magickaOffset + growth[1];
  if (actorValues.magicka < 0) { // zero magicka is ok, negative isn't
    spdlog::warn("GetBaseActorValues {:x} {:x} - Negative Magicka found: "
                 "startingMagicka={}, magickaOffset={}, defaulting to 100",
                 baseId, raceIdOverride, raceData.startingMagicka,
                 attributesNpcData.magickaOffset);
    actorValues.magicka = 100.f;
  }

  actorValues.stamina =
    raceData.startingStamina + attributesNpcData.staminaOffset + growth[2];
  if (actorValues.stamina <= 0) {
    spdlog::warn("GetBaseActorValues {:x} {:x} - Negative Stamina found: "
                 "startingStamina={}, staminaOffset={}, defaulting to 100",
                 baseId, raceIdOverride, raceData.startingStamina,
                 attributesNpcData.staminaOffset);
    actorValues.stamina = 100.f;
  }

  actorValues.healRate = raceData.healRegen;
  actorValues.magickaRate = raceData.magickaRegen;
  actorValues.staminaRate = raceData.staminaRegen;

  spdlog::trace(
    "GetBaseActorValues {:x} {:x} - startingHealth={}, healthOffset={}",
    baseId, raceIdOverride, raceData.startingHealth,
    attributesNpcData.healthOffset);

  return actorValues;
}
