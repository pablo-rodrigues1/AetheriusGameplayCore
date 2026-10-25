#pragma once
// AETHERIUS DS-0b: development-only combat probe.
//
// Enabled only by `aetheriusCombat.probe: true` in server-settings.json. When it
// is absent or false nothing is installed, every hook below is a null check, and
// mp.getAetheriusCombatProbe is not registered. The probe never changes a value
// used by the game: it only copies what the host already accepted.
//
// Recording uses five fixed std::array ring buffers, a fixed animation-name
// table and a fixed per-actor table of the last two animation events. Recording
// performs no allocation, no logging and no I/O. JSON/string allocation happens
// only in Read()/ReadString(), which the gamemode calls on request outside the
// hit. All methods run on the host's server thread; there is no concurrent
// reader support. This file is NOT part of integrations/host (local only).
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include "MpActor.h"
#include "WorldState.h"
#include "PluginIndexMapping.h"
#include <cstdint>
#include <cstring>
#include "Equipment.h"
#include "libespm/CombineBrowser.h"
#include "libespm/CompressedFieldsCache.h"
#include "libespm/espm.h"
#include <memory>
#include <nlohmann/json.hpp>
#include <string>
#include <string_view>

namespace aetherius::combat {

class CombatProbe
{
public:
  static constexpr size_t kHitCapacity = 1024;
  static constexpr size_t kAnimationCapacity = 4096;
  static constexpr size_t kHealthCapacity = 1024;
  static constexpr size_t kNameCapacity = 256;
  static constexpr size_t kNameBytes = 64; // includes the terminator
  static constexpr size_t kActorSlots = 1024;
  static constexpr size_t kEquipmentCapacity = 256;
  static constexpr size_t kEquipmentItems = 32; // entries kept per transition

  static constexpr size_t kRejectionCapacity = 1024;
  static constexpr size_t kTemplateCapacity = 16;

  struct Key
  {
    uint32_t local = 0;
    std::array<char, 260> file{};
    size_t length = 0;
    bool truncated = false;
    void Assign(const FormDesc& desc) noexcept
    {
      local = desc.shortFormId; length = std::min(desc.file.size(), file.size());
      std::memcpy(file.data(), desc.file.data(), length);
      truncated = length != desc.file.size();
    }
    bool operator==(const Key& other) const noexcept
    { return !truncated && !other.truncated && local == other.local && length == other.length && file == other.file; }
    nlohmann::json Json() const
    {
      if (truncated) return nullptr;
      return FormDesc(local, std::string(file.data(), length)).ToString();
    }
  };

  struct NpcCorrection
  {
    uint64_t timeMs = 0;
    uint32_t idx = 0, hoster = 0;
    std::array<float, 3> position{}, rotation{};
    Key cellOrWorld;
    std::array<char, 32> reason{};
  };

  // Runtime IDs are evidence only. Portable keys are copied without strings.
  struct ActorState
  {
    uint32_t actor = 0, base = 0, hoster = 0;
    Key cellOrWorld;
    std::array<float, 3> position{};
    uint64_t lastMovementMs = 0, maximumObservedMs = 0;
    float maximumHealth = 0;
    bool observationNeeded = false, creatureConfirmed = false;
    uint16_t level = 0;
    uint64_t generation = 0;
    Key traitsProvider, statsProvider;
    bool present = false, movementMatches = false, maximumAvailable = false, maximumCurrent = false;
    float lastObservedMaximum = 0;
    uint64_t lastMovementAttemptMs = 0, rejectedMovements = 0;
    bool lastMovementAccepted = false;
    std::array<float, 3> lastAttemptPosition{};
    uint32_t lastAttemptCellOrWorld = 0;
    NpcCorrection lastNpcCorrection;
    std::array<Key, kTemplateCapacity> templates{};
    size_t templateCount = 0, templateTotal = 0;
  };

  enum class Family : uint8_t
  {
    Melee,
    Ranged,
    Unarmed,
    Magic
  };

  struct Name
  {
    std::array<char, kNameBytes> text{};
    uint8_t length = 0;

    std::string_view View() const noexcept { return { text.data(), length }; }
    // Returns true when the source did not fit and was truncated.
    bool Assign(std::string_view source) noexcept
    {
      const size_t n = std::min(source.size(), kNameBytes - 1);
      std::memcpy(text.data(), source.data(), n);
      text[n] = '\0';
      length = static_cast<uint8_t>(n);
      return n != source.size();
    }
  };

  struct Cadence {
    bool present = false, previousAttempt = false, previousAccepted = false, speedAvailable = false;
    float sinceAttemptMs = 0, sinceAcceptedMs = 0, weaponSpeed = 0, limitMs = 0;
  };
  struct NpcUnavailable {
    uint64_t sequence = 0, timeMs = 0, generation = 0;
    uint32_t actor = 0;
    Name reason, result;
  };
  struct NpcReport {
    uint64_t sequence = 0, timeMs = 0, generation = 0;
    uint32_t actor = 0, level = 0;
    Key base, race; Name reason;
    uint32_t version = 1, candidates = std::numeric_limits<uint32_t>::max();
  };
  struct NpcItem
  {
    Key key;
    uint32_t count = 0;
    uint8_t hand = 0;
  };
  struct NpcEquipment
  {
    uint64_t sequence = 0, timeMs = 0, generation = 0;
    uint32_t actor = 0, hoster = 0, numChanges = 0;
    Name phase;
    bool present = false;
    size_t equipmentTotal = 0, equipmentKept = 0, weaponsTotal = 0, weaponsKept = 0;
    std::array<NpcItem, kEquipmentItems> equipped{}, weapons{};
    std::array<Key, 4> spells{};
  };
  struct RejectionSample
  {
    uint64_t sequence = 0, timeMs = 0;
    uint32_t aggressor = 0, target = 0, source = 0, projectile = 0;
    Name reason;
    ActorState aggressorState{}, targetState{};
    Cadence cadence;
    uint64_t npcEquipmentSequence = 0;
    std::array<Name, 2> animations{};
    std::array<int64_t, 2> animationAges{{-1, -1}};
  };

  struct RecentAnimation
  {
    Name name;
    uint64_t timeMs = 0;
    bool present = false;
  };

  struct HitInput
  {
    uint32_t aggressor = 0, target = 0, source = 0, projectile = 0;
    Family family = Family::Melee;
    // Flags as used by the current damage chain (after host block inference).
    bool power = false, sneak = false, bash = false, blocked = false;
    // isHitBlocked exactly as sent by the client.
    bool clientBlocked = false;
    // healthCandidate: percentage computed by the host before NetSetPercentages;
    // healthAfter: effective value after NetSetPercentages and its hooks
    // (SkyDeath may change it).
    float damage = 0, healthBefore = 0, healthCandidate = 0, healthAfter = 0;
    float targetMaximumHealth = 0;
    // Native block state: IsBlockActive (blockStart/blockStop animation) and
    // the IsBlocking animation variable (movement packet).
    bool aggressorBlockActive = false, aggressorIsBlocking = false;
    bool targetBlockActive = false, targetIsBlocking = false;
    bool aggressorSneaking = false;
    ActorState aggressorState{}, targetState{};
    Cadence cadence;
  };

