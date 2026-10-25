#pragma once
#include "AnimationData.h"
#include "Appearance.h"
#include "Equipment.h"
#include "GetBaseActorValues.h"
#include "aetherius_combat/DevAttributes.h" // AETHERIUS DEV-A1
#include "MpObjectReference.h"
#include "libespm/espm.h"
#include <map>
#include <memory>
#include <optional>
#include <set>

#include "DeathStateContainerMessage.h"

class WorldState;
struct ActorValues;
class RespawnEvent;
class ActiveMagicEffectsMap;

class MpActor : public MpObjectReference
{
public:
  friend class RespawnEvent;

  static const char* Type() { return "Actor"; }
  const char* GetFormType() const override { return "Actor"; }

  MpActor(const LocationalData& locationalData_,
          const FormCallbacks& calbacks_, uint32_t optBaseId = 0);

  const bool& IsRaceMenuOpen() const;
  const bool& IsDead() const;
  const bool& IsRespawning() const;

  bool IsSpellLearned(uint32_t spellId) const; // including from base
  bool IsSpellLearnedFromBase(uint32_t spellId) const;
  std::vector<uint32_t> GetSpellList() const;

  std::unique_ptr<const Appearance> GetAppearance() const;
  const std::string& GetAppearanceAsJson();
  std::string GetLastAnimEventAsJson() const;
  const Equipment& GetEquipment() const;
  std::array<std::optional<Inventory::Entry>, 2> GetEquippedWeapon() const;
  std::array<std::optional<Inventory::Entry>, 2> GetEquippedScroll() const;
  std::array<std::optional<Inventory::Entry>, 2> GetEquippedLight() const;
  std::array<std::optional<Inventory::Entry>, 2> GetEquippedShield() const;
  uint32_t GetRaceId() const;
  bool IsWeaponDrawn() const;
  espm::ObjectBounds GetBounds() const;
  const std::vector<FormDesc>& GetTemplateChain() const;
  bool IsCreatedAsPlayer() const;
  // DS-0g: cached observation context; getters do not resolve records on a hit.
  bool NeedsNpcObservation() const noexcept { return npcObservationNeeded; }
  bool IsNpcConfirmed() const noexcept { return npcConfirmed; }
  uint16_t GetNpcLevel() const noexcept { return npcLevel; }
  uint64_t GetNpcGeneration() const noexcept { return npcGeneration; }
  const FormDesc& GetNpcTraitsProvider() const noexcept { return npcTraitsProvider; }
  const FormDesc& GetNpcStatsProvider() const noexcept { return npcStatsProvider; }
  const char* AdoptNpcObservation(const FormDesc& base, uint32_t level, uint64_t generation,
    ChangeFormGuard::Mode mode = ChangeFormGuard::Mode::RequestSave);
  const char* AdoptNpcRaceObservation(const FormDesc& race, uint32_t level, uint64_t generation,
    uint32_t* candidates = nullptr, ChangeFormGuard::Mode mode = ChangeFormGuard::Mode::RequestSave);
  std::optional<std::array<float, 18>> GetNpcSkills() const { return GetBaseValues().npcSkills; }
  const ActorValues& GetActorValues() const;
  const ActiveMagicEffectsMap& GetActiveMagicEffects() const;
  int32_t GetProfileId() const;

  float GetHealthRespawnPercentage() const;
  float GetMagickaRespawnPercentage() const;
  float GetStaminaRespawnPercentage() const;

  bool ShouldSkipRestoration() const noexcept;
  void UpdateNextRestorationTime(std::chrono::seconds duration) noexcept;

  void SetRaceMenuOpen(bool isOpen);
  void SetAppearance(const Appearance* newAppearance);
  void SetEquipment(const Equipment& newEquipment);

  void SetHealthRespawnPercentage(float percentage);
  void SetMagickaRespawnPercentage(float percentage);
  void SetStaminaRespawnPercentage(float percentage);

  void AddToFaction(Faction faction, bool lazyLoad = true);
  bool IsInFaction(FormDesc factionForm, bool lazyLoad = true);
  std::vector<Faction> GetFactions(int minFactionID, int maxFactionID,
                                   bool lazyLoad = true);
  void RemoveFromFaction(FormDesc factionForm, bool lazyLoad = true);

  void VisitProperties(CreateActorMessage& message,
                       VisitPropertiesMode mode) override;
  void Disable() override;

  void SendToUser(const IMessageBase& message, bool reliable);
  void SendToUserDeferred(const IMessageBase& message, bool reliable,
                          int deferredChannelId,
                          bool overwritePreviousChannelMessages);

  Networking::UserId GetUserId() const;

  // Returns the actor to send messages to, considering hosters.
  // If this actor is offline and has a hoster, returns the hoster.
  // Otherwise returns this actor.
  MpActor& GetActorToSendTo();

