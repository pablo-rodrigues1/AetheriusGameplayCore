#pragma once
// DS-0k-fix3: installed plugins, real Loader/PartOne/MpActor and packet sink.
#include "NpcEntryInventoryTest.h"
#include "LeveledListUtils.h"
#include <random>
// MSVC's static CRT random_device calls this external symbol. Resolving it
// in this test TU supplies a scoped entropy seam without modifying evaluators.
// Outside extraction it follows the installed CRT xrngdev.cpp rand_s path.
extern "C" int __cdecl rand_s(unsigned int*);
namespace ds0kfix3 {
using Json = nlohmann::json;
inline unsigned int entropySeed = 1;
inline size_t entropyCalls = 0;
inline bool deterministicEntropy = false;
}
namespace std {
unsigned int __cdecl _Random_device() {
  if (ds0kfix3::deterministicEntropy) { ++ds0kfix3::entropyCalls; return ds0kfix3::entropySeed; }
  unsigned int value;
  if (::rand_s(&value)) throw out_of_range("invalid random_device value");
  return value;
}
}
namespace ds0kfix3 {
struct EntropyScope {
  EntropyScope() {
    deterministicEntropy = true; entropyCalls = 0;
    std::random_device rd;
    if (rd() != entropySeed || entropyCalls != 1) throw std::runtime_error("entropy link seam self-check failed");
  }
  ~EntropyScope() { deterministicEntropy = false; }
};

struct Reader {
  PartOne& host;
  const espm::CombineBrowser& browser;
  espm::CompressedFieldsCache& cache;
  std::string Key(uint32_t id) { return FormDesc::FromFormId(id, host.worldState.pluginIndexMapping).ToString(); }
  Json Identity(uint32_t id) {
    auto r = browser.LookupById(id);
    Json j{{"stableFormKey",Key(id)}, {"status",r.rec ? "RESOLVED" : "UNRESOLVED"}};
    if (!r.rec) return j;
    if (r.ToGlobalId(r.rec->GetId()) != id) throw std::runtime_error("identity mismatch");
    auto editor = r.rec->GetEditorId(cache);
    j["recordType"] = r.rec->GetType().ToString(); j["editorId"] = editor ? editor : "";
    j["winnerPlugin"] = browser.GetSourceMetadata(r.sourceId)->fileName;
    if (auto a = espm::Convert<espm::ARMO>(r.rec)) {
      auto d = a->GetData(cache); auto flags = d.bod2.present ? d.bod2.bodyPartFlags : d.bodt.bodyPartFlags;
      j["bipedSlots"] = Json::array();
      for (int b=0;b<32;++b) if (flags & (uint32_t{1}<<b)) j["bipedSlots"].push_back(30+b);
      j["equipSlotStableFormKey"] = d.equipSlotId ? Json(Key(r.ToGlobalId(d.equipSlotId))) : Json(nullptr);
    }
    return j;
  }
  Json InventoryRows(const Inventory& inv) {
    Json rows=Json::array();
    for (auto& e:inv.entries) {
      auto j=Identity(e.baseId); j["count"]=e.count;
      j["wornFlag"]=e.GetWorn()==Inventory::Worn::Right ? "Right" : e.GetWorn()==Inventory::Worn::Left ? "Left" : "None";
      j["equipped"]=e.GetWorn()!=Inventory::Worn::None;
      rows.push_back(j);
    }
    return rows;
  }
  // Provenance uses actual EvaluateList selections, then independently checks
  // its leaf totals against actual EvaluateListRecurse. No simulated items.
  std::map<uint32_t,uint32_t> Expand(uint32_t id, uint32_t level, Json path, Json& leaves, unsigned depth=0) {
    if (depth>64) throw std::runtime_error("list recursion limit");
    auto r=browser.LookupById(id);
    if (!r.rec) { auto n=Identity(id);n["edge"]="UNRESOLVED";path.push_back(n); return {}; }
    auto node=Identity(id); auto type=r.rec->GetType();
    if (type!=espm::LVLI::kType && type!=espm::LVLN::kType) {
      path.push_back(node);leaves.push_back({{"item",node},{"path",path}});return {{id,1}};
    }
    auto data=reinterpret_cast<const espm::LeveledListBase*>(r.rec)->GetData(cache);
    node["flags"]=data.leveledItemFlags;node["chanceNone"]=data.chanceNone;
    node["chanceNoneGlobal"]=data.chanceNoneGlobalId ? Json(Key(r.ToGlobalId(data.chanceNoneGlobalId))) : Json(nullptr);
    node["evaluationLevel"]=level;node["entries"]=Json::array();
    for (size_t i=0;i<data.numEntries;++i) node["entries"].push_back({{"target",Key(r.ToGlobalId(data.entries[i].formId))},{"level",data.entries[i].level},{"count",data.entries[i].count}});
    path.push_back(node);
    std::map<uint32_t,uint32_t> totals;
    for (auto& e:LeveledListUtils::EvaluateList(browser,r,level)) {
      auto child=browser.LookupById(e.formId);if (!child.rec) continue;
      bool list=child.rec->GetType()==espm::LVLI::kType || child.rec->GetType()==espm::LVLN::kType;
      auto next=path;next.back()["selectedTarget"]=Key(e.formId);next.back()["selectedCount"]=e.count;
      if (list) {auto sub=Expand(e.formId,level,next,leaves,depth+1);for(auto p:sub)totals[p.first]+=p.second;}
      else { next.push_back(Identity(e.formId));leaves.push_back({{"item",Identity(e.formId)},{"path",next},{"count",e.count}});totals[e.formId]+=e.count; }
    }
    if (totals!=LeveledListUtils::EvaluateListRecurse(browser,r,1,level)) throw std::runtime_error("native expansion/provenance mismatch: "+Key(id));
    return totals;
  }
};
}