  struct HitSample
  {
    uint64_t sequence = 0, timeMs = 0;
    HitInput hit{};
    // [0] = most recent animation event of the aggressor, [1] = the one before.
    std::array<RecentAnimation, 2> aggressorAnimations{};
  };

  struct AnimationSample
  {
    uint64_t sequence = 0, timeMs = 0;
    uint32_t actor = 0;
    Name name;
  };

  struct HealthSample
  {
    uint64_t sequence = 0, timeMs = 0;
    uint32_t actor = 0;
    float before = 0, reported = 0, after = 0;
  };

  struct EquipmentItem
  {
    uint32_t baseId = 0, count = 0;
    uint8_t hand = 0; // 0 none, 1 right, 2 left
    bool hasHealth = false;
    float health = 0;
    uint32_t enchantmentId = 0, poisonId = 0, poisonCount = 0;
  };

  // One accepted equipment transition, copied into fixed storage.
  struct EquipmentSample
  {
    uint64_t sequence = 0, timeMs = 0;
    uint32_t actor = 0, numChanges = 0;
    uint32_t leftSpell = 0, rightSpell = 0, voiceSpell = 0, instantSpell = 0;
    uint32_t totalEntries = 0; // entries in the host equipment
    uint32_t keptEntries = 0;  // entries copied (at most kEquipmentItems)
    std::array<EquipmentItem, kEquipmentItems> items{};
  };

  struct NameCount
  {
    Name name;
    uint64_t count = 0;
  };

  template <class T, size_t N>
  struct Ring
  {
    std::array<T, N> items{};
    uint64_t total = 0;
    size_t size = 0, next = 0;

    T& Push() noexcept
    {
      T& slot = items[next];
      slot = T{};
      slot.sequence = ++total;
      next = (next + 1) % N;
      if (size < N) {
        ++size;
      }
      return slot;
    }
    // Oldest to newest.
    const T& At(size_t i) const noexcept
    {
      return items[(next + N - size + i) % N];
    }
    uint64_t Overwritten() const noexcept { return total - size; }
  };

  CombatProbe() = default;
  explicit CombatProbe(uint64_t startedAtMs_)
    : startedAtMs(startedAtMs_)
  {
  }

  void RecordAnimation(uint32_t actor, std::string_view name,
                       uint64_t nowMs) noexcept
  {
    auto& sample = animations.Push();
    sample.timeMs = nowMs;
    sample.actor = actor;
    if (sample.name.Assign(name)) {
      ++truncatedNames;
    }
    CountName(sample.name);
    auto& slot = ActorSlot(actor);
    slot.recent[1] = slot.recent[0];
    slot.recent[0].name = sample.name;
    slot.recent[0].timeMs = nowMs;
    slot.recent[0].present = true;
  }

  void RecordHit(const HitInput& input, uint64_t nowMs) noexcept
  {
    auto& sample = hits.Push();
    sample.timeMs = nowMs;
    sample.hit = input;
    if (const auto* slot = FindActor(input.aggressor)) {
      sample.aggressorAnimations = slot->recent;
    }
  }

  void RecordNpcReport(uint32_t actor, const FormDesc& base, uint32_t level,
    uint64_t generation, std::string_view reason, uint64_t nowMs, uint32_t version = 1,
    const FormDesc& race = {}, uint32_t candidates = std::numeric_limits<uint32_t>::max()) noexcept {
    size_t i = 0;
    for (; i < npcReasonCount; ++i) if (npcReasons[i].name.View() == reason) break;
    if (i < npcReasons.size()) {
      if (i == npcReasonCount) { npcReasons[i].name.Assign(reason); ++npcReasonCount; }
      ++npcReasons[i].count;
    } else ++npcReasonOverflow;
    if (version == 1 || version == 2) {
      const auto v = version - 1; ++npcVersionTotals[v];
      size_t j = 0;
      for (; j < npcVersionReasonCounts[v]; ++j) if (npcVersionReasons[v][j].name.View() == reason) break;
      if (j < npcVersionReasons[v].size()) {
        if (j == npcVersionReasonCounts[v]) { npcVersionReasons[v][j].name.Assign(reason); ++npcVersionReasonCounts[v]; }
        ++npcVersionReasons[v][j].count;
      } else ++npcVersionReasonOverflows[v];
    }
    auto& row = npcReports.Push(); row.timeMs = nowMs; row.actor = actor;
    row.version = version; row.race.Assign(race); row.candidates = candidates;
    row.base.Assign(base); row.level = level; row.generation = generation; row.reason.Assign(reason);
  }
  void RecordNpcUnavailable(uint32_t actor, uint64_t generation, std::string_view reason,
    std::string_view result, uint64_t nowMs) noexcept {
    auto count = [](auto& counts, size_t& used, uint64_t& overflow, std::string_view name) {
      size_t i = 0;
      for (; i < used; ++i) if (counts[i].name.View() == name) break;
      if (i == counts.size()) { ++overflow; return; }
      if (i == used) { counts[i].name.Assign(name); ++used; }
      ++counts[i].count;
    };
    count(npcUnavailableResults, npcUnavailableResultCount, npcUnavailableResultOverflow, result);
    if (result == "ACCEPTED")
      count(npcUnavailableReasons, npcUnavailableReasonCount, npcUnavailableReasonOverflow, reason);
    auto& row = npcUnavailable.Push(); row.actor = actor; row.generation = generation;
    row.timeMs = nowMs; row.reason.Assign(reason); row.result.Assign(result);
  }
  // Restoration is outside the hit and is counted separately from wire reports.
  void RecordNpcRestoreFailure(std::string_view reason) noexcept {
    ++npcRestoreFailures;
    size_t i = 0;
    for (; i < npcRestoreReasonCount; ++i) if (npcRestoreReasons[i].name.View() == reason) break;
    if (i < npcRestoreReasons.size()) {
      if (i == npcRestoreReasonCount) { npcRestoreReasons[i].name.Assign(reason); ++npcRestoreReasonCount; }
      ++npcRestoreReasons[i].count;
    } else ++npcRestoreReasonOverflow;
  }
  void RecordAttackAttempt(uint32_t actor, float speed, bool speedAvailable,
    float sinceAcceptedMs, bool previousAccepted, std::chrono::steady_clock::time_point now) noexcept {
    auto& slot = ActorSlot(actor); auto& c = slot.cadence;
    c = {}; c.present = true; c.previousAttempt = slot.hasAttempt;
    if (slot.hasAttempt) c.sinceAttemptMs = std::chrono::duration<float, std::milli>(now - slot.lastAttempt).count();
    c.previousAccepted = previousAccepted; c.sinceAcceptedMs = sinceAcceptedMs; c.speedAvailable = speedAvailable && std::isfinite(speed) && speed > 0;
    c.weaponSpeed = speed;
    if (c.speedAvailable) c.limitMs = 1000.f * ((1.1 * (1 / speed)) - (1.1 * (1 / speed) * (speed <= 0.75 ? 0.45 : 0.3)));
    slot.hasAttempt = true; slot.lastAttempt = now;
  }
  Cadence LatestCadence(uint32_t actor) const noexcept {
    const auto* slot = FindActor(actor); return slot ? slot->cadence : Cadence{};
  }
  static nlohmann::json CadenceJson(const Cadence& c) {
    if (!c.present) return nullptr;
    return {{"sincePreviousAttemptMs", c.previousAttempt ? nlohmann::json(c.sinceAttemptMs) : nlohmann::json(nullptr)},
      {"sincePreviousAcceptedMs", c.previousAccepted ? nlohmann::json(c.sinceAcceptedMs) : nlohmann::json(nullptr)},
      {"weaponSpeed", c.speedAvailable ? nlohmann::json(c.weaponSpeed) : nlohmann::json(nullptr)},
      {"limitMs", c.speedAvailable ? nlohmann::json(c.limitMs) : nlohmann::json(nullptr)}};
  }

