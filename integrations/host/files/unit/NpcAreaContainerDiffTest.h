#pragma once
// DS-0k-fix2: installed winners only; structural enumeration, no spawn selection.
#include "NpcEntryInventoryTest.h"
#include <functional>

inline void AuditNpcAreaContainerDiff(const std::filesystem::path& manifestPath,
                                     const std::filesystem::path& outputPath)
{
  std::cout << std::unitbuf;
  std::ifstream input(manifestPath); nlohmann::json manifest; input >> manifest;
  std::vector<std::filesystem::path> paths;
  for (const auto& row : manifest.at("plugins"))
    paths.push_back(manifestPath.parent_path() / row.at("filename").get<std::string>());
  espm::Loader loader(paths); PartOne host; host.AttachEspm(&loader);
  const auto& browser = loader.GetBrowser();
  auto& cache = host.worldState.GetEspmCache();
  const auto& mapping = host.worldState.pluginIndexMapping;
  auto key = [&](uint32_t id) { return FormDesc::FromFormId(id, mapping).ToString(); };
  auto identity = [&](uint32_t id, bool required=true) {
    const auto lookup = browser.LookupById(id);
    if (!lookup.rec) {
      if (required) throw std::runtime_error("area diff missing record: " + key(id));
      return nlohmann::json{{"stableFormKey",key(id)}, {"recordType",nullptr},
        {"winnerPlugin",nullptr}, {"status","UNRESOLVED"}, {"weaponOrArmorRecord",false}};
    }
    if (lookup.ToGlobalId(lookup.rec->GetId()) != id)
      throw std::runtime_error("area diff identity mismatch: " + key(id));
    const auto type = lookup.rec->GetType().ToString();
    return nlohmann::json{{"stableFormKey",key(id)}, {"recordType",type}, {"status","RESOLVED"},
      {"winnerPlugin",browser.GetSourceMetadata(lookup.sourceId)->fileName},
      {"weaponOrArmorRecord",type == "WEAP" || type == "ARMO"}};
  };
  const auto world = FormDesc::FromString("3c:Skyrim.esm").ToFormId(mapping);
  std::set<uint32_t> placedIds;
  for (int x=-19; x<=-15; ++x) for (int y=20; y<=24; ++y) {
    const auto sources = browser.GetRecordsAtPos(world,x,y);
    for (size_t source=0; source<sources.size(); ++source)
      for (const auto rec : *sources[source]) if (rec->GetType() == espm::ACHR::kType)
        placedIds.insert(browser.ResolveRecordFormId(static_cast<espm::SourceId>(source),rec->GetId()));
  }
  nlohmann::json result{{"scope",{{"worldStableFormKey","3c:Skyrim.esm"},
    {"position",{-66464,93704}}, {"cellX",{-19,-15}}, {"cellY",{20,24}}, {"cells",25}}},
    {"method","All structurally reachable UseInventory providers through TPLT/LVLN; no level/chance filtering, no random selection, no actor creation. CNTO targets only; LVLI is not expanded or rolled."},
    {"idMeasurements","rawIdMeasurement and convertedIdMeasurement are transient decimal observations, never identity. Identity is exclusively stableFormKey (defining plugin + local FormID). Raw target is the DS-0i interpretation as a global id."},
    {"equipability","weaponOrArmorRecord classifies WEAP/ARMO as potentially equippable; does not prove NPC compatibility, actual equip or a game result."},
    {"npcs",nlohmann::json::array()}};
  size_t providerUses=0, cntoUses=0, changedUses=0;
  std::set<std::string> allProviders, changedPairs;
  for (auto id : placedIds) {
    const auto placed = browser.LookupById(id);
    if (!placed.rec || placed.rec->GetType() != espm::ACHR::kType)
      throw std::runtime_error("area diff winner is not ACHR");
    const auto data = espm::Convert<espm::ACHR>(placed.rec)->GetData(cache);
    const auto base = placed.ToGlobalId(data.baseId);
    std::set<uint32_t> providers, visiting, visited;
    std::function<void(uint32_t)> walk = [&](uint32_t current) {
      if (visiting.count(current)) throw std::runtime_error("area diff template cycle: " + key(current));
      if (visited.count(current)) return;
      visiting.insert(current);
      const auto lookup = browser.LookupById(current);
      if (!lookup.rec) throw std::runtime_error("area diff missing template: " + key(current));
      if (auto npc = espm::Convert<espm::NPC_>(lookup.rec)) {
        const auto npcData = npc->GetData(cache);
        if (npcData.baseTemplate && (npcData.templateDataFlags & espm::NPC_::UseInventory))
          walk(lookup.ToGlobalId(npcData.baseTemplate));
        else providers.insert(current);
      } else if (auto list = espm::Convert<espm::LVLN>(lookup.rec)) {
        const auto listData = list->GetData(cache);
        for (size_t i=0; i<listData.numEntries; ++i)
          walk(lookup.ToGlobalId(listData.entries[i].formId));
      } else throw std::runtime_error("area diff unsupported template type: " + key(current));
      visiting.erase(current); visited.insert(current);
    };
    walk(base);
    nlohmann::json row{{"reference",identity(id)}, {"base",identity(base)},
      {"providers",nlohmann::json::array()}, {"changedCnto",nlohmann::json::array()}};
    for (auto provider : providers) {
      const auto lookup = browser.LookupById(provider);
      const auto objects = espm::Convert<espm::NPC_>(lookup.rec)->GetData(cache).objects;
      row["providers"].push_back(identity(provider));
      ++providerUses; allProviders.insert(key(provider));
      for (size_t ordinal=0; ordinal<objects.size(); ++ordinal) {
        ++cntoUses;
        const auto& object = objects[ordinal];
        const auto converted = lookup.ToGlobalId(object.formId);
        if (converted == object.formId) continue;
        ++changedUses;
        auto raw = identity(object.formId,false), target = identity(converted);
        changedPairs.insert(raw.at("stableFormKey").get<std::string>() + " -> " + target.at("stableFormKey").get<std::string>());
        row["changedCnto"].push_back({{"provider",identity(provider)}, {"cntoOrdinal",ordinal},
          {"rawIdMeasurement",object.formId}, {"convertedIdMeasurement",converted},
          {"raw",raw}, {"converted",target}, {"count",object.count}});
      }
    }
    std::cout << "AREA_DIFF ref=" << key(id) << " base=" << key(base)
      << " providers=" << providers.size() << " changed=" << row["changedCnto"].size() << '\n';
    result["npcs"].push_back(std::move(row));
  }
  result["summary"] = {{"references",placedIds.size()}, {"providerUses",providerUses},
    {"uniqueProviders",allProviders.size()}, {"cntoUses",cntoUses},
    {"changedCntoUses",changedUses}, {"uniqueChangedPairs",changedPairs.size()}};
  if (placedIds.size() != 55) throw std::runtime_error("area diff scope differs from expected 55 ACHR");
  std::ofstream output(outputPath); output << result.dump(2) << '\n';
  if (!output) throw std::runtime_error("area diff output write failed");
  std::cout << "PASS AREA_DIFF " << result["summary"].dump() << '\n';
}