  [[nodiscard]] bool OnEquip(uint32_t baseId);

  // TODO: consider removing the entire DestroyEventSink feature because it's
  // only used in unit tests
  class DestroyEventSink
  {
  public:
    virtual ~DestroyEventSink() = default;
    virtual void BeforeDestroy(MpActor& actor) = 0;
  };

  void AddEventSink(std::shared_ptr<DestroyEventSink> sink);
  void RemoveEventSink(std::shared_ptr<DestroyEventSink> sink);

  class DisableEventSink
  {
  public:
    virtual ~DisableEventSink() = default;
    virtual void BeforeDisable(MpActor& actor) = 0;
  };

  void AddEventSink(std::shared_ptr<DisableEventSink> sink);
  void RemoveEventSink(std::shared_ptr<DisableEventSink> sink);

  MpChangeForm GetChangeForm() const override;
  void ApplyChangeForm(const MpChangeForm& changeForm) override;

  uint32_t NextSnippetIndex(
    std::optional<Viet::Promise<VarValue>> promise = std::nullopt);

  void ResolveSnippet(uint32_t snippetIdx, VarValue v);
  void SetPercentages(const ActorValues& actorValues,
                      MpActor* aggressor = nullptr);
  void SetPercentage(espm::ActorValue av, float percentage);
  void NetSendChangeValues(
    const ActorValues& actorValues,
    const std::optional<std::vector<espm::ActorValue>>& avFilter);
  // Aetherius SkyDeath: source = arma/magia do golpe (0 sem origem conhecida).
  void NetSetPercentages(
    const ActorValues& actorValues, MpActor* aggressor,
    const std::optional<std::vector<espm::ActorValue>>& avFilter,
    uint32_t source = 0);

  std::chrono::steady_clock::time_point GetLastAttributesPercentagesUpdate();
  std::chrono::steady_clock::time_point GetLastHitTime(
    std::optional<uint32_t> targetId) const;
  size_t CountRecentHits(std::chrono::duration<float> timeWindow) const;

  void SetLastAttributesPercentagesUpdate(
    std::chrono::steady_clock::time_point timePoint =
      std::chrono::steady_clock::now());
  void SetLastHitTime(uint32_t targetId,
                      std::chrono::steady_clock::time_point timePoint);

  std::chrono::duration<float> GetDurationOfAttributesPercentagesUpdate(
    std::chrono::steady_clock::time_point now);

  void Kill(MpActor* killer = nullptr, bool shouldTeleport = false);
  void Respawn(bool shouldTeleport = true);
  void RespawnWithDelay(bool shouldTeleport = true);
  void Teleport(const LocationalData& position);
  void SetSpawnPoint(const LocationalData& position);
  LocationalData GetSpawnPoint() const;
  LocationalData GetEditorLocationalData() const;
  const float GetRespawnTime() const;
  void SetRespawnTime(float time);

  void SetIsDead(bool isDead);

  void RestoreActorValue(espm::ActorValue av, float value);
  void DamageActorValue(espm::ActorValue av, float value);
  void SetActorValue(espm::ActorValue actorValue, float value);

  // TODO: only used in legacy MGEF implementation, remove when MGEF is
  // rewritten
  void SetActorValues(const ActorValues& actorValues);

  BaseActorValues GetBaseValues() const; // AETHERIUS DEV-A1
  // DS-0d: read-only inputs for the probe's bounded maximum cache.
  const std::string& GetCombatProbeAppearanceDump() const;
  uint64_t GetCombatProbeMaximumRevision() const noexcept { return aetheriusDevAttributesRevision; }
  BaseActorValues GetMaximumValues() const; // AETHERIUS DEV-A1
  void SetDevAttributes(const std::optional<aetherius::development::Attributes>& attributes); // AETHERIUS DEV-A1
  void SetAttributeBonuses(const std::optional<aetherius::attributes::Bonuses>& bonuses); // AETHERIUS C3d
  bool HasAttributeBonuses() const; // AETHERIUS C3d
  void SendAttributeMaximumValues(); // AETHERIUS C3d
  bool HasDevAttributes() const; // AETHERIUS DEV-A1
  void ApplyDevAttributes(BaseActorValues& values) const; // AETHERIUS DEV-A1

  void DropItem(const uint32_t baseId, const Inventory::Entry& entry);
  void SetIsBlockActive(bool isBlockActive);
  bool IsBlockActive() const;
  NiPoint3 GetViewDirection() const;
  void IncreaseBlockCount() noexcept;
  void ResetBlockCount() noexcept;
  uint32_t GetBlockCount() const noexcept;
  void ApplyMagicEffect(espm::Effects::Effect& effect,
                        bool hasSweetpie = false,
                        bool durationOverriden = false);
  void ApplyMagicEffects(std::vector<espm::Effects::Effect>& effects,
                         bool hasSweetpie = false,
                         bool durationOverriden = false);
  void RemoveMagicEffect(const espm::ActorValue actorValue);
  void RemoveAllMagicEffects();
  void ReapplyMagicEffects();