  void RecordHealth(uint32_t actor, float before, float reported, float after,
                    uint64_t nowMs) noexcept
  {
    auto& sample = health.Push();
    sample.timeMs = nowMs;
    sample.actor = actor;
    sample.before = before;
    sample.reported = reported;
    sample.after = after;
  }

  // Equipment transition accepted by the host (OnUpdateEquipment). Copies at
  // most kEquipmentItems entries; the rest is counted, never dropped silently.
  void RecordEquipment(uint32_t actor, const Equipment& equipment,
                       uint64_t nowMs) noexcept
  {
    auto& sample = equipmentChanges.Push();
    sample.timeMs = nowMs;
    sample.actor = actor;
    sample.numChanges = equipment.numChanges;
    sample.leftSpell = equipment.leftSpell.value_or(0);
    sample.rightSpell = equipment.rightSpell.value_or(0);
    sample.voiceSpell = equipment.voiceSpell.value_or(0);
    sample.instantSpell = equipment.instantSpell.value_or(0);
    const auto& entries = equipment.inv.entries;
    sample.totalEntries = static_cast<uint32_t>(entries.size());
    const size_t kept = std::min(entries.size(), kEquipmentItems);
    sample.keptEntries = static_cast<uint32_t>(kept);
    if (kept < entries.size()) {
      truncatedEquipmentEntries += entries.size() - kept;
    }
    for (size_t i = 0; i < kept; ++i) {
      const auto& e = entries[i];
      auto& item = sample.items[i];
      item.baseId = e.baseId;
      item.count = e.count;
      const auto worn = e.GetWorn();
      item.hand = worn == Inventory::Worn::Right ? 1
        : worn == Inventory::Worn::Left          ? 2
                                                 : 0;
      item.hasHealth = e.health.has_value();
      item.health = e.health.value_or(0.f);
      item.enchantmentId = e.enchantmentId.value_or(0);
      item.poisonId = e.poisonId.value_or(0);
      item.poisonCount = e.poisonCount.value_or(0);
    }
  }

  void RecordMovementAttempt(const MpActor& actor, const std::array<float, 3>& position,
                             uint32_t cellOrWorld, bool accepted, uint64_t nowMs) noexcept
  {
    auto& entry = StateSlot(actor.GetFormId(), &actor);
    entry.lastMovementAttemptMs = nowMs; entry.lastMovementAccepted = accepted;
    entry.lastAttemptPosition = position; entry.lastAttemptCellOrWorld = cellOrWorld;
    if (!accepted) ++entry.rejectedMovements;
  }

  // DS-0i: only authorized NPC rejections, recorded on movement, never on hit.
  void RecordNpcMovementRejection(MpActor& actor, WorldState& world,
    std::string_view reason, bool sent, uint64_t nowMs) noexcept
  {
    if (reason == "DISTANCE") ++npcMovementDistance;
    else if (reason == "WORLD_OR_CELL") ++npcMovementWorldOrCell;
    else if (reason == "TELEPORT_FLAG") ++npcMovementTeleportFlag;
    if (!sent) { ++npcCorrectionsSuppressed; return; }
    ++npcCorrectionsSent;
    auto& c = StateSlot(actor.GetFormId(), &actor).lastNpcCorrection;
    c = {}; c.timeMs = nowMs; c.idx = actor.GetIdx();
    auto it = world.hosters.find(actor.GetFormId());
    if (it != world.hosters.end()) c.hoster = it->second;
    const auto& p = actor.GetPos(); const auto& r = actor.GetAngle();
    c.position = {p[0], p[1], p[2]}; c.rotation = {r[0], r[1], r[2]};
    c.cellOrWorld.Assign(actor.GetCellOrWorld());
    std::memcpy(c.reason.data(), reason.data(), std::min(reason.size(), c.reason.size() - 1));
  }

  // Called after an accepted movement, never to infer acceptance from hoster time.
  void RecordMovement(const MpActor& actor, WorldState& world, uint64_t nowMs) noexcept
  {
    auto& entry = StateSlot(actor.GetFormId(), &actor);
    entry.movement = CaptureCoordinates(actor, world);
    entry.movement.lastMovementMs = nowMs;
  }

  // Observe an EXISTING maximum calculation: no extra calculation on the hit.
  void RecordMaximum(const MpActor& actor, float maximum, uint64_t nowMs,
                     float unweakenedHealth, double weaknessUntil) noexcept
  {
    auto& entry = StateSlot(actor.GetFormId(), &actor);
    entry.maximumHealth = maximum;
    entry.maximumObservedMs = nowMs;
    entry.unweakenedHealth = unweakenedHealth; entry.weaknessUntil = weaknessUntil;
    entry.maximumState = CaptureState(&actor, *actor.GetParent());
    entry.maximumRevision = actor.GetCombatProbeMaximumRevision();
    entry.user = actor.GetUserId(); entry.profile = actor.GetProfileId();
    entry.appearance.Assign(actor.GetCombatProbeAppearanceDump());
    entry.weakness.Assign(actor.GetDynamicFields().GetValueDump(weaknessKey));
  }

