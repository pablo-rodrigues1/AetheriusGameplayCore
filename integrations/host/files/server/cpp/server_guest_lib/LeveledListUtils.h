#pragma once
#include "libespm/Combiner.h"
#include "libespm/espm.h"
#include <cstdint>
#include <map>
#include <vector>

class LeveledListUtils
{
public:
  struct Entry
  {
    uint32_t formId = 0;
    uint32_t count = 0;
  };

  // It seems that pcLevel=0 makes it thinking that pcLevel=maximum possible pc
  // level
  static std::vector<Entry> EvaluateList(
    const espm::CombineBrowser& br, const espm::LookupResult& lookupRes,
    uint32_t pcLevel = 0, uint8_t* chanceNoneOverride = nullptr);

  static std::map<uint32_t, uint32_t> EvaluateListRecurse(
    const espm::CombineBrowser& br, const espm::LookupResult& lookupRes,
    uint32_t countMult = 1, uint32_t pcLevel = 0,
    uint8_t* chanceNoneOverride = nullptr);

  static std::vector<uint32_t> EvaluateTemplateChain(
    const espm::CombineBrowser& br, const espm::LookupResult& headNpc,
    uint32_t pcLevel);

  struct Observation {
    std::vector<uint32_t> chain;
    const char* reason = "BASE_NOT_REACHABLE";
    bool accepted = false;
    uint32_t candidates = 0;
  };
  // Bounded, deterministic validation; does not invoke the random selector.
  static Observation ValidateObservation(const espm::CombineBrowser& browser,
    uint32_t root, uint32_t reportedBase, uint32_t level);
  // Engine level is NOT player level: enumerate all structural paths, then
  // check the UseTraits race and UseStats level. Distinct NPC chains only.
  static Observation ValidateRaceObservation(const espm::CombineBrowser& browser,
    uint32_t root, uint32_t reportedRace, uint32_t level);
  static bool HasLeveledTemplate(const espm::CombineBrowser& browser, uint32_t root);

private:
  static const espm::NPC_* ConvertToNpc(
    const espm::LookupResult& lookupResult);

  static uint32_t GetBaseTemplateId(const espm::NPC_* cursor, uint32_t fileIdx,
                                    const espm::CombineBrowser& browser);

  static void UpdateCursorAndResult(uint32_t templateId,
                                    espm::LookupResult& templateResult,
                                    const espm::NPC_*& cursor,
                                    uint32_t& cursorFileIdx,
                                    std::vector<uint32_t>& result,
                                    const espm::CombineBrowser& browser,
                                    uint32_t pcLevel);

  static uint32_t EvaluateAndSelectNpcId(
    const espm::CombineBrowser& browser,
    const espm::LookupResult& templateResult, uint32_t pcLevel);
};
