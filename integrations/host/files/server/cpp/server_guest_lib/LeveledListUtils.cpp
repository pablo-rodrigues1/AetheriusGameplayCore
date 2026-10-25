#include "LeveledListUtils.h"
#include "EvaluateTemplate.h"
#include "aetherius_combat/NpcObservation.h"
#include <optional>
#include <random>
#include <spdlog/spdlog.h>
#include <stdexcept>

namespace {
bool IsLeveledType(const espm::LookupResult& lookupRes) noexcept
{
  espm::Type type = lookupRes.rec->GetType();
  return type == espm::LVLI::kType || type == espm::LVLN::kType ||
    type == "LVSP" /* for the future leveled spell implementation */;
}
}

std::vector<LeveledListUtils::Entry> LeveledListUtils::EvaluateList(
  const espm::CombineBrowser& br, const espm::LookupResult& lookupRes,
  uint32_t pcLevel, uint8_t* chanceNoneOverride)
{
  espm::CompressedFieldsCache dummyCache;

  const espm::LeveledListBase* leveledList = nullptr;
  if (IsLeveledType(lookupRes)) {
    leveledList =
      reinterpret_cast<const espm::LeveledListBase*>(lookupRes.rec);
  }
  if (!leveledList) {
    return {};
  }
  auto data = leveledList->GetData(dummyCache);

  std::vector<Entry> res;

  int chanceNone = data.chanceNoneGlobalId ? 100 : data.chanceNone;
  if (chanceNoneOverride) {
    chanceNone = *chanceNoneOverride;
  }

  std::uniform_real_distribution<double> dist(0.0, 100.0);

  std::random_device rd;
  std::mt19937 mt(rd());
  bool none = dist(mt) < chanceNone;
  if (!none) {
    std::vector<const espm::LeveledListBase::Entry*> entriesAllowed;
    for (size_t i = 0; i < data.numEntries; ++i) {
      if (!pcLevel || data.entries[i].level <= pcLevel) {
        entriesAllowed.push_back(&data.entries[i]);
      }
    }

    bool useRandomEntry =
      !(data.leveledItemFlags & espm::LeveledListBase::UseAll);
    if (useRandomEntry && !entriesAllowed.empty()) {
      std::uniform_int_distribution<int> dist(0, entriesAllowed.size() - 1);
      auto entry = entriesAllowed[dist(mt)];

      uint32_t formId = lookupRes.ToGlobalId(entry->formId);
      res.push_back({ formId, entry->count });
    } else {
      for (auto entry : entriesAllowed) {
        uint32_t formId = lookupRes.ToGlobalId(entry->formId);
        res.push_back({ formId, entry->count });
      }
    }
  }
  return res;
}

std::map<uint32_t, uint32_t> LeveledListUtils::EvaluateListRecurse(
  const espm::CombineBrowser& br, const espm::LookupResult& lookupRes,
  uint32_t countMult, uint32_t pcLevel, uint8_t* chanceNoneOverride)
{
  espm::CompressedFieldsCache dummyCache;

  const espm::LeveledListBase* leveledList = nullptr;
  if (IsLeveledType(lookupRes)) {
    leveledList =
      reinterpret_cast<const espm::LeveledListBase*>(lookupRes.rec);
  }

  bool calcForEach = leveledList &&
    (leveledList->GetData(dummyCache).leveledItemFlags &
     espm::LeveledListBase::Each);

  if (calcForEach && countMult != 1) {
    std::map<uint32_t, uint32_t> res;
    for (uint32_t i = 0; i < countMult; ++i) {
      auto stepRes = EvaluateListRecurse(br, lookupRes, 1, pcLevel);
      for (auto& p : stepRes) {
        res[p.first] += p.second;
      }
    }
    return res;
  }

  std::map<uint32_t, uint32_t> res;
  auto firstEvalRes = EvaluateList(br, lookupRes, pcLevel, chanceNoneOverride);
  for (auto& e : firstEvalRes) {
    auto eLookupRes = br.LookupById(e.formId);
    if (!eLookupRes.rec) {
      continue;
    }
    if (IsLeveledType(eLookupRes)) {
      auto childRes = EvaluateListRecurse(br, eLookupRes, 1, pcLevel);
      for (auto& p : childRes) {
        res[p.first] += p.second;
      }

    } else {
      res[e.formId] += e.count;
    }
  }

  if (countMult != 1 && !calcForEach) {
    for (auto& p : res) {
      p.second *= countMult;
    }
  }

  return res;
}