  ActorState CaptureState(const MpObjectReference* ref, WorldState& world,
                          double observationTimeMs = -1.0) const noexcept
  {
    if (!ref) return {};
    auto result = CaptureCoordinates(*ref, world);
    const auto* actor = ref->AsActor();
    if (actor) {
      result.observationNeeded = actor->NeedsNpcObservation(); result.creatureConfirmed = actor->IsNpcConfirmed();
      result.level = actor->GetNpcLevel(); result.generation = actor->GetNpcGeneration();
      result.traitsProvider.Assign(actor->GetNpcTraitsProvider()); result.statsProvider.Assign(actor->GetNpcStatsProvider());
      const auto& chain = actor->GetTemplateChain();
      result.templateTotal = chain.size();
      result.templateCount = std::min(chain.size(), kTemplateCapacity);
      for (size_t i = 0; i < result.templateCount; ++i)
        result.templates[i].Assign(chain[i]);
    }
    const auto& entry = states[Hash(result.actor)];
    if (entry.identity == ref && entry.actor == result.actor) {
      result.lastMovementMs = entry.movement.lastMovementMs;
      result.lastMovementAttemptMs = entry.lastMovementAttemptMs; result.lastMovementAccepted = entry.lastMovementAccepted;
      result.lastAttemptPosition = entry.lastAttemptPosition; result.lastAttemptCellOrWorld = entry.lastAttemptCellOrWorld;
      result.rejectedMovements = entry.rejectedMovements;
      result.lastNpcCorrection = entry.lastNpcCorrection;
      result.movementMatches = result.lastMovementMs &&
        entry.movement.position == result.position && entry.movement.cellOrWorld == result.cellOrWorld;
      result.maximumObservedMs = entry.maximumObservedMs;
      result.lastObservedMaximum = entry.maximumHealth;
      // Same immutable records and byte-identical input context: no record/JSON
      // parsing here. Expiry is evaluated at the same clock precision as the host.
      const bool sameTemplates = result.templateTotal <= kTemplateCapacity &&
        entry.maximumState.templateTotal == result.templateTotal && entry.maximumState.templates == result.templates;
      result.maximumCurrent = actor && entry.maximumObservedMs && sameTemplates &&
        entry.maximumState.base == result.base && entry.maximumRevision == actor->GetCombatProbeMaximumRevision() &&
        entry.user == actor->GetUserId() && entry.profile == actor->GetProfileId() &&
        entry.appearance.Matches(actor->GetCombatProbeAppearanceDump()) &&
        entry.weakness.Matches(actor->GetDynamicFields().GetValueDump(weaknessKey));
      if (result.maximumCurrent) {
        const double now = observationTimeMs >= 0 ? observationTimeMs : std::chrono::duration<double, std::milli>(
          std::chrono::system_clock::now().time_since_epoch()).count();
        result.maximumHealth = entry.unweakenedHealth * (entry.weaknessUntil > now ? 0.5f : 1.f);
        result.maximumAvailable = std::isfinite(result.maximumHealth);
      }
    }
    return result;
  }

  // DS-0k: fixed copies only. GetEquipment/GetInventory return existing host
  // changeform references; type lookup reads the already-loaded ESPM index.
  static Key ItemKey(uint32_t id, const PluginIndexMapping& mapping) noexcept
  {
    Key key;
    const auto index = mapping.GetEspmFileIndex(id);
    const auto& plugins = mapping.GetPlugins();
    if (!id || index >= plugins.size()) return key;
    const auto& plugin = plugins[index];
    key.local = id & (plugin.isLight ? 0xfff : 0xffffff);
    key.length = std::min(plugin.fileName.size(), key.file.size());
    std::memcpy(key.file.data(), plugin.fileName.data(), key.length);
    key.truncated = key.length != plugin.fileName.size();
    return key;
  }

  static NpcEquipment CaptureNpcEquipment(const MpActor& actor, std::string_view phase, uint64_t nowMs) noexcept
  {
    NpcEquipment sample;
    if (actor.GetUserId() != Networking::InvalidUserId || !actor.GetParent()) return sample;
    auto& world = *actor.GetParent();
    sample.present = true; sample.actor = actor.GetFormId();
    sample.timeMs = nowMs; sample.generation = actor.GetNpcGeneration(); sample.phase.Assign(phase);
    const auto it = world.hosters.find(sample.actor);
    if (it != world.hosters.end()) sample.hoster = it->second;
    const auto& eq = actor.GetEquipment(); sample.numChanges = eq.numChanges;
    const auto& mapping = world.pluginIndexMapping;
    auto copy = [&](NpcItem& item, const Inventory::Entry& entry) {
      item.key = ItemKey(entry.baseId, mapping); item.count = entry.count;
      const auto hand = entry.GetWorn();
      item.hand = hand == Inventory::Worn::Right ? 1 : hand == Inventory::Worn::Left ? 2 : 0;
    };
    sample.equipmentTotal = eq.inv.entries.size();
    sample.equipmentKept = std::min(sample.equipmentTotal, kEquipmentItems);
    for (size_t i = 0; i < sample.equipmentKept; ++i) copy(sample.equipped[i], eq.inv.entries[i]);
    const std::array<uint32_t, 4> spells{eq.leftSpell.value_or(0), eq.rightSpell.value_or(0), eq.voiceSpell.value_or(0), eq.instantSpell.value_or(0)};
    for (size_t i = 0; i < spells.size(); ++i) sample.spells[i] = ItemKey(spells[i], mapping);
    if (world.HasEspm()) for (const auto& entry : actor.GetInventory().entries) {
      const auto record = world.GetEspm().GetBrowser().LookupById(entry.baseId);
      if (!record.rec || record.rec->GetType() != espm::WEAP::kType) continue;
      ++sample.weaponsTotal;
      if (sample.weaponsKept < kEquipmentItems) copy(sample.weapons[sample.weaponsKept++], entry);
    }
    return sample;
  }

  uint64_t RecordNpcEquipment(const MpActor& actor, std::string_view phase, uint64_t nowMs) noexcept
  {
    const auto captured = CaptureNpcEquipment(actor, phase, nowMs);
    if (!captured.present) return 0;
    auto& sample = npcEquipment.Push();
    const auto sequence = sample.sequence; sample = captured; sample.sequence = sequence;
    return sequence;
  }

  static nlohmann::json NpcEquipmentJson(const NpcEquipment& sample)
  {
    if (!sample.present) return nullptr;
    auto items = [](const auto& source, size_t size) {
      auto rows = nlohmann::json::array();
      for (size_t i = 0; i < size; ++i) rows.push_back({{"key", source[i].key.length ? source[i].key.Json() : nlohmann::json(nullptr)},
        {"count", source[i].count}, {"hand", source[i].hand == 1 ? "RIGHT" : source[i].hand == 2 ? "LEFT" : "NONE"}});
      return rows;
    };
    auto spells = nlohmann::json::array();
    for (const auto& key : sample.spells) spells.push_back(key.length ? key.Json() : nlohmann::json(nullptr));
    return {{"sequence", sample.sequence}, {"timeMs", sample.timeMs}, {"actor", sample.actor},
      {"generation", sample.generation}, {"hoster", sample.hoster ? nlohmann::json(sample.hoster) : nlohmann::json(nullptr)},
      {"phase", sample.phase.View()}, {"numChanges", sample.numChanges}, {"spells", spells},
      {"equipment", items(sample.equipped, sample.equipmentKept)}, {"inventoryWeapons", items(sample.weapons, sample.weaponsKept)},
      {"equipmentOmitted", sample.equipmentTotal - sample.equipmentKept}, {"inventoryWeaponsOmitted", sample.weaponsTotal - sample.weaponsKept}};
  }