  bool GetConsoleCommandsAllowedFlag() const;
  void SetConsoleCommandsAllowedFlag(bool newValue);

  void EquipBestWeapon(std::optional<uint32_t> previousNumChanges = std::nullopt);

  void AddSpell(uint32_t spellId);
  void RemoveSpell(uint32_t spellId);

  void SetLastAnimEvent(const std::optional<AnimationData>& animationData);
  std::optional<AnimationData> GetLastAnimEvent() const;

private:
  struct Impl;
public:
  // AETHERIUS D-P1: transient host state; Core is the single bonus writer.
  bool TryUseWeaponPoison(uint32_t baseId);
  void RequestWeaponPoison(uint32_t poisonId, uint32_t weaponId, bool leftHand); // AETHERIUS D-P1-fix2
  bool ReconcileWeaponPoisonEquipment(const Equipment& incoming);
  void ApplyWeaponPoisonHit(MpActor& target, uint32_t source, bool blocked, bool bash, bool fatal);
  uint32_t ApplyWeaponPoisonEffect(const espm::Effects::Effect& effect, const espm::MGEF::DATA& data, bool conditions, MpActor* poisoner = nullptr);
  void PublishWeaponPoisonEquipment(bool toOwner = true); // AETHERIUS D-P1
  void ScheduleWeaponPoisonTick(espm::ActorValue av, std::weak_ptr<MpForm> poisoner, Networking::UserId user); // AETHERIUS D-P1
  uint32_t GetPoisonDoseBonus() const { return aetheriusPoisonDoseBonus; }
  void SetPoisonDoseBonus(uint32_t bonus) { aetheriusPoisonDoseBonus = bonus; }
  uint32_t GetPoisonResult() const { return aetheriusPoisonResult; }
  uint32_t GetPoisonUnsupported() const { return aetheriusPoisonUnsupported; }
private:
  bool npcObservationNeeded = false, npcConfirmed = false;
  bool npcObservationRestoreWarned = false;
  uint16_t npcLevel = 0;
  uint64_t npcGeneration = 1;
  FormDesc npcReportedBase, npcTraitsProvider, npcStatsProvider;
  const char* AdoptNpcObservationChain(const FormDesc& base, const std::vector<FormDesc>& chain,
    uint32_t level, ChangeFormGuard::Mode mode, const FormDesc* race = nullptr);
  void RefreshNpcObservationContext();
  void RestoreNpcObservation();
  void ResetNpcObservation();
  uint32_t aetheriusPoisonDoseBonus = 0;
  std::optional<aetherius::development::Attributes> aetheriusDevAttributes; // AETHERIUS DEV-A1
  Networking::UserId aetheriusDevAttributesUser = Networking::InvalidUserId; // AETHERIUS DEV-A1
  std::optional<aetherius::attributes::Bonuses> aetheriusAttributeBonuses; // AETHERIUS C3d
  Networking::UserId aetheriusAttributeBonusesUser = Networking::InvalidUserId; // AETHERIUS C3d
  int32_t aetheriusAttributeBonusesProfile = 0; // AETHERIUS C3d
  uint64_t aetheriusDevAttributesRevision = 0; // AETHERIUS DEV-A1
  uint32_t aetheriusPoisonResult = 0;
  uint32_t aetheriusPoisonUnsupported = 0;
  bool aetheriusPoisonOwnerPublished = false; // AETHERIUS D-P1: one correction until host poison changes
  std::shared_ptr<Impl> pImpl;
  bool factionsLoaded = false;

  void SendAndSetDeathState(bool isDead, bool shouldTeleport);

  DeathStateContainerMessage GetDeathStateMsg(const LocationalData& position,
                                              bool isDead,
                                              bool shouldTeleport);

  void EatItem(uint32_t baseId, espm::Type t);

  bool ReadBook(uint32_t baseId);

  void ModifyActorValuePercentage(espm::ActorValue av, float percentageDelta);

  void EnsureTemplateChainEvaluated(
    espm::Loader& loader,
    ChangeFormGuard::Mode mode = ChangeFormGuard::Mode::RequestSave);

  std::map<uint32_t, uint32_t> EvaluateDeathItem();
  void AddDeathItem();
  void LoadFactions();

protected:
  void BeforeDestroy() override;
  void Init(WorldState* parent, uint32_t formId, bool hasChangeForm) override;
};