std::vector<uint32_t> LeveledListUtils::EvaluateTemplateChain(
  const espm::CombineBrowser& browser, const espm::LookupResult& headNpc,
  uint32_t pcLevel)
{
  std::vector<uint32_t> result;
  auto npcCursor = ConvertToNpc(headNpc);
  if (!npcCursor) {
    spdlog::error("EvaluateTemplateChain: NPC_ expected");
    return result;
  }

  uint32_t cursorFileIdx = headNpc.fileIdx;
  result.push_back(headNpc.ToGlobalId(headNpc.rec->GetId()));

  while (true) {
    uint32_t templateId = GetBaseTemplateId(npcCursor, cursorFileIdx, browser);
    if (templateId == 0) {
      break; // End if no base template
    }

    espm::LookupResult templateResult = browser.LookupById(templateId);

    if (!templateResult.rec) {
      spdlog::error("EvaluateTemplateChain: Not found template record");
      return result;
    }

    UpdateCursorAndResult(templateId, templateResult, npcCursor, cursorFileIdx,
                          result, browser, pcLevel);
  }

  return result;
}

const espm::NPC_* LeveledListUtils::ConvertToNpc(
  const espm::LookupResult& lookupResult)
{
  return espm::Convert<espm::NPC_>(lookupResult.rec);
}

uint32_t LeveledListUtils::GetBaseTemplateId(
  const espm::NPC_* cursor, uint32_t fileIdx,
  const espm::CombineBrowser& browser)
{
  espm::CompressedFieldsCache dummyCache;
  auto data = cursor->GetData(dummyCache);
  if (!data.baseTemplate) {
    return 0; // Indicates there's no base template
  }

  auto lookupRes = espm::LookupResult(&browser, cursor, fileIdx);
  return lookupRes.ToGlobalId(data.baseTemplate);
}

void LeveledListUtils::UpdateCursorAndResult(
  uint32_t templateId, espm::LookupResult& templateResult,
  const espm::NPC_*& cursor, uint32_t& cursorFileIdx,
  std::vector<uint32_t>& result, const espm::CombineBrowser& browser,
  uint32_t pcLevel)
{
  if (auto npc = espm::Convert<espm::NPC_>(templateResult.rec)) {
    result.push_back(templateId);
    cursor = npc;
    cursorFileIdx = templateResult.fileIdx;
  } else if (auto lvln = espm::Convert<espm::LVLN>(templateResult.rec)) {
    auto selectedNpcId =
      EvaluateAndSelectNpcId(browser, templateResult, pcLevel);
    if (selectedNpcId == 0) {
      return;
    }

    auto npcLookupRes = browser.LookupById(selectedNpcId);
    cursor = espm::Convert<espm::NPC_>(npcLookupRes.rec);
    result.push_back(selectedNpcId);
    cursorFileIdx = npcLookupRes.fileIdx;
  } else {
    spdlog::error("EvaluateTemplateChain: Not found template record");
  }
}

uint32_t LeveledListUtils::EvaluateAndSelectNpcId(
  const espm::CombineBrowser& browser,
  const espm::LookupResult& templateResult, uint32_t pcLevel)
{
  auto countByFormId =
    LeveledListUtils::EvaluateListRecurse(browser, templateResult, 1, pcLevel);

  if (countByFormId.empty()) {
    spdlog::error(
      "EvaluateTemplateChain: EvaluateListRecurse returned empty map");
    return 0;
  }

  if (countByFormId.size() > 1) {
    spdlog::warn("EvaluateTemplateChain: EvaluateListRecurse returned more "
                 "than 1 result, omitting other results");
  }

  // Return the id of the first npc in the map
  return countByFormId.begin()->first;
}