  void RecordRejection(std::string_view reason, uint32_t aggressor, uint32_t target,
                       uint32_t source, uint32_t projectile, const ActorState& a,
                       const ActorState& t, uint64_t nowMs, const MpActor* equipmentActor = nullptr) noexcept
  {
    auto& sample = rejections.Push();
    sample.timeMs = nowMs; sample.reason.Assign(reason);
    sample.aggressor = aggressor; sample.target = target;
    sample.source = source; sample.projectile = projectile;
    sample.aggressorState = a; sample.targetState = t;
    if (equipmentActor) sample.npcEquipmentSequence = RecordNpcEquipment(*equipmentActor, reason, nowMs);
    if (reason == "ATTACK_COOLDOWN" || reason.substr(0, 7) == "SPLASH_") {
      sample.cadence = LatestCadence(aggressor);
      if (const auto* slot = FindActor(aggressor)) for (size_t i = 0; i < 2; ++i) {
        sample.animations[i] = slot->recent[i].name;
        if (slot->recent[i].present) sample.animationAges[i] = static_cast<int64_t>(nowMs) - slot->recent[i].timeMs;
      }
    }
  }

  static nlohmann::json StateJson(const ActorState& s)
  {
    if (!s.present) return nullptr;
    auto chain = nlohmann::json::array();
    for (size_t i = 0; i < s.templateCount; ++i) chain.push_back(s.templates[i].Json());
    return { { "actor", s.actor }, { "base", s.base }, { "position", s.position },
             { "cellOrWorld", s.cellOrWorld.Json() }, { "cellKeyTruncated", s.cellOrWorld.truncated }, { "hoster", s.hoster ? nlohmann::json(s.hoster) : nlohmann::json(nullptr) },
             { "lastMovementMs", s.lastMovementMs ? nlohmann::json(s.lastMovementMs) : nlohmann::json(nullptr) },
             { "movementMatches", s.movementMatches },
             { "lastMovementAttemptMs", s.lastMovementAttemptMs ? nlohmann::json(s.lastMovementAttemptMs) : nlohmann::json(nullptr) },
             { "lastMovementAccepted", s.lastMovementAttemptMs ? nlohmann::json(s.lastMovementAccepted) : nlohmann::json(nullptr) },
             { "lastAttemptPosition", s.lastAttemptPosition }, { "lastAttemptCellOrWorld", s.lastAttemptCellOrWorld },
             { "rejectedMovements", s.rejectedMovements },
             { "lastNpcCorrection", s.lastNpcCorrection.timeMs ? nlohmann::json{
               {"timeMs", s.lastNpcCorrection.timeMs}, {"idx", s.lastNpcCorrection.idx},
               {"hoster", s.lastNpcCorrection.hoster}, {"position", s.lastNpcCorrection.position},
               {"rotation", s.lastNpcCorrection.rotation}, {"cellOrWorld", s.lastNpcCorrection.cellOrWorld.Json()},
               {"reason", s.lastNpcCorrection.reason.data()}} : nlohmann::json(nullptr) },
             { "maximumHealth", s.maximumAvailable ? nlohmann::json(s.maximumHealth) : nlohmann::json(nullptr) },
             { "maximumObservedMs", s.maximumObservedMs ? nlohmann::json(s.maximumObservedMs) : nlohmann::json(nullptr) },
             { "lastObservedMaximum", s.maximumObservedMs ? nlohmann::json(s.lastObservedMaximum) : nlohmann::json(nullptr) },
             { "maximumStatus", s.maximumAvailable && s.maximumCurrent ? "CACHED_INPUTS_CURRENT" : "UNAVAILABLE" },
             { "observationNeeded", s.observationNeeded }, { "creatureConfirmed", s.creatureConfirmed },
              { "level", s.level ? nlohmann::json(s.level) : nlohmann::json(nullptr) }, { "generation", s.generation },
              { "traitsProvider", s.traitsProvider.length ? s.traitsProvider.Json() : nlohmann::json(nullptr) },
              { "statsProvider", s.statsProvider.length ? s.statsProvider.Json() : nlohmann::json(nullptr) },
              { "templateChain", chain }, { "truncatedTemplates", s.templateTotal - s.templateCount } };
  }