inline void ExtractNpcAreaItems(const std::filesystem::path& manifestPath, const std::filesystem::path& outputPath) {
  using namespace ds0kfix3;
  std::cout << std::unitbuf;
  std::ifstream input(manifestPath);Json manifest;input>>manifest;
  std::vector<std::filesystem::path> paths;
  for(auto& row:manifest.at("plugins"))paths.push_back(manifestPath.parent_path()/row.at("filename").get<std::string>());
  espm::Loader loader(paths);PartOne indexHost;indexHost.AttachEspm(&loader);
  auto& browser=loader.GetBrowser();auto& cache=indexHost.worldState.GetEspmCache();
  auto world=FormDesc::FromString("3c:Skyrim.esm").ToFormId(indexHost.worldState.pluginIndexMapping);
  std::set<uint32_t> placedIds;
  for(int x=-19;x<=-15;++x)for(int y=20;y<=24;++y){auto sources=browser.GetRecordsAtPos(world,x,y);
    for(size_t s=0;s<sources.size();++s)for(auto r:*sources[s])if(r->GetType()==espm::ACHR::kType)placedIds.insert(browser.ResolveRecordFormId(static_cast<espm::SourceId>(s),r->GetId()));}
  if(placedIds.size()!=55)throw std::runtime_error("expected same 55 ACHR");
  EntropyScope entropy;
  Json result{{"scope",{{"references",55},{"cells",25},{"world","3c:Skyrim.esm"}}},
    {"method","Installed Loader/PartOne/MpActor; scoped static-CRT entropy link seam in test EXE only, constant seed per list evaluation; native evaluator unchanged. Native template level=0, item level=1 regardless of character level. No saved state restored."},
    {"wornSemantics","Right/Left are wire worn flags; for ARMO they are not a claim of anatomical hand: bipedSlots are separately read from winner."},
    {"rows",Json::array()}};
  result["configuration"]="standard";
  size_t creates=0,updates=0;
  // Three repetitions requested when saved character level is unavailable.
  // The nominal value is NOT presented as controlling production's constants.
  for(unsigned nominalLevel:{1u,10u,30u}) for(unsigned seed=1;seed<=16;++seed) for(auto placedId:placedIds){
    entropySeed=seed;
    PartOne host;host.AttachEspm(&loader);Reader rd{host,browser,host.worldState.GetEspmCache()};
    auto playerId=host.worldState.GenerateFormId();host.CreateActor(playerId,{0,0,0},0,world);
    auto& player=host.worldState.GetFormAt<MpActor>(playerId);host.serverState.Connect(0,"DS-0k-fix3-isolated");host.SetUserActor(0,playerId);
    auto placed=browser.LookupById(placedId);auto pd=espm::Convert<espm::ACHR>(placed.rec)->GetData(cache);auto base=placed.ToGlobalId(pd.baseId);
    auto npcId=host.worldState.GenerateFormId();host.worldState.AddForm(std::make_unique<MpActor>(LocationalData{{0,0,0},{0,0,0},FormDesc::Tamriel()},host.CreateFormCallbacks(),base),npcId);
    auto& npc=host.worldState.GetFormAt<MpActor>(npcId);
    Json row{{"reference",rd.Identity(placedId)},{"base",rd.Identity(base)},{"seed",seed},{"nominalPlayerLevel",nominalLevel},{"effectiveTemplateLevel",0},{"effectiveItemLevel",1},{"templateChain",Json::array()},{"packets",Json::array()},{"provenance",Json::array()}};
    for(auto& f:npc.GetTemplateChain())row["templateChain"].push_back(f.ToString());
    auto provider=EvaluateTemplate<espm::NPC_::UseInventory>(&host.worldState,base,npc.GetTemplateChain(),[](const espm::LookupResult& r,const espm::NPC_::Data&){return r;});
    row["inventoryProvider"]=rd.Identity(provider.ToGlobalId(provider.rec->GetId()));
    auto d=espm::Convert<espm::NPC_>(provider.rec)->GetData(rd.cache);
    auto cnto=GetInventoryObjects(&host.worldState,npc.GetTemplateChain(),browser.LookupById(base));
    std::map<uint32_t,uint32_t> expected;
    for(size_t i=0;i<cnto.size();++i){Json p=Json::array({{{"edge","CNTO"},{"provider",row["inventoryProvider"]},{"ordinal",i},{"count",cnto[i].count},{"rawTarget",rd.Key(d.objects.at(i).formId)},{"conversionChangesTarget",d.objects.at(i).formId!=provider.ToGlobalId(d.objects.at(i).formId)},{"convertedTarget",rd.Key(provider.ToGlobalId(d.objects.at(i).formId))}}});
      auto target=browser.LookupById(cnto[i].formId);auto sub=rd.Expand(cnto[i].formId,1,p,row["provenance"]);
      if(target.rec && target.rec->GetType()==espm::LVLI::kType){for(auto e:sub)expected[e.first]+=e.second;}
      else expected[cnto[i].formId]+=cnto[i].count;
    }
    const auto outfitId=provider.ToGlobalId(d.defaultOutfitId);row["outfit"]=rd.Identity(outfitId);
    auto outfit=browser.LookupById(outfitId);
    if(auto o=espm::Convert<espm::OTFT>(outfit.rec)){auto od=o->GetData(rd.cache);for(size_t i=0;i<od.count;++i){auto id=outfit.ToGlobalId(od.formIds[i]);Json p=Json::array({{{"edge","OTFT"},{"outfit",rd.Identity(outfitId)},{"ordinal",i}}});auto sub=rd.Expand(id,1,p,row["provenance"]);for(auto e:sub)expected[e.first]+=e.second;}}
    std::map<uint32_t,uint32_t> actual;for(auto e:npc.GetInventory().entries)actual[e.baseId]+=e.count;
    if(actual!=expected)throw std::runtime_error("provenance does not reproduce actual initialized inventory: "+rd.Key(placedId));
    row["inventory"]=rd.InventoryRows(npc.GetInventory());row["equipment"]=rd.InventoryRows(npc.GetEquipment().inv);
    CreateActorMessage all;npc.VisitProperties(all,VisitPropertiesMode::All);row["VisitPropertiesAllInventory"]=all.props.inventory ? all.props.inventory->ToJson() : Json(nullptr);
    auto capture=[&](const char* phase){for(auto& msg:host.Messages()){
      auto t=msg.j.value("t",-1);if((t!=static_cast<int>(MsgType::CreateActor)&&t!=static_cast<int>(MsgType::UpdateEquipment))||msg.j.value("idx",0u)!=npc.GetIdx())continue;
      row["packets"].push_back({{"phase",phase},{"reliable",msg.reliable},{"userId",msg.userId},{"wire",msg.j}});
      if(t==static_cast<int>(MsgType::CreateActor))++creates;else ++updates;
    }};
    host.Messages().clear();host.worldState.hosters[npcId]=playerId;MpObjectReference::Subscribe(&npc,&player);capture("initialSubscribe");
    if(row["packets"].size()!=1)throw std::runtime_error("initial CreateActor missing/duplicate");
    npc.SetSpawnPoint(LocationalData{{0,0,0},{0,0,0},FormDesc::Tamriel()});npc.SetRespawnTime(0);npc.SetIsDead(true);host.Messages().clear();npc.RespawnWithDelay(false);host.Tick();capture("nativeRespawn");
    row["afterRespawnInventory"]=rd.InventoryRows(npc.GetInventory());row["afterRespawnEquipment"]=rd.InventoryRows(npc.GetEquipment().inv);
    result["rows"].push_back(std::move(row));
  }
  result["summary"]={{"rows",result["rows"].size()},{"CreateActor",creates},{"UpdateEquipment",updates},{"entropyCalls",entropyCalls}};
  std::ofstream output(outputPath);output<<result.dump(2)<<'\n';if(!output)throw std::runtime_error("output write failed");
  std::cout<<"PASS AREA_ITEMS "<<result["summary"].dump()<<'\n';
}
