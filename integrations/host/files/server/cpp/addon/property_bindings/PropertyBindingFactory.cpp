#include "PropertyBindingFactory.h"

#include "ActorNeighborsBinding.h"
#include "AngleBinding.h"
#include "AppearanceBinding.h"
#include "BaseDescBinding.h"
#include "ConsoleCommandsAllowedBinding.h"
#include "CustomPropertyBinding.h"
#include "CombatProfileBinding.h"
#include "EquipmentBinding.h"
#include "IdxBinding.h"
#include "InventoryBinding.h"
#include "IsDeadBinding.h"
#include "IsDisabledBinding.h"
#include "IsOnlineBinding.h"
#include "IsOpenBinding.h"
#include "LastAnimEventBinding.h"
#include "LocationalDataBinding.h"
#include "NeighborsBinding.h"
#include "OnlinePlayersBinding.h"
#include "PercentagesBinding.h"
#include "PosBinding.h"
#include "ProfileIdBinding.h"
#include "PoisonDoseBinding.h" // AETHERIUS D-P1
#include "AttributeBonusesBinding.h" // AETHERIUS C3d
#include "DevAttributesBinding.h" // AETHERIUS DEV-A1
#include "RespawnPercentagesBinding.h"
#include "SpawnDelayBinding.h"
#include "SpawnPointBinding.h"
#include "TemplateChainBinding.h"
#include "TypeBinding.h"
#include "WorldOrCellDescBinding.h"
#include "libespm/espm.h"
#include <set>

// Server-owned learned abilities. This property deliberately has no setter.
class LearnedSpellsBinding final : public PropertyBinding
{
public:
  std::string GetPropertyName() const override { return "knownSpells"; }
  Napi::Value Get(Napi::Env env, ScampServer& server, uint32_t formId) override
  {
    auto& world = server.GetPartOne()->worldState;
    auto& actor = world.GetFormAt<MpActor>(formId);
    const auto learned = actor.GetSpellList();
    std::set<uint32_t> spells(learned.begin(), learned.end());
    const auto npc = world.GetEspm().GetBrowser().LookupById(actor.GetBaseId());
    const auto npcData = espm::GetData<espm::NPC_>(actor.GetBaseId(), &world);
    for (const auto raw : npcData.spells) spells.insert(npc.ToGlobalId(raw));
    // Aetherius: raça do personagem (aparência), não a do NPC base 0x7 de todo
    // jogador (Nord) — senão todo mundo listava as habilidades raciais Nord.
    const auto raceId = actor.GetRaceId();
    const auto race = world.GetEspm().GetBrowser().LookupById(raceId);
    const auto raceData = espm::GetData<espm::RACE>(raceId, &world);
    for (const auto raw : raceData.spells) spells.insert(race.ToGlobalId(raw));
    auto result = Napi::Array::New(env, spells.size());
    size_t i = 0;
    for (const auto spell : spells) result.Set(i++, Napi::Number::New(env, spell));
    return result;
  }
};

std::map<std::string, std::shared_ptr<PropertyBinding>>
PropertyBindingFactory::CreateStandardPropertyBindings()
{
  std::map<std::string, std::shared_ptr<PropertyBinding>> result;
  result["actorNeighbors"] = std::make_shared<ActorNeighborsBinding>();
  result["angle"] = std::make_shared<AngleBinding>();
  result["appearance"] = std::make_shared<AppearanceBinding>();
  result["baseDesc"] = std::make_shared<BaseDescBinding>();
  result["equipment"] = std::make_shared<EquipmentBinding>();
  result["aetheriusCombatProfile"] = std::make_shared<CombatProfileBinding>();
  result["aetheriusNpcObservation"] = std::make_shared<CombatNpcObservationBinding>();
  result["inventory"] = std::make_shared<InventoryBinding>();
  result["knownSpells"] = std::make_shared<LearnedSpellsBinding>();
  result["isDead"] = std::make_shared<IsDeadBinding>();
  result["isDisabled"] = std::make_shared<IsDisabledBinding>();
  result["isOnline"] = std::make_shared<IsOnlineBinding>();
  result["isOpen"] = std::make_shared<IsOpenBinding>();
  result["locationalData"] = std::make_shared<LocationalDataBinding>();
  result["neighbors"] = std::make_shared<NeighborsBinding>();
  result["onlinePlayers"] = std::make_shared<OnlinePlayersBinding>();
  result["percentages"] = std::make_shared<PercentagesBinding>();
  result["pos"] = std::make_shared<PosBinding>();
  result["profileId"] = std::make_shared<ProfileIdBinding>();
  result["aetheriusPoisonDoseBonus"] = std::make_shared<PoisonDoseBinding>(); // AETHERIUS D-P1
  result["aetheriusAttributeBonuses"] = std::make_shared<AttributeBonusesBinding>(); // AETHERIUS C3d
  result["aetheriusDevAttributes"] = std::make_shared<DevAttributesBinding>(); // AETHERIUS DEV-A1
  result["aetheriusPoisonStatus"] = std::make_shared<PoisonStatusBinding>(); // AETHERIUS D-P1
  result["aetheriusWeaponPoisonIntent"] = std::make_shared<WeaponPoisonIntentBinding>(); // AETHERIUS D-P1-fix2
  result["spawnPoint"] = std::make_shared<SpawnPointBinding>();
  result["type"] = std::make_shared<TypeBinding>();
  result["worldOrCellDesc"] = std::make_shared<WorldOrCellDescBinding>();
  result["idx"] = std::make_shared<IdxBinding>();
  result["consoleCommandsAllowed"] =
    std::make_shared<ConsoleCommandsAllowedBinding>();
  result["spawnDelay"] = std::make_shared<SpawnDelayBinding>();
  result["templateChain"] = std::make_shared<TemplateChainBinding>();
  result["lastAnimEvent"] = std::make_shared<LastAnimEventBinding>();
  result["respawnPercentages"] = std::make_shared<RespawnPercentagesBinding>();
  return result;
}

std::shared_ptr<PropertyBinding>
PropertyBindingFactory::CreateCustomPropertyBinding(
  const std::string& propertyName)
{
  return std::make_shared<CustomPropertyBinding>(propertyName);
}