  // Non-destructive snapshot. Allocation is confined to this requested read.
  nlohmann::json Read() const
  {
    auto hitRows = nlohmann::json::array();
    for (size_t i = 0; i < hits.size; ++i) {
      const auto& s = hits.At(i);
      auto recent = nlohmann::json::array();
      for (const auto& a : s.aggressorAnimations) {
        if (!a.present) {
          continue;
        }
        recent.push_back(
          { { "name", std::string(a.name.View()) },
            { "ageMs",
              static_cast<int64_t>(s.timeMs) - static_cast<int64_t>(a.timeMs) } });
      }
      const auto& h = s.hit;
      hitRows.push_back(
        { { "sequence", s.sequence },
          { "timeMs", s.timeMs },
          { "aggressor", h.aggressor },
          { "target", h.target },
          { "source", h.source },
          { "projectile", h.projectile },
          { "family", FamilyName(h.family) },
          { "power", h.power },
          { "sneak", h.sneak },
          { "bash", h.bash },
          { "blocked", h.blocked },
          { "clientBlocked", h.clientBlocked },
          { "damage", h.damage },
           { "targetMaximumHealth", h.targetMaximumHealth }, { "cadence", CadenceJson(h.cadence) },
          { "healthBefore", h.healthBefore },
          { "healthCandidate", h.healthCandidate },
          { "healthAfter", h.healthAfter },
          { "aggressorBlockActive", h.aggressorBlockActive },
          { "aggressorIsBlocking", h.aggressorIsBlocking },
          { "targetBlockActive", h.targetBlockActive },
          { "targetIsBlocking", h.targetIsBlocking },
          { "aggressorSneaking", h.aggressorSneaking },
          // The host keeps no detection state of the target (DS-0b audit).
          { "detection", "UNAVAILABLE" },
          { "aggressorState", StateJson(h.aggressorState) },
           { "targetState", StateJson(h.targetState) },
           { "aggressorAnimations", std::move(recent) } });
    }
    auto rejectionRows = nlohmann::json::array();
    for (size_t i = 0; i < rejections.size; ++i) {
      const auto& s = rejections.At(i);
      double squared = 0;
      for (size_t k = 0; k < 3; ++k) {
        const double d = double(s.aggressorState.position[k]) - s.targetState.position[k];
        squared += d * d;
      }
      auto recent = nlohmann::json::array();
      for (size_t k = 0; k < 2; ++k) if (s.animationAges[k] >= 0)
        recent.push_back({{"name", std::string(s.animations[k].View())}, {"ageMs", s.animationAges[k]}});
      rejectionRows.push_back({ { "sequence", s.sequence }, { "timeMs", s.timeMs },
        { "reason", std::string(s.reason.View()) }, { "cadence", CadenceJson(s.cadence) },
         { "npcEquipmentSequence", s.npcEquipmentSequence ? nlohmann::json(s.npcEquipmentSequence) : nlohmann::json(nullptr) },
         { "aggressorAnimations", recent }, { "aggressor", s.aggressor },
        { "target", s.target }, { "source", s.source }, { "projectile", s.projectile },
        { "aggressorState", StateJson(s.aggressorState) }, { "targetState", StateJson(s.targetState) },
        { "distance", s.aggressorState.present && s.targetState.present ? nlohmann::json(std::sqrt(squared)) : nlohmann::json(nullptr) } });
    }
    auto animationRows = nlohmann::json::array();
    for (size_t i = 0; i < animations.size; ++i) {
      const auto& s = animations.At(i);
      animationRows.push_back({ { "sequence", s.sequence },
                                { "timeMs", s.timeMs },
                                { "actor", s.actor },
                                { "name", std::string(s.name.View()) } });
    }
    auto healthRows = nlohmann::json::array();
    for (size_t i = 0; i < health.size; ++i) {
      const auto& s = health.At(i);
      healthRows.push_back({ { "sequence", s.sequence },
                             { "timeMs", s.timeMs },
                             { "actor", s.actor },
                             { "before", s.before },
                             { "reported", s.reported },
                             { "after", s.after } });
    }
    auto equipmentRows = nlohmann::json::array();
    for (size_t i = 0; i < equipmentChanges.size; ++i) {
      const auto& s = equipmentChanges.At(i);
      auto items = nlohmann::json::array();
      for (size_t k = 0; k < s.keptEntries; ++k) {
        const auto& item = s.items[k];
        items.push_back(
          { { "baseId", item.baseId },
            { "count", item.count },
            { "wornSlot", item.hand == 1 ? "RIGHT" : item.hand == 2 ? "LEFT" : "NONE" },
             { "worn", item.hand != 0 },
            { "health", item.hasHealth ? nlohmann::json(item.health) : nlohmann::json(nullptr) },
            { "enchantmentId", item.enchantmentId ? nlohmann::json(item.enchantmentId) : nlohmann::json(nullptr) },
            { "poisonId", item.poisonId ? nlohmann::json(item.poisonId) : nlohmann::json(nullptr) },
            { "poisonCount", item.poisonId ? nlohmann::json(item.poisonCount) : nlohmann::json(nullptr) } });
      }
      equipmentRows.push_back({ { "sequence", s.sequence },
                                { "timeMs", s.timeMs },
                                { "actor", s.actor },
                                { "numChanges", s.numChanges },
                                { "leftSpell", s.leftSpell },
                                { "rightSpell", s.rightSpell },
                                { "voiceSpell", s.voiceSpell },
                                { "instantSpell", s.instantSpell },
                                { "totalEntries", s.totalEntries },
                                { "items", std::move(items) } });
    }
    auto nameRows = nlohmann::json::array();
    for (size_t i = 0; i < namesUsed; ++i) {
      nameRows.push_back({ { "name", std::string(names[i].name.View()) },
                           { "count", names[i].count } });
    }
    auto reportRows = nlohmann::json::array();
    auto reasons = nlohmann::json::object();
    for (size_t i = 0; i < npcReasonCount; ++i) reasons[std::string(npcReasons[i].name.View())] = npcReasons[i].count;
    for (size_t i = 0; i < npcReports.size; ++i) {
      const auto& r = npcReports.At(i);
      const auto reason = std::string(r.reason.View());
      reportRows.push_back({{"sequence", r.sequence}, {"timeMs", r.timeMs}, {"actor", r.actor},
        {"v", r.version}, {"race", r.race.Json()},
        {"candidates", r.candidates == std::numeric_limits<uint32_t>::max() ? nlohmann::json(nullptr) : nlohmann::json(r.candidates)},
        {"base", r.base.Json()}, {"level", r.level}, {"generation", r.generation}, {"reason", reason},
        {"accepted", reason == "ACCEPTED" || reason == "DUPLICATE"}});
    }
    auto versions = nlohmann::json::object();
    for (size_t v = 0; v < 2; ++v) {
      auto counts = nlohmann::json::object();
      for (size_t j = 0; j < npcVersionReasonCounts[v]; ++j)
        counts[std::string(npcVersionReasons[v][j].name.View())] = npcVersionReasons[v][j].count;
      versions[v == 0 ? "v1" : "v2"] = {{"received", npcVersionTotals[v]}, {"reasons", counts}, {"reasonOverflow", npcVersionReasonOverflows[v]}};
    }
    auto restoreReasons = nlohmann::json::object();
    for (size_t i = 0; i < npcRestoreReasonCount; ++i)
      restoreReasons[std::string(npcRestoreReasons[i].name.View())] = npcRestoreReasons[i].count;
    auto unavailableRows = nlohmann::json::array();
    for (size_t i = 0; i < npcUnavailable.size; ++i) {
      const auto& r = npcUnavailable.At(i);
      unavailableRows.push_back({{"sequence", r.sequence}, {"timeMs", r.timeMs}, {"actor", r.actor},
        {"generation", r.generation}, {"reason", r.reason.View()}, {"result", r.result.View()},
        {"accepted", r.result.View() == "ACCEPTED"}});
    }
    auto unavailableReasons = nlohmann::json::object(), unavailableResults = nlohmann::json::object();
    for (size_t i = 0; i < npcUnavailableReasonCount; ++i)
      unavailableReasons[std::string(npcUnavailableReasons[i].name.View())] = npcUnavailableReasons[i].count;
    for (size_t i = 0; i < npcUnavailableResultCount; ++i)
      unavailableResults[std::string(npcUnavailableResults[i].name.View())] = npcUnavailableResults[i].count;
    auto npcEquipmentRows = nlohmann::json::array();
    for (size_t i = 0; i < npcEquipment.size; ++i) npcEquipmentRows.push_back(NpcEquipmentJson(npcEquipment.At(i)));
    return {
      { "npcUnavailable", unavailableRows },
      { "npcReports", reportRows },
      { "probe", "AETHERIUS_DEV_COMBAT_PROBE" },
      { "version", 3 },
      { "startedAtMs", startedAtMs },
      { "capacity",
        { { "hits", kHitCapacity },
          { "rejections", kRejectionCapacity }, { "npcReports", 256 }, { "npcUnavailable", 256 },
          { "animations", kAnimationCapacity },
          { "health", kHealthCapacity },
          { "names", kNameCapacity },
          { "nameBytes", kNameBytes - 1 },
          { "actors", kActorSlots },
          { "equipment", kEquipmentCapacity },
          { "equipmentItems", kEquipmentItems } } },
      { "counters",
        { { "hits", hits.total },
          // Existing recorder preserves counters verbatim; no runtime/src change.
          { "npcEquipment", {{"total", npcEquipment.total}, {"overwritten", npcEquipment.Overwritten()}, {"samples", npcEquipmentRows}} },
          { "npcMovementRejections", {{"DISTANCE", npcMovementDistance}, {"WORLD_OR_CELL", npcMovementWorldOrCell}, {"TELEPORT_FLAG", npcMovementTeleportFlag}} },
          { "npcCorrectionsSent", npcCorrectionsSent }, { "npcCorrectionsSuppressed", npcCorrectionsSuppressed },
          { "rejections", rejections.total }, { "npcReports", npcReports.total }, { "overwrittenNpcReports", npcReports.Overwritten() }, { "npcReportReasons", reasons }, { "npcReportVersions", versions }, { "npcReasonOverflow", npcReasonOverflow },
          { "npcRestoreFailures", npcRestoreFailures }, { "npcRestoreFailureReasons", restoreReasons },
          { "npcRestoreReasonOverflow", npcRestoreReasonOverflow },
          { "npcUnavailable", npcUnavailable.total }, { "overwrittenNpcUnavailable", npcUnavailable.Overwritten() },
          { "npcUnavailableReasons", unavailableReasons }, { "npcUnavailableResults", unavailableResults },
          { "npcUnavailableReasonOverflow", npcUnavailableReasonOverflow }, { "npcUnavailableResultOverflow", npcUnavailableResultOverflow },
          { "overwrittenRejections", rejections.Overwritten() },
          { "stateEvictions", stateEvictions },
          { "animations", animations.total },
          { "health", health.total },
          { "overwrittenHits", hits.Overwritten() },
          { "overwrittenAnimations", animations.Overwritten() },
          { "overwrittenHealth", health.Overwritten() },
          { "distinctNames", namesUsed },
          { "nameOverflow", nameOverflow },
          { "truncatedNames", truncatedNames },
          { "actorEvictions", actorEvictions },
          { "equipment", equipmentChanges.total },
          { "overwrittenEquipment", equipmentChanges.Overwritten() },
          { "truncatedEquipmentEntries", truncatedEquipmentEntries } } },
      { "hits", std::move(hitRows) },
      { "rejections", std::move(rejectionRows) },
      { "animations", std::move(animationRows) },
      { "health", std::move(healthRows) },
      { "equipment", std::move(equipmentRows) },
      { "animationNames", std::move(nameRows) }
    };
  }