namespace {
struct ObservationSearch {
  const espm::CombineBrowser& browser;
  uint32_t reported, level;
  bool raceMode = false;
  std::vector<std::vector<uint32_t>> candidates;
  espm::CompressedFieldsCache cache;
  size_t visits = 0;
  bool invalid = false, ambiguous = false;
  std::vector<uint32_t> found, path, seen;
  void Walk(uint32_t id, bool matched) {
    if (++visits > 4096 || seen.size() >= 64 ||
        std::find(seen.begin(), seen.end(), id) != seen.end()) { invalid = true; return; }
    const auto lookup = browser.LookupById(id);
    if (!lookup.rec) { invalid = true; return; }
    seen.push_back(id);
    if (const auto* npc = espm::Convert<espm::NPC_>(lookup.rec)) {
      path.push_back(id); matched = matched || id == reported;
      const auto data = npc->GetData(cache);
      if (data.baseTemplate) Walk(lookup.ToGlobalId(data.baseTemplate), matched);
      else if (raceMode) {
        // Same provider rule as EvaluateTemplate: first NPC not inheriting the
        // requested group, or the final NPC with no template.
        auto provider = [&](uint16_t flag) {
          for (const auto npcId : path) {
            const auto p = browser.LookupById(npcId);
            const auto d = espm::Convert<espm::NPC_>(p.rec)->GetData(cache);
            if (!d.baseTemplate || !(d.templateDataFlags & flag)) return p;
          }
          return espm::LookupResult{};
        };
        const auto traits = provider(espm::NPC_::UseTraits);
        const auto stats = provider(espm::NPC_::UseStats);
        if (!traits.rec || !stats.rec) { invalid = true; }
        else {
          const auto race = traits.ToGlobalId(espm::Convert<espm::NPC_>(traits.rec)->GetData(cache).race);
          const auto raceRecord = browser.LookupById(race);
          const auto fields = aetherius::npc::ReadNpc(stats, cache);
          if (!race || !raceRecord.rec || raceRecord.rec->GetType() != espm::RACE::kType || !fields.present) invalid = true;
          else if (race == reported && aetherius::npc::LevelCompatible(fields, level) &&
              std::find(candidates.begin(), candidates.end(), path) == candidates.end()) candidates.push_back(path);
        }
      } else if (matched) {
        if (!found.empty() && found != path) ambiguous = true;
        else found = path;
      }
      path.pop_back();
    } else if (const auto* list = espm::Convert<espm::LVLN>(lookup.rec)) {
      const auto data = list->GetData(cache);
      // A single actor cannot attest a UseAll result or a guaranteed empty list.
      if ((data.leveledItemFlags & espm::LeveledListBase::UseAll) || data.chanceNone >= 100 || data.chanceNoneGlobalId) {
        invalid = true;
      } else {
        uint32_t highest = 0;
        for (size_t i = 0; i < data.numEntries; ++i)
          if (data.entries[i].level <= level) highest = std::max(highest, data.entries[i].level);
        for (size_t i = 0; i < data.numEntries; ++i) {
          const auto& e = data.entries[i];
          if (!e.count) continue;
          if (!raceMode && level && (e.level > level || (!(data.leveledItemFlags & espm::LeveledListBase::AllLevels) && e.level != highest))) continue;
          Walk(lookup.ToGlobalId(e.formId), matched);
        }
      }
    } else invalid = true;
    seen.pop_back();
  }
};
}
LeveledListUtils::Observation LeveledListUtils::ValidateObservation(
  const espm::CombineBrowser& browser, uint32_t root, uint32_t base, uint32_t level)
{
  Observation result;
  if (!level || level > 65535) { result.reason = "INVALID_LEVEL"; return result; }
  ObservationSearch search{browser, base, level}; search.Walk(root, false);
  if (search.invalid) { result.reason = "UNSUPPORTED_TEMPLATE_GRAPH"; return result; }
  if (search.ambiguous) { result.reason = "AMBIGUOUS_TEMPLATE_CHAIN"; return result; }
  if (search.found.empty()) {
    ObservationSearch structural{browser, base, 0}; structural.Walk(root, false);
    result.reason = structural.found.empty() ? "BASE_NOT_REACHABLE" : "INCOMPATIBLE_LIST_LEVEL";
    return result;
  }
  result.chain = std::move(search.found); result.reason = "ACCEPTED"; result.accepted = true;
  return result;
}
LeveledListUtils::Observation LeveledListUtils::ValidateRaceObservation(
  const espm::CombineBrowser& browser, uint32_t root, uint32_t race, uint32_t level)
{
  Observation result;
  if (!level || level > 65535) { result.reason = "INVALID_LEVEL"; return result; }
  const auto record = browser.LookupById(race);
  if (!record.rec || record.rec->GetType() != espm::RACE::kType) { result.reason = "NOT_A_RACE"; return result; }
  ObservationSearch search{browser, race, level, true}; search.Walk(root, false);
  result.candidates = static_cast<uint32_t>(search.candidates.size());
  if (search.invalid) { result.reason = "UNSUPPORTED_TEMPLATE_GRAPH"; return result; }
  if (!result.candidates) { result.reason = "NO_MATCHING_OBSERVATION"; return result; }
  if (result.candidates != 1) { result.reason = "AMBIGUOUS_OBSERVATION"; return result; }
  result.chain = std::move(search.candidates.front()); result.accepted = true; result.reason = "ACCEPTED";
  return result;
}
bool LeveledListUtils::HasLeveledTemplate(const espm::CombineBrowser& browser, uint32_t root)
{
  espm::CompressedFieldsCache cache; std::vector<uint32_t> seen;
  for (size_t i = 0; i < 64; ++i) {
    if (std::find(seen.begin(), seen.end(), root) != seen.end()) return false;
    seen.push_back(root);
    const auto lookup = browser.LookupById(root);
    if (!lookup.rec) return false;
    if (lookup.rec->GetType() == espm::LVLN::kType) return true;
    const auto* npc = espm::Convert<espm::NPC_>(lookup.rec);
    if (!npc) return false;
    const auto data = npc->GetData(cache);
    if (!data.baseTemplate) return false;
    root = lookup.ToGlobalId(data.baseTemplate);
  }
  return false;
}
