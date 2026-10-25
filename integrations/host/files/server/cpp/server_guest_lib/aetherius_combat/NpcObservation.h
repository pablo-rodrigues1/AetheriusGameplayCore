#pragma once
// DS-0g: read-only winning NPC/CLAS fields missing from libespm's public Data.
// Binary schema: TES5Edit/Core/wbDefinitionsTES5.pas (ACBS, CNAM, DNAM,
// CLAS.DATA, RACE.DATA). No runtime plugin index is part of this schema.
#include "WorldState.h"
#include "FormDesc.h"
#include "libespm/RecordHeaderAccess.h"
#include "libespm/CombineBrowser.h"
#include "libespm/espm.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <numeric>
#include <optional>
#include <stdexcept>

namespace aetherius::npc {
// Wire vocabulary, shared by validation and diagnostics; no exception text.
inline bool IsUnavailableReason(std::string_view reason) {
  return reason == "ACTOR_NOT_LOADED" || reason == "RESOLVED_BASE_ABSENT" ||
    reason == "RESOLVED_BASE_HAS_NO_STABLE_KEY" || reason == "INVALID_ENGINE_LEVEL" ||
    reason == "ENGINE_READ_FAILED" || reason == "RACE_ABSENT" || reason == "RACE_HAS_NO_STABLE_KEY";
}
struct Fields {
  bool present = false, autoCalc = false, pcMult = false, skillsPresent = false;
  uint16_t level = 0, min = 0, max = 0;
  uint32_t classId = 0;
  std::array<float, 18> skills{};
};
template<class T> inline T Read(const char* p) {
  T result; std::memcpy(&result, p, sizeof(result)); return result;
}
inline Fields ReadNpc(const espm::LookupResult& lookup, espm::CompressedFieldsCache& cache) {
  Fields result;
  if (!lookup.rec || lookup.rec->GetType() != espm::NPC_::kType) return result;
  espm::RecordHeaderAccess::IterateFields(lookup.rec, [&](const char* type, uint32_t size, const char* p) {
    if (!std::memcmp(type, "ACBS", 4) && size >= 24) {
      result.present = true;
      const auto flags = Read<uint32_t>(p);
      result.autoCalc = (flags & 0x10) != 0; result.pcMult = (flags & 0x80) != 0;
      result.level = Read<uint16_t>(p + 8);
      result.min = Read<uint16_t>(p + 10); result.max = Read<uint16_t>(p + 12);
    } else if (!std::memcmp(type, "CNAM", 4) && size == 4) {
      result.classId = lookup.ToGlobalId(Read<uint32_t>(p));
    } else if (!std::memcmp(type, "DNAM", 4) && size >= 36) {
      result.skillsPresent = true;
      for (size_t i = 0; i < 18; ++i)
        result.skills[i] = Read<uint8_t>(p + i) + Read<uint8_t>(p + 18 + i);
    }
  }, cache);
  return result;
}
inline bool LevelCompatible(const Fields& f, uint32_t level) {
  return f.present && level > 0 && level <= 65535 &&
    (f.pcMult ? ((!f.min || level >= f.min) && (!f.max || level <= f.max)) : level == f.level);
}
struct ClassFields {
  bool present = false;
  std::array<unsigned, 18> skills{};
  std::array<unsigned, 3> stats{};
};
inline ClassFields ReadClass(const espm::LookupResult& lookup, espm::CompressedFieldsCache& cache) {
  ClassFields result;
  if (!lookup.rec || lookup.rec->GetType() != "CLAS") return result;
  espm::RecordHeaderAccess::IterateFields(lookup.rec, [&](const char* type, uint32_t size, const char* p) {
    if (!std::memcmp(type, "DATA", 4) && size >= 36) {
      result.present = true;
      for (size_t i = 0; i < 18; ++i) result.skills[i] = Read<uint8_t>(p + 6 + i);
      for (size_t i = 0; i < 3; ++i) result.stats[i] = Read<uint8_t>(p + 32 + i);
    }
  }, cache);
  return result;
}
// Integer weighted allocation. Bulk shares, equal redistribution of capped
// excess, then one point per pass in descending weight / descending AV order.
// Source for skills: dado3212's original assembly reconstruction (auto_calc.c,
// 2026-09-26). Unsupported byte-overflow inputs are explicit, never wrapped.
template<size_t N> inline void Distribute(std::array<float, N>& values,
    std::array<unsigned, N> weights, unsigned points, float cap) {
  const unsigned total = std::accumulate(weights.begin(), weights.end(), 0u);
  if (!points || !total) return;
  std::array<size_t, N> order{}; std::iota(order.begin(), order.end(), 0);
  std::sort(order.begin(), order.end(), [&](size_t a, size_t b) {
    return weights[a] != weights[b] ? weights[a] > weights[b] : a > b;
  });
  unsigned remaining = points % total, excess = 0, capped = 0;
  auto award = [&](size_t i, unsigned amount) {
    if (N == 18 && amount > 255) throw std::runtime_error("UNSUPPORTED: NPC_SKILL_BYTE_OVERFLOW");
    const float next = values[i] + amount;
    values[i] = std::min(next, cap);
    return next > cap ? static_cast<unsigned>(next - cap) : 0u;
  };
  for (auto i : order) {
    const auto over = award(i, weights[i] * (points / total));
    excess += over; if (over) ++capped;
  }
  while (excess && capped < N) {
    const unsigned amount = excess / (N - capped);
    if (!amount) break;
    bool progress = false;
    for (auto i : order) if (weights[i] && values[i] < cap) {
      const auto over = award(i, amount); excess = excess - amount + over;
      if (over) ++capped; progress = true;
    }
    if (!progress) break;
  }
  remaining += excess;
  while (remaining) {
    bool attempted = false;
    for (auto i : order) if (weights[i] && remaining) {
      remaining = remaining - 1 + award(i, 1); --weights[i]; attempted = true;
    }
    if (!attempted) break;
  }
}
// Typed GMST read: libespm::GMST::Data currently interprets DATA as float even
// for integer settings, so read DATA by its confirmed EDID type here.
template<class T> inline T Setting(WorldState& world, const char* key, const char* editorId) {
  const auto desc=FormDesc::FromString(key);
  if(world.pluginIndexMapping.GetEspmFileIndexByFilename(desc.file)==PluginIndexMapping::kInvalidFileIndex)
    throw std::runtime_error(std::string("UNSUPPORTED: NPC_GMST_PLUGIN_ABSENT_")+editorId);
  const auto id=desc.ToFormId(world.pluginIndexMapping);
  const auto lookup=world.GetEspm().GetBrowser().LookupById(id);
  if(!lookup.rec || lookup.rec->GetType()!=espm::GMST::kType)
    throw std::runtime_error(std::string("UNSUPPORTED: NPC_GMST_ABSENT_")+editorId);
  bool name=false, present=false; T value{};
  espm::RecordHeaderAccess::IterateFields(lookup.rec,[&](const char* type,uint32_t size,const char* p) {
    if(!std::memcmp(type,"EDID",4)) name=size==std::strlen(editorId)+1 && !std::memcmp(p,editorId,size-1);
    if(!std::memcmp(type,"DATA",4) && size==sizeof(T)) { value=Read<T>(p);present=true; }
  },world.GetEspmCache());
  if(!name || !present || !std::isfinite(static_cast<double>(value)) || value<0)
    throw std::runtime_error(std::string("UNSUPPORTED: NPC_GMST_INVALID_")+editorId);
  return value;
}
inline std::array<float, 18> AutoSkills(const espm::RecordHeader* race,
    espm::CompressedFieldsCache& cache, const ClassFields& cls, uint32_t level, unsigned start, unsigned pointsPerLevel) {
  std::array<float, 18> result; result.fill(static_cast<float>(start));
  bool present = false;
  espm::RecordHeaderAccess::IterateFields(race, [&](const char* type, uint32_t size, const char* p) {
    if (!std::memcmp(type, "DATA", 4) && size >= 14) {
      present = true;
      for (size_t j = 0; j < 7; ++j) {
        const auto skill = Read<uint8_t>(p + 2*j);
        if (skill == 255) continue;
        // RACE stores ActorValue 6..23, not the CLAS/DNAM skill index 0..17.
        if (skill < 6 || skill >= 24) throw std::runtime_error("UNSUPPORTED: RACE_SKILL_ACTOR_VALUE");
        result[skill - 6] += Read<int8_t>(p + 2*j + 1);
      }
    }
  }, cache);
  if (!present) throw std::runtime_error("UNSUPPORTED: RACE_SKILL_BOOSTS_ABSENT");
  Distribute(result, cls.skills, pointsPerLevel * (level - 1), 100.f);
  return result;
}
}