  // Client-supplied animation names may be invalid UTF-8; never throw on dump.
  std::string ReadString() const
  {
    return Read().dump(-1, ' ', false,
                       nlohmann::json::error_handler_t::replace);
  }

  static nlohmann::json ResolveRecordType(const espm::CombineBrowser& browser, uint32_t id)
  {
    const auto record = browser.LookupById(id);
    return record.rec ? nlohmann::json{{ "status", "SUPPORTED" }, { "type", record.rec->GetType().ToString() }}
      : nlohmann::json{{ "status", "UNSUPPORTED" }, { "reason", "RECORD_ABSENT" }};
  }

  // Read-only enchantment resolution from the host's load-order winners, for
  // the on-request read only (never on the hit). The ID being present is not
  // support: SUPPORTED only when the ENCH and every MGEF resolve.
  static nlohmann::json ResolveEnchantment(const espm::CombineBrowser& browser,
                                           espm::CompressedFieldsCache& cache,
                                           uint32_t id)
  {
    auto unsupported = [id](const char* reason) {
      return nlohmann::json{ { "enchantmentId", id },
                             { "status", "UNSUPPORTED" },
                             { "reason", reason } };
    };
    if (id == 0) {
      return unsupported("NO_ENCHANTMENT_ID");
    }
    if (id >= 0xFF000000) {
      // Player-created enchantments live outside the load order; the host
      // keeps no record for them that this read could use.
      return unsupported("CREATED_RECORD_NOT_IN_LOAD_ORDER");
    }
    const auto record = browser.LookupById(id);
    if (!record.rec) {
      return unsupported("RECORD_ABSENT");
    }
    const auto* ench = espm::Convert<espm::ENCH>(record.rec);
    if (!ench) {
      return unsupported("NOT_AN_ENCH_RECORD");
    }
    const auto data = ench->GetData(cache);
    if (data.effects.empty()) {
      return unsupported("ENCH_WITHOUT_EFFECTS");
    }
    auto effects = nlohmann::json::array();
    for (const auto& effect : data.effects) {
      const uint32_t effectId = record.ToGlobalId(effect.effectId);
      const auto effectRecord = browser.LookupById(effectId);
      const auto* mgef =
        effectRecord.rec ? espm::Convert<espm::MGEF>(effectRecord.rec) : nullptr;
      if (!mgef) {
        auto result = unsupported("MGEF_UNRESOLVED");
        result["mgef"] = effectId;
        return result;
      }
      const auto info = mgef->GetData(cache).data;
      effects.push_back(
        { { "mgef", effectId },
          { "magnitude", effect.magnitude },
          { "areaOfEffect", effect.areaOfEffect },
          { "duration", effect.duration },
          { "actorValue", static_cast<int32_t>(info.primaryAV) },
          { "archetype", static_cast<uint32_t>(info.effectType) } });
    }
    return { { "enchantmentId", id },
             { "status", "SUPPORTED" },
             { "effects", std::move(effects) } };
  }

  static const char* FamilyName(Family family) noexcept
  {
    switch (family) {
      case Family::Melee:
        return "MELEE";
      case Family::Ranged:
        return "RANGED";
      case Family::Unarmed:
        return "UNARMED";
      case Family::Magic:
        return "MAGIC";
    }
    return "UNKNOWN";
  }

  // Read-only accessors for tests and diagnostics.
  const Ring<HitSample, kHitCapacity>& Hits() const noexcept { return hits; }
  const Ring<AnimationSample, kAnimationCapacity>& Animations() const noexcept
  {
    return animations;
  }
  const Ring<HealthSample, kHealthCapacity>& Health() const noexcept
  {
    return health;
  }
  const Ring<EquipmentSample, kEquipmentCapacity>& EquipmentChanges() const noexcept
  {
    return equipmentChanges;
  }
  size_t DistinctNames() const noexcept { return namesUsed; }
  uint64_t NameOverflow() const noexcept { return nameOverflow; }
  uint64_t ActorEvictions() const noexcept { return actorEvictions; }

private:
  template<size_t N> struct Text
  {
    std::array<char, N> bytes{};
    size_t size = 0;
    bool complete = false;
    void Assign(std::string_view value) noexcept
    {
      complete = value.size() <= N; size = std::min(value.size(), N);
      std::memcpy(bytes.data(), value.data(), size);
    }
    bool Matches(std::string_view value) const noexcept
    { return complete && size == value.size() && std::memcmp(bytes.data(), value.data(), size) == 0; }
  };
  // Created once with the probe; avoids the implicit temporary std::string in
  // GetValueDump("skyDeathAidWeakness") on the recording path.
  const std::string weaknessKey = "skyDeathAidWeakness";
  struct StateEntry
  {
    uint32_t actor = 0;
    const MpObjectReference* identity = nullptr; // identity only; never dereferenced
    ActorState movement{}, maximumState{};
    NpcCorrection lastNpcCorrection;
    Text<4096> appearance;
    Text<1024> weakness;
    uint64_t maximumRevision = 0;
    Networking::UserId user = Networking::InvalidUserId;
    int32_t profile = 0;
    double weaknessUntil = 0;
    float unweakenedHealth = 0;
    float maximumHealth = 0;
    uint64_t maximumObservedMs = 0;
    uint64_t lastMovementAttemptMs = 0, rejectedMovements = 0;
    bool lastMovementAccepted = false;
    std::array<float, 3> lastAttemptPosition{};
    uint32_t lastAttemptCellOrWorld = 0;
  };
  StateEntry& StateSlot(uint32_t actor, const MpObjectReference* identity) noexcept
  {
    auto& entry = states[Hash(actor)];
    if (entry.actor != actor || entry.identity != identity) {
      if (entry.identity) ++stateEvictions;
      entry = {}; entry.actor = actor; entry.identity = identity;
    }
    return entry;
  }
  static ActorState CaptureCoordinates(const MpObjectReference& ref, WorldState& world) noexcept
  {
    ActorState s;
    s.present = true; s.actor = ref.GetFormId(); s.base = ref.GetBaseId();
    const auto& p = ref.GetPos(); s.position = { p[0], p[1], p[2] };
    s.cellOrWorld.Assign(ref.GetCellOrWorld());
    const auto it = world.hosters.find(s.actor);
    if (it != world.hosters.end()) s.hoster = it->second;
    return s;
  }
  std::array<StateEntry, kActorSlots> states{};
  uint64_t stateEvictions = 0;
  uint64_t npcMovementDistance = 0, npcMovementWorldOrCell = 0, npcMovementTeleportFlag = 0;
  uint64_t npcCorrectionsSent = 0, npcCorrectionsSuppressed = 0;
  struct ActorEntry
  {
    uint32_t actor = 0;
    bool used = false;
    std::array<RecentAnimation, 2> recent{};
    Cadence cadence;
    bool hasAttempt = false;
    std::chrono::steady_clock::time_point lastAttempt{};
  };

  static size_t Hash(uint32_t actor) noexcept
  {
    return static_cast<size_t>((static_cast<uint64_t>(actor) * 2654435761ull) %
                               kActorSlots);
  }

  const ActorEntry* FindActor(uint32_t actor) const noexcept
  {
    const size_t start = Hash(actor);
    for (size_t i = 0; i < kActorSlots; ++i) {
      const auto& entry = actors[(start + i) % kActorSlots];
      if (!entry.used) {
        return nullptr;
      }
      if (entry.actor == actor) {
        return &entry;
      }
    }
    return nullptr;
  }

  ActorEntry& ActorSlot(uint32_t actor) noexcept
  {
    const size_t start = Hash(actor);
    for (size_t i = 0; i < kActorSlots; ++i) {
      auto& entry = actors[(start + i) % kActorSlots];
      if (!entry.used) {
        entry.used = true;
        entry.actor = actor;
        entry.recent = {};
        return entry;
      }
      if (entry.actor == actor) {
        return entry;
      }
    }
    // Full table: replace the home slot. Probing stays correct because no
    // slot ever becomes unused again.
    ++actorEvictions;
    auto& entry = actors[start];
    entry = {}; entry.used = true; entry.actor = actor;
    return entry;
  }

  void CountName(const Name& name) noexcept
  {
    const auto view = name.View();
    for (size_t i = 0; i < namesUsed; ++i) {
      if (names[i].name.View() == view) {
        ++names[i].count;
        return;
      }
    }
    if (namesUsed < kNameCapacity) {
      names[namesUsed].name = name;
      names[namesUsed].count = 1;
      ++namesUsed;
      return;
    }
    ++nameOverflow;
  }

  uint64_t startedAtMs = 0;
  Ring<HitSample, kHitCapacity> hits;
  Ring<RejectionSample, kRejectionCapacity> rejections;
  Ring<NpcEquipment, 64> npcEquipment;
  Ring<NpcUnavailable, 256> npcUnavailable;
  std::array<NameCount, 32> npcUnavailableReasons{}, npcUnavailableResults{};
  size_t npcUnavailableReasonCount = 0, npcUnavailableResultCount = 0;
  uint64_t npcUnavailableReasonOverflow = 0, npcUnavailableResultOverflow = 0;
  Ring<NpcReport, 256> npcReports;
  std::array<std::array<NameCount, 32>, 2> npcVersionReasons{};
  std::array<size_t, 2> npcVersionReasonCounts{};
  std::array<uint64_t, 2> npcVersionTotals{}, npcVersionReasonOverflows{};
  std::array<NameCount, 32> npcReasons{};
  size_t npcReasonCount = 0;
  uint64_t npcReasonOverflow = 0;
  std::array<NameCount, 32> npcRestoreReasons{};
  size_t npcRestoreReasonCount = 0;
  uint64_t npcRestoreFailures = 0, npcRestoreReasonOverflow = 0;
  Ring<AnimationSample, kAnimationCapacity> animations;
  Ring<HealthSample, kHealthCapacity> health;
  Ring<EquipmentSample, kEquipmentCapacity> equipmentChanges;
  uint64_t truncatedEquipmentEntries = 0;
  std::array<NameCount, kNameCapacity> names{};
  size_t namesUsed = 0;
  uint64_t nameOverflow = 0, truncatedNames = 0, actorEvictions = 0;
  std::array<ActorEntry, kActorSlots> actors{};
};

// Process-wide installation point. ScampServer installs the probe only when
// aetheriusCombat.probe is true; otherwise it stays null and every hook in
// ActionListener is a single null check.
inline std::shared_ptr<CombatProbe>& InstalledCombatProbe() noexcept
{
  static std::shared_ptr<CombatProbe> probe;
  return probe;
}

inline void InstallCombatProbe(std::shared_ptr<CombatProbe> probe) noexcept
{
  InstalledCombatProbe() = std::move(probe);
}

inline CombatProbe* ActiveCombatProbe() noexcept
{
  return InstalledCombatProbe().get();
}

inline uint64_t CombatProbeNowMs() noexcept
{
  return static_cast<uint64_t>(
    std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::system_clock::now().time_since_epoch())
      .count());
}

} // namespace aetherius::combat
