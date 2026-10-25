#pragma once
// DS-0g: actual host, winning plugins and serialized ESP fixtures; no socket.
#include "aetherius_combat/NpcObservation.h"
#include "aetherius_combat/CombatProbe.h"
#include "LeveledListUtils.h"
#include "EvaluateTemplate.h"
#include "CustomPacketMessage.h"
#include "MpChangeForms.h"
#include <filesystem>
#include <fstream>
#include <limits>
#include <sstream>
#include <spdlog/sinks/ostream_sink.h>

namespace ds0g_test {
template<class T> void Put(std::string& s, size_t offset, T value) {
  if (s.size() < offset + sizeof(value)) s.resize(offset + sizeof(value));
  std::memcpy(s.data() + offset, &value, sizeof(value));
}
inline std::string Field(const char* type, const std::string& data) {
  std::string out(type, 4); Put<uint16_t>(out, 4, static_cast<uint16_t>(data.size())); return out + data;
}
inline std::string IdField(const char* type, uint32_t id) {
  std::string out; Put(out, 0, id); return Field(type, out);
}
inline std::string Record(const char* type, uint32_t id, const std::string& fields) {
  std::string out(24, '\0'); out.replace(0, 4, type, 4); Put<uint32_t>(out, 4, static_cast<uint32_t>(fields.size()));
  Put(out, 12, id); Put<uint16_t>(out, 20, 44); return out + fields;
}
// ESP internal master table: Skyrim is master 0, this fixture is the next file.
// This is binary serialization, never a runtime/persisted gameplay identity.
inline uint32_t Own(uint32_t local) { return (1u << 24) | local; }
inline std::string Npc(uint32_t id, uint32_t target, uint16_t level, bool pc = false,
    uint32_t race = 0x1320a, uint16_t templateFlags = 3) {
  std::string acbs(24, '\0'); Put<uint32_t>(acbs, 0, 0x10 | (pc ? 0x80 : 0));
  Put(acbs, 8, level); Put<uint16_t>(acbs, 10, pc ? 5 : 0); Put<uint16_t>(acbs, 12, pc ? 20 : 0);
  Put<uint16_t>(acbs, 16, 100); Put<uint16_t>(acbs, 18, target ? templateFlags : 0);
  std::string fields = Field("ACBS", acbs) + IdField("RNAM", race) + IdField("CNAM", 0x131e6)
    + Field("DNAM", std::string(52, '\0'));
  if (target) fields += IdField("TPLT", Own(target));
  return Record("NPC_", Own(id), fields);
}
inline std::string List(uint32_t id, bool all, uint32_t second = 0x803, uint32_t first = 0x802) {
  std::string fields = Field("LVLD", std::string(1, '\0')) + Field("LVLF", std::string(1, all ? 1 : 0)) + Field("LLCT", std::string(1, 2));
  for (auto pair : { std::make_pair(1, first), std::make_pair(10, second) }) {
    std::string e(12, '\0'); Put<uint16_t>(e, 0, pair.first); Put(e, 4, Own(pair.second)); Put<uint16_t>(e, 8, 1);
    fields += Field("LVLO", e);
  }
  return Record("LVLN", Own(id), fields);
}
inline void WriteFixture(const std::filesystem::path& path, bool empty) {
  std::string hedr(12, '\0'); Put<float>(hedr, 0, 1.7f);
  std::string header = Field("HEDR", hedr);
  if (!empty) header += Field("MAST", std::string("Skyrim.esm\0", 11)) + Field("DATA", std::string(8, '\0'));
  std::ofstream out(path, std::ios::binary); out << Record("TES4", 0, header);
  if (!empty) out << Npc(0x800, 0x801, 1) << List(0x801, true) << Npc(0x802, 0, 2) << Npc(0x803, 0, 12)
    << Npc(0x804, 0x805, 1) << List(0x805, false) << Npc(0x808, 0, 1000, true)
    << Npc(0x809, 0x80a, 1) << List(0x80a, true, 0x80b) << Npc(0x80b, 0x80a, 1)
    << Npc(0x810, 0x811, 1) << List(0x811, true, 0x813, 0x812)
    << Npc(0x812, 0x814, 2) << Npc(0x813, 0x814, 12) << Npc(0x814, 0, 2)
    // Different UseTraits providers, common terminal and UseStats provider.
    << Npc(0x820, 0x821, 1) << List(0x821, true, 0x823, 0x822)
    << Npc(0x822, 0x824, 1, false, 0x131e7, 2) << Npc(0x823, 0x824, 1, false, 0x131e8, 2)
    << Npc(0x824, 0, 12)
    // Entry's RNAM differs from the effective UseTraits race.
    << Npc(0x830, 0x831, 1) << List(0x831, true, 0x833, 0x832)
    << Npc(0x832, 0x834, 12, false, 0x1320a, 1) << Npc(0x833, 0, 12)
    << Npc(0x834, 0, 2, false, 0x131e7)
    << Npc(0x840, 0x841, 1) << List(0x841, true, 0x843, 0x842)
    << Npc(0x842, 0, 12, false, 0x131e7) << Npc(0x843, 0, 12, false, 0x131e7)
    << Npc(0x850, 0x851, 1) << List(0x851, true, 0x842, 0x842);
  if (!out) throw std::runtime_error("fixture write failed");
}
}

inline void RunNpcObservationTests(const std::filesystem::path& manifestPath) {
  using namespace ds0g_test;
  std::cout << std::unitbuf;
  int count = 0;
  auto check = [&](bool ok, const char* why) { ++count; if (!ok) throw std::runtime_error("DS-0g check " + std::to_string(count) + ": " + why); };
  auto assertNear = [&](float actual, float expected, const char* why) { check(std::abs(actual-expected)<0.001f, why); };
  std::ifstream in(manifestPath); nlohmann::json manifest; in >> manifest;
  std::vector<std::filesystem::path> original;
  for (const auto& row : manifest.at("plugins")) original.push_back(manifestPath.parent_path()/row.at("filename").get<std::string>());
  const auto dir = std::filesystem::temp_directory_path()/ ("aetherius-ds0g-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
  std::filesystem::create_directory(dir);
  struct Cleanup { std::filesystem::path path; ~Cleanup() { std::error_code e; std::filesystem::remove_all(path, e); } } cleanup{dir};
  const auto fixture = dir/"DS0gFixture.esp", padding = dir/"DS0gPadding.esp";
  WriteFixture(fixture, false); WriteFixture(padding, true);
  auto goldens = [&](PartOne& testHost, bool shifted) {
    auto& world=testHost.worldState; auto& browser=testHost.GetEspm().GetBrowser();
    auto resolve=[&](const char* key){return FormDesc::FromString(key).ToFormId(world.pluginIndexMapping);};
    // Hand values from winners: race health 12/200/150/12; offsets 0/0/100/0.
    // All four CLAS are 3:0:3, so each gains 5 health + GMST 5 per level.
    // Skills: weights 2,0,2,3,0,0,0,0,0,3,...; GMST skill start 10; wolf/fox Sneak racial +15.
    const std::array<const char*,4> keys{{"23abe:Skyrim.esm","23a8a:Skyrim.esm","23a8b:Skyrim.esm","829b3:Skyrim.esm"}};
    const float hp[4][3]={{12,102,402},{200,290,590},{250,340,640},{12,102,402}};
    const float stamina[4][3]={{200,245,395},{245,290,440},{275,320,470},{20,65,215}};
    const float skills[2][3][4]={{{10,10,10,25},{24,24,32,47},{77,77,100,100}},{{10,10,10,10},{24,24,32,32},{74,74,100,100}}};
    for(size_t n=0;n<keys.size();++n) {
      const auto base=resolve(keys[n]); const auto runtimeChain=LeveledListUtils::EvaluateTemplateChain(browser,browser.LookupById(base),0);
      std::vector<FormDesc> chain;for(auto item:runtimeChain)chain.push_back(FormDesc::FromFormId(item,world.pluginIndexMapping));
      size_t k=0;
      for(uint16_t level:{1,10,40}) {
        const auto values=GetBaseActorValues(&world,base,0,chain,level);
        assertNear(values.health,hp[n][k],"hand-calculated health mismatch"); assertNear(values.magicka,0,"hand-calculated magicka mismatch");
        assertNear(values.stamina,stamina[n][k],"hand-calculated stamina mismatch"); check(values.npcSkills.has_value(),"auto skills missing");
        const auto& s=*values.npcSkills;const auto& expected=skills[n==0||n==3?0:1][k];
        for(size_t j=0;j<18;++j) {
          float value=j==0?expected[0]:j==2?expected[1]:j==3?expected[2]:j==9?expected[3]:10;
          assertNear(s[j],value,"hand-calculated skill mismatch");
        }
        std::cout<<"GOLDEN shifted="<<shifted<<" npc="<<keys[n]<<" level="<<level<<" health="<<values.health<<" magicka="<<values.magicka<<" stamina="<<values.stamina<<" skills=";
        for(auto skill:s)std::cout<<skill<<',';std::cout<<'\n';++k;
      }
    }
  };
  uint32_t previousRoot = 0;
  for (bool shifted : {false, true}) {
    auto paths = original;
    paths.push_back(shifted ? padding : fixture); paths.push_back(shifted ? fixture : padding);
    espm::Loader loader(paths); PartOne host; host.AttachEspm(&loader);
    auto& world = host.worldState; auto& browser = loader.GetBrowser(); auto& cache = world.GetEspmCache();
    auto resolve = [&](const char* key) { return FormDesc::FromString(key).ToFormId(world.pluginIndexMapping); };
    auto portable = [&](uint32_t id) { return FormDesc::FromFormId(id, world.pluginIndexMapping).ToString(); };
    const auto root = resolve("800:DS0gFixture.esp"), low = resolve("802:DS0gFixture.esp"), high = resolve("803:DS0gFixture.esp");
    if (shifted) check(root != previousRoot, "fixture plugin did not move runtime position"); previousRoot = root;
    check(portable(root)=="800:DS0gFixture.esp", "stable key round trip");
    const auto valid=LeveledListUtils::ValidateObservation(browser,root,low,2);
    std::cout<<"FIXTURE root="<<portable(root)<<" found="<<(browser.LookupById(root).rec!=nullptr)<<" result="<<valid.reason<<"\n";
    check(valid.accepted,"valid low-level observation");
    check(LeveledListUtils::ValidateObservation(browser,root,high,12).accepted,"valid high-level observation");
    check(std::string(LeveledListUtils::ValidateObservation(browser,root,resolve("829b3:Skyrim.esm"),2).reason)=="BASE_NOT_REACHABLE","unrelated base accepted");
    check(std::string(LeveledListUtils::ValidateObservation(browser,root,high,2).reason)=="INCOMPATIBLE_LIST_LEVEL","entry level not checked");
    check(LeveledListUtils::ValidateObservation(browser,root,low,12).accepted,"CalculateFromAllLevels ignored");
    check(!LeveledListUtils::ValidateObservation(browser,resolve("804:DS0gFixture.esp"),low,12).accepted,"highest eligible level ignored");
    check(!LeveledListUtils::ValidateObservation(browser,root,low,0).accepted,"zero level accepted");
    check(!LeveledListUtils::ValidateObservation(browser,resolve("809:DS0gFixture.esp"),low,12).accepted,"cyclic graph accepted");

    // SKSE GetTemplate returns GetRootTemplate, losing the selected intermediate
    // NPC when multiple list entries inherit from the same terminal template.
    const auto sharedRoot=resolve("810:DS0gFixture.esp");
    check(LeveledListUtils::ValidateObservation(browser,sharedRoot,resolve("812:DS0gFixture.esp"),12).accepted,
      "selected intermediate NPC should disambiguate list path");
    check(std::string(LeveledListUtils::ValidateObservation(browser,sharedRoot,resolve("814:DS0gFixture.esp"),12).reason)=="AMBIGUOUS_TEMPLATE_CHAIN",
      "terminal template must not invent which list entry was selected");
    const auto cell=resolve("3c:Skyrim.esm");
    const auto first=host.CreateActor(0,{0,0,0},0,cell), second=host.CreateActor(0,{0,0,0},0,cell);
    host.serverState.Connect(0,"ds0g-host"); host.SetUserActor(0,first);
    host.serverState.Connect(1,"ds0g-other"); host.SetUserActor(1,second);
    auto spawn=[&](uint32_t base) -> MpActor& {
      auto id=world.GenerateFormId(); world.AddForm(std::make_unique<MpActor>(LocationalData{{0,0,0},{0,0,0},FormDesc::FromFormId(cell,world.pluginIndexMapping)},host.CreateFormCallbacks(),base),id);
      world.hosters[id]=first; return world.GetFormAt<MpActor>(id);
    };
    auto& actor=spawn(root); const auto id=actor.GetFormId();
    auto probe=std::make_shared<aetherius::combat::CombatProbe>(); aetherius::combat::InstallCombatProbe(probe);
    struct ProbeOff { ~ProbeOff(){aetherius::combat::InstallCombatProbe(nullptr);} } off;
    auto send=[&](int user, std::string base, uint32_t level, uint64_t generation=1) {
      CustomPacketMessage message; message.contentJsonDump=nlohmann::json{{"channel","aetherius.npc.observation"},{"v",1},{"actor",id},{"base",base},{"level",level},{"generation",generation}}.dump();
      RawMessageData raw; raw.userId=user; host.GetActionListener().OnCustomPacket(raw,message);
      return probe->Read()["npcReports"].back()["reason"].get<std::string>();
    };
    check(actor.NeedsNpcObservation()&&!actor.IsNpcConfirmed(),"initial NPC must be unconfirmed");
    const auto before=actor.GetTemplateChain();
    assertNear(actor.GetMaximumValues().health,12,"unconfirmed leveled NPC changed baseline stats");
    check(send(1,"802:DS0gFixture.esp",2)=="NOT_CURRENT_HOSTER","non-hoster accepted");
    check(send(0,"GG:DS0gFixture.esp",2)=="INVALID_BASE_KEY","malformed hex accepted");
    check(send(0,"800:Absent.esp",2)=="BASE_PLUGIN_ABSENT","absent plugin not rejected");
    check(send(0,"803:DS0gFixture.esp",2)=="INCOMPATIBLE_LIST_LEVEL","bad list level accepted");
    check(send(0,"802:DS0gFixture.esp",3)=="INCOMPATIBLE_NPC_LEVEL","fixed NPC level ignored");
    check(actor.GetTemplateChain()==before&&!actor.IsNpcConfirmed(),"rejection mutated actor");
    // New diagnostic channel traverses the real ActionListener with no sockets.
    auto unavailablePacket = [&]() { return nlohmann::json{{"channel","aetherius.npc.observation.unavailable"},
      {"v",1},{"actor",id},{"generation",1},{"reason","RESOLVED_BASE_HAS_NO_STABLE_KEY"}}; };
    auto unavailable = [&](int user, const std::string& dump, const char* expected) {
      const auto state = MpChangeForm::ToJson(actor.GetChangeForm()).dump();
      const auto counts = probe->Read()["counters"];
      CustomPacketMessage message; message.contentJsonDump = dump;
      RawMessageData raw; raw.userId = user; host.GetActionListener().OnCustomPacket(raw,message);
      const auto snapshot = probe->Read();
      check(snapshot["npcUnavailable"].back()["result"] == expected, "wrong unavailable validation");
      check(snapshot["counters"]["npcUnavailable"].get<uint64_t>() == counts.value("npcUnavailable",uint64_t(0))+1,
        "unavailable diagnostic not counted");
      check(snapshot["counters"]["npcReports"] == counts["npcReports"], "diagnostic counted as observation");
      check(snapshot["counters"]["npcRestoreFailures"] == counts["npcRestoreFailures"], "diagnostic counted as restore");
      check(MpChangeForm::ToJson(actor.GetChangeForm()).dump() == state, "diagnostic mutated changeform");
      check(!actor.IsNpcConfirmed() && actor.GetNpcGeneration() == 1 && actor.GetTemplateChain() == before,
        "diagnostic mutated creature context");
    };
    unavailable(0,unavailablePacket().dump(),"ACCEPTED");
    check(probe->Read()["counters"]["npcUnavailableReasons"]["RESOLVED_BASE_HAS_NO_STABLE_KEY"] == 1,
      "accepted unavailable reason missing");
    unavailable(1,unavailablePacket().dump(),"NOT_CURRENT_HOSTER");
    unavailable(7,unavailablePacket().dump(),"NO_SESSION_ACTOR");
    auto bad = unavailablePacket(); bad["extra"]=1; unavailable(0,bad.dump(),"INVALID_PACKET");
    bad=unavailablePacket(); bad.erase("reason"); unavailable(0,bad.dump(),"INVALID_PACKET");
    for (auto field : {"v","actor","generation","reason"}) {
      bad=unavailablePacket(); bad[field]=false; unavailable(0,bad.dump(),"INVALID_PACKET");
    }
    bad=unavailablePacket(); bad["generation"]=0; unavailable(0,bad.dump(),"INVALID_PACKET");
    bad["generation"]=2; unavailable(0,bad.dump(),"STALE_GENERATION");
    bad["generation"]=9007199254740992ull; unavailable(0,bad.dump(),"INVALID_PACKET");
    bad=unavailablePacket(); bad["reason"]="ENGINE_READ_FAILED: private exception"; unavailable(0,bad.dump(),"INVALID_REASON");
    bad=unavailablePacket(); bad["reason"]=std::string(1100,'x'); unavailable(0,bad.dump(),"INVALID_PACKET_SIZE");
    auto duplicateKey=unavailablePacket().dump(); duplicateKey.insert(1,"\"v\":1,");
    unavailable(0,duplicateKey,"INVALID_PACKET");
    bad=unavailablePacket(); bad["actor"]=first; unavailable(0,bad.dump(),"NOT_AN_NPC");
    auto& ordinary=spawn(resolve("23abe:Skyrim.esm"));
    bad=unavailablePacket(); bad["actor"]=ordinary.GetFormId(); unavailable(0,bad.dump(),"NOT_AN_OBSERVABLE_NPC");
    world.hosters[id]=second; unavailable(0,unavailablePacket().dump(),"NOT_CURRENT_HOSTER"); world.hosters[id]=first;
    for (const auto* reason : {"ACTOR_NOT_LOADED","RESOLVED_BASE_ABSENT","INVALID_ENGINE_LEVEL","ENGINE_READ_FAILED","RACE_ABSENT","RACE_HAS_NO_STABLE_KEY"}) {
      bad=unavailablePacket();bad["reason"]=reason;unavailable(0,bad.dump(),"ACCEPTED");
    }
    check(probe->Read()["counters"]["npcUnavailableReasons"]["RESOLVED_BASE_HAS_NO_STABLE_KEY"] == 1,
      "rejected diagnostics polluted accepted reasons");
    // Bounded diagnostic ring, with explicit overwrite; actor remains unchanged.
    for (int i=0;i<260;++i) unavailable(0,unavailablePacket().dump(),"ACCEPTED");
    check(probe->Read()["npcUnavailable"].size()==256 && probe->Read()["counters"]["overwrittenNpcUnavailable"]>0,
      "unavailable ring is not bounded");
    aetherius::combat::InstallCombatProbe(nullptr);
    CustomPacketMessage withoutProbe; withoutProbe.contentJsonDump=unavailablePacket().dump();
    RawMessageData noProbeRaw; noProbeRaw.userId=0; host.GetActionListener().OnCustomPacket(noProbeRaw,withoutProbe);
    check(!actor.IsNpcConfirmed() && actor.GetTemplateChain()==before,"diagnostic without probe mutated actor");
    aetherius::combat::InstallCombatProbe(probe);
    check(send(0,"802:DS0gFixture.esp",2)=="ACCEPTED","current hoster report refused");
    check(actor.IsNpcConfirmed()&&actor.GetNpcLevel()==2,"adoption did not store level");
    check(actor.GetTemplateChain()==std::vector<FormDesc>{FormDesc::FromString("800:DS0gFixture.esp"),FormDesc::FromString("802:DS0gFixture.esp")},"adopted wrong chain");
    assertNear(actor.GetMaximumValues().health,22,"adopted level maximum");
    check(actor.GetNpcSkills().has_value(),"calculated skills unavailable");
    actor.SetIsDead(false); check(actor.IsNpcConfirmed()&&actor.GetNpcGeneration()==1,"redundant alive state invalidated observation");
    check(send(0,"000802:ds0gfixture.ESP",2)=="DUPLICATE","canonical duplicate not recognized");
    world.hosters[id]=second;
    check(send(0,"803:DS0gFixture.esp",12)=="NOT_CURRENT_HOSTER","old hoster accepted after transfer");
    check(send(1,"803:DS0gFixture.esp",12)=="CONFIRMED_CREATURE_CONFLICT","new hoster replaced creature");
    check(send(1,"802:DS0gFixture.esp",2)=="DUPLICATE","new hoster cannot attest same creature");
    const auto saved=actor.GetChangeForm(); const auto encoded=MpChangeForm::ToJson(saved);
    check(encoded.dump().find("DS0gFixture.esp")!=std::string::npos,"stable identities missing from changeform JSON");
    simdjson::dom::parser parser; auto element=parser.parse(encoded.dump()).value();
    auto& restored=spawn(root); auto decoded=MpChangeForm::JsonToChangeForm(element);
    // A second actor is the reload fixture; only its reference identity differs.
    decoded.formDesc=restored.GetChangeForm().formDesc; restored.ApplyChangeForm(decoded);
    check(restored.IsNpcConfirmed()&&restored.GetNpcLevel()==2&&restored.GetTemplateChain()==actor.GetTemplateChain(),"changeform round-trip lost adopted choice");
    assertNear(restored.GetMaximumValues().health,22,"restored maximum mismatch");
    // Corrupt/stale persisted observations never abort ApplyChangeForm. These
    // are real actors/records; no socket or production substitute is involved.
    auto restoreInvalid = [&](const std::string& badDump, const char* reason,
                              uint64_t generation, bool absentChain = false) {
      auto& reloaded = spawn(root);
      auto bad = saved; bad.formDesc = reloaded.GetChangeForm().formDesc;
      bad.dynamicFields.SetValueDump("private.aetheriusNpcObservation", badDump);
      if (absentChain) bad.templateChain.back() = FormDesc::FromString("802:Absent.esp");
      const auto countersBefore = probe->Read()["counters"];
      reloaded.ApplyChangeForm(bad); // Any escaping exception fails this test.
      check(!reloaded.IsNpcConfirmed() && reloaded.NeedsNpcObservation(), "invalid restore stayed confirmed");
      check(reloaded.GetNpcGeneration() == generation, "invalid restore did not advance generation");
      assertNear(reloaded.GetMaximumValues().health, 12, "invalid restore did not return to baseline");
      const auto clean = reloaded.GetChangeForm();
      const auto marker = nlohmann::json::parse(clean.dynamicFields.GetValueDump("private.aetheriusNpcObservation"));
      check(marker == nlohmann::json{{"generation", generation}}, "old persisted choice retained");
      for (const auto& key : clean.templateChain)
        check(key.file != "Absent.esp" && key.ToString() != "829b3:Skyrim.esm", "invalid template chain retained");
      const auto countersAfter = probe->Read()["counters"];
      check(countersAfter["npcRestoreFailures"].get<uint64_t>() == countersBefore["npcRestoreFailures"].get<uint64_t>() + 1,
        "restore failure not counted");
      check(countersAfter["npcRestoreFailureReasons"][reason].get<uint64_t>() ==
        countersBefore["npcRestoreFailureReasons"].value(reason, uint64_t(0)) + 1, "restore reason not counted");
      check(countersAfter["npcReports"] == countersBefore["npcReports"], "restore counted as received wire report");
      check(MpChangeForm::ToJson(clean).is_object(), "cleaned changeform cannot be serialized");
      // The cleaned changeform loads again without another failure/generation.
      auto& cleanReload = spawn(root); auto next = clean; next.formDesc = cleanReload.GetChangeForm().formDesc;
      cleanReload.ApplyChangeForm(next);
      check(!cleanReload.IsNpcConfirmed() && cleanReload.GetNpcGeneration() == generation, "clean marker did not survive reload");
      check(probe->Read()["counters"]["npcRestoreFailures"] == countersAfter["npcRestoreFailures"], "clean reload counted a failure");
      CustomPacketMessage message;
      message.contentJsonDump = nlohmann::json{{"channel","aetherius.npc.observation"},{"v",1},
        {"actor",reloaded.GetFormId()},{"base","803:DS0gFixture.esp"},{"level",12},{"generation",generation}}.dump();
      RawMessageData raw; raw.userId = 0; host.GetActionListener().OnCustomPacket(raw, message);
      check(probe->Read()["npcReports"].back()["reason"] == "ACCEPTED", "valid report after invalid restore refused");
      check(reloaded.IsNpcConfirmed() && reloaded.GetNpcLevel() == 12, "post-restore report not adopted");
      assertNear(reloaded.GetMaximumValues().health, 122, "post-restore adopted maximum mismatch");
      std::cout << "RESTORE shifted=" << shifted << " reason=" << reason << " generation=" << generation << " recovered=1\n";
    };
    restoreInvalid(nlohmann::json{{"base","829b3:Skyrim.esm"},{"level",2},{"generation",7}}.dump(), "BASE_NOT_REACHABLE", 8);
    restoreInvalid("{invalid JSON", "INVALID_PERSISTED_NPC_OBSERVATION", 2);
    restoreInvalid(nlohmann::json{{"base","802:Absent.esp"},{"level",2},{"generation",9}}.dump(), "BASE_PLUGIN_ABSENT", 10, true);
    restoreInvalid(nlohmann::json{{"base","802:DS0gFixture.esp"},{"level",3},{"generation",11}}.dump(), "INCOMPATIBLE_NPC_LEVEL", 12);
    restoreInvalid(nlohmann::json{{"base",false},{"level",2},{"generation",13}}.dump(), "INVALID_PERSISTED_NPC_OBSERVATION", 14);
    restoreInvalid(nlohmann::json{{"base","802:DS0gFixture.esp"},{"level",uint64_t(1) << 32},{"generation",15}}.dump(), "INVALID_PERSISTED_NPC_OBSERVATION", 16);
    restoreInvalid(nlohmann::json{{"base",false},{"generation",std::numeric_limits<uint64_t>::max()}}.dump(), "INVALID_PERSISTED_NPC_OBSERVATION", 1);
    {
      auto& twice = spawn(root);
      auto bad = twice.GetChangeForm();
      bad.dynamicFields.SetValueDump("private.aetheriusNpcObservation", "{invalid");
      std::ostringstream warningLog;
      auto sink = std::make_shared<spdlog::sinks::ostream_sink_mt>(warningLog);
      auto logger = std::make_shared<spdlog::logger>("ds0g-restore-warning", sink);
      logger->set_level(spdlog::level::warn);
      struct RestoreLogger {
        std::shared_ptr<spdlog::logger> previous;
        ~RestoreLogger() { spdlog::set_default_logger(previous); }
      } restoreLogger{spdlog::default_logger()};
      spdlog::set_default_logger(logger);
      twice.ApplyChangeForm(bad);
      check(twice.GetNpcGeneration() == 2, "malformed first generation mismatch");
      twice.ApplyChangeForm(bad);
      check(!twice.IsNpcConfirmed() && twice.GetNpcGeneration() == 3, "malformed reload reused generation");
      const auto warning = warningLog.str();
      const auto pos = warning.find("MpActor::RestoreNpcObservation");
      check(pos != std::string::npos && warning.find("MpActor::RestoreNpcObservation", pos + 1) == std::string::npos,
        "restore warning must appear once per actor");
      check(warning.find("INVALID_PERSISTED_NPC_OBSERVATION") != std::string::npos, "warning omitted reason");
      aetherius::combat::InstallCombatProbe(nullptr);
      auto& withoutProbe = spawn(root); bad.formDesc = withoutProbe.GetChangeForm().formDesc;
      withoutProbe.ApplyChangeForm(bad);
      check(!withoutProbe.IsNpcConfirmed() && withoutProbe.GetNpcGeneration() == 2, "recovery depends on probe");
      check(std::string(withoutProbe.AdoptNpcObservation(FormDesc::FromString("802:DS0gFixture.esp"), 2, 2)) == "ACCEPTED",
        "valid report after recovery without probe refused");
      aetherius::combat::InstallCombatProbe(probe);
    }
    // The real respawn path sends the new generation and clears confirmation.
    actor.SetIsDead(true); actor.SetIsDead(false);
    check(!actor.IsNpcConfirmed()&&actor.GetNpcGeneration()==2,"respawn retained confirmation/generation");
    check(send(1,"802:DS0gFixture.esp",2,1)=="STALE_GENERATION","stale pre-respawn report accepted");
    check(send(1,"803:DS0gFixture.esp",12,2)=="ACCEPTED","respawn cannot adopt a new creature");
    check(actor.GetNpcStatsProvider()==FormDesc::FromString("803:DS0gFixture.esp"),"stats provider does not follow adopted chain");
    auto& pcActor=spawn(resolve("808:DS0gFixture.esp"));
    check(pcActor.NeedsNpcObservation()&&!pcActor.IsNpcConfirmed(),"PC mult NPC not marked observable");
    check(std::string(pcActor.AdoptNpcObservation(FormDesc::FromString("808:DS0gFixture.esp"),4,1))=="INCOMPATIBLE_NPC_LEVEL","PC min not checked");
    check(std::string(pcActor.AdoptNpcObservation(FormDesc::FromString("808:DS0gFixture.esp"),21,1))=="INCOMPATIBLE_NPC_LEVEL","PC max not checked");
    check(std::string(pcActor.AdoptNpcObservation(FormDesc::FromString("808:DS0gFixture.esp"),10,1))=="ACCEPTED","PC mult valid level rejected");
    assertNear(pcActor.GetMaximumValues().health,102,"PC mult level not used in auto calc");

    // v2 enumerates structural LVLN paths, never uses creature level as pcLevel.
    const auto bearRace=resolve("131e7:Skyrim.esm"), caveRace=resolve("131e8:Skyrim.esm");
    const auto uniqueRoot=resolve("820:DS0gFixture.esp");
    const auto unique=LeveledListUtils::ValidateRaceObservation(browser,uniqueRoot,bearRace,12);
    check(unique.accepted&&unique.candidates==1,"unique race observation refused");
    check(unique.chain==std::vector<uint32_t>{uniqueRoot,resolve("822:DS0gFixture.esp"),resolve("824:DS0gFixture.esp")},"wrong v2 chain");
    check(LeveledListUtils::ValidateRaceObservation(browser,uniqueRoot,caveRace,12).accepted,"cave race not distinguished");
    check(LeveledListUtils::ValidateRaceObservation(browser,resolve("830:DS0gFixture.esp"),bearRace,12).accepted,"UseTraits provider ignored");
    const auto ambiguousRoot=resolve("840:DS0gFixture.esp");
    const auto ambiguous=LeveledListUtils::ValidateRaceObservation(browser,ambiguousRoot,bearRace,12);
    check(!ambiguous.accepted&&ambiguous.candidates==2&&std::string(ambiguous.reason)=="AMBIGUOUS_OBSERVATION","ambiguous paths guessed");
    check(LeveledListUtils::ValidateRaceObservation(browser,resolve("850:DS0gFixture.esp"),bearRace,12).candidates==1,"repeated identical chain treated as ambiguous");
    check(std::string(LeveledListUtils::ValidateRaceObservation(browser,uniqueRoot,bearRace,11).reason)=="NO_MATCHING_OBSERVATION","incompatible fixed level accepted");
    check(std::string(LeveledListUtils::ValidateRaceObservation(browser,uniqueRoot,resolve("13201:Skyrim.esm"),12).reason)=="NO_MATCHING_OBSERVATION","unreachable race accepted");
    check(std::string(LeveledListUtils::ValidateRaceObservation(browser,uniqueRoot,root,12).reason)=="NOT_A_RACE","NPC key used as race");
    check(!LeveledListUtils::ValidateRaceObservation(browser,uniqueRoot,bearRace,0).accepted,"v2 level zero accepted");
    check(std::string(LeveledListUtils::ValidateRaceObservation(browser,resolve("809:DS0gFixture.esp"),bearRace,12).reason)=="UNSUPPORTED_TEMPLATE_GRAPH","v2 cycle accepted");
    check(LeveledListUtils::ValidateRaceObservation(browser,root,resolve("1320a:Skyrim.esm"),2).accepted,"same race not disambiguated by fixed level");
    const auto pcRoot=resolve("808:DS0gFixture.esp"), wolfRace=resolve("1320a:Skyrim.esm");
    check(!LeveledListUtils::ValidateRaceObservation(browser,pcRoot,wolfRace,4).accepted,"v2 PC min ignored");
    check(LeveledListUtils::ValidateRaceObservation(browser,pcRoot,wolfRace,10).accepted,"v2 PC range refused");
    check(!LeveledListUtils::ValidateRaceObservation(browser,pcRoot,wolfRace,21).accepted,"v2 PC max ignored");
    auto& observed=spawn(uniqueRoot);
    auto v2packet=[&]() {return nlohmann::json{{"channel","aetherius.npc.observation"},{"v",2},{"actor",observed.GetFormId()},
      {"race","131e7:Skyrim.esm"},{"level",12},{"generation",1}};};
    auto sendV2=[&](int user,const std::string& dump,const char* expected,int candidateCount=-1) {
      const auto state=MpChangeForm::ToJson(observed.GetChangeForm()).dump();
      const auto counts=probe->Read()["counters"];
      CustomPacketMessage message;message.contentJsonDump=dump;RawMessageData raw;raw.userId=user;
      host.GetActionListener().OnCustomPacket(raw,message);
      const auto view=probe->Read();const auto row=view["npcReports"].back();
      check(row["reason"]==expected,"wrong v2 packet result");
      if(candidateCount>=0)check(row["candidates"]==candidateCount,"wrong v2 candidate count");
      check(view["counters"]["npcReportVersions"]["v1"]==counts["npcReportVersions"]["v1"],"v2 polluted v1 counters");
      if(std::string(expected)!="ACCEPTED")check(MpChangeForm::ToJson(observed.GetChangeForm()).dump()==state,"v2 rejection/duplicate mutated actor");
    };
    sendV2(1,v2packet().dump(),"NOT_CURRENT_HOSTER");sendV2(7,v2packet().dump(),"NO_SESSION_ACTOR");
    auto vbad=v2packet();vbad["actor"]=first;sendV2(0,vbad.dump(),"NOT_AN_NPC");
    vbad=v2packet();vbad["actor"]=ordinary.GetFormId();sendV2(0,vbad.dump(),"NOT_AN_OBSERVABLE_NPC");
    world.hosters[observed.GetFormId()]=second;sendV2(0,v2packet().dump(),"NOT_CURRENT_HOSTER");world.hosters[observed.GetFormId()]=first;
    for(const auto* field:{"v","actor","race","level","generation"}) {vbad=v2packet();vbad[field]=false;sendV2(0,vbad.dump(),"INVALID_PACKET");}
    vbad=v2packet();vbad["root"]="824:DS0gFixture.esp";sendV2(0,vbad.dump(),"INVALID_PACKET");
    vbad=v2packet();vbad["base"]="822:DS0gFixture.esp";sendV2(0,vbad.dump(),"INVALID_PACKET");
    vbad=v2packet();vbad.erase("race");sendV2(0,vbad.dump(),"INVALID_PACKET");
    auto dup=v2packet().dump();dup.insert(1,"\"v\":2,");sendV2(0,dup,"INVALID_PACKET");
    for(const auto* field:{"level","generation"}) {vbad=v2packet();vbad[field]=0;sendV2(0,vbad.dump(),"INVALID_PACKET");}
    vbad=v2packet();vbad["generation"]=9007199254740992ull;sendV2(0,vbad.dump(),"INVALID_PACKET");
    vbad=v2packet();vbad["generation"]=2;sendV2(0,vbad.dump(),"STALE_GENERATION");
    vbad=v2packet();vbad["race"]="bad:key:format";sendV2(0,vbad.dump(),"INVALID_RACE_KEY");
    vbad=v2packet();vbad["race"]="1320a:Absent.esp";sendV2(0,vbad.dump(),"RACE_PLUGIN_ABSENT");
    vbad=v2packet();vbad["race"]="800:DS0gFixture.esp";sendV2(0,vbad.dump(),"NOT_A_RACE",0);
    vbad=v2packet();vbad["race"]="13201:Skyrim.esm";sendV2(0,vbad.dump(),"NO_MATCHING_OBSERVATION",0);
    vbad=v2packet();vbad["race"]=std::string(1100,'x');sendV2(0,vbad.dump(),"INVALID_PACKET_SIZE");
    auto& ambActor=spawn(ambiguousRoot);vbad=v2packet();vbad["actor"]=ambActor.GetFormId();
    const auto ambBefore=MpChangeForm::ToJson(ambActor.GetChangeForm()).dump();sendV2(0,vbad.dump(),"AMBIGUOUS_OBSERVATION",2);
    check(MpChangeForm::ToJson(ambActor.GetChangeForm()).dump()==ambBefore&&!ambActor.IsNpcConfirmed(),"ambiguity adopted chain");
    sendV2(0,v2packet().dump(),"ACCEPTED",1);check(observed.IsNpcConfirmed()&&observed.GetNpcLevel()==12,"v2 not confirmed");
    check(observed.GetNpcTraitsProvider()==FormDesc::FromString("822:DS0gFixture.esp"),"v2 wrong traits provider");
    check(observed.GetNpcStatsProvider()==FormDesc::FromString("824:DS0gFixture.esp"),"v2 wrong stats provider");
    vbad=v2packet();vbad["race"]="0131E7:skyrim.ESM";sendV2(0,vbad.dump(),"DUPLICATE",1);
    vbad=v2packet();vbad["race"]="131e8:Skyrim.esm";sendV2(0,vbad.dump(),"CONFIRMED_CREATURE_CONFLICT",1);
    const auto v2saved=observed.GetChangeForm();auto& v2reload=spawn(uniqueRoot);auto copy=v2saved;copy.formDesc=v2reload.GetChangeForm().formDesc;
    v2reload.ApplyChangeForm(copy);check(v2reload.IsNpcConfirmed()&&v2reload.GetTemplateChain()==observed.GetTemplateChain(),"v2 restore lost unique chain with shared terminal");
    check(v2saved.dynamicFields.GetValueDump("private.aetheriusNpcObservation").find("131e7:Skyrim.esm")!=std::string::npos,"v2 stable race not persisted");
    copy.dynamicFields.SetValueDump("private.aetheriusNpcObservation",nlohmann::json{{"v",2},{"race","13201:Skyrim.esm"},{"base","824:DS0gFixture.esp"},{"level",12},{"generation",4}}.dump());
    auto& invalidV2=spawn(uniqueRoot);copy.formDesc=invalidV2.GetChangeForm().formDesc;invalidV2.ApplyChangeForm(copy);
    check(!invalidV2.IsNpcConfirmed()&&invalidV2.GetNpcGeneration()==5,"invalid v2 restore trusted stale choice");
    observed.SetIsDead(true);sendV2(0,v2packet().dump(),"NPC_DEAD");observed.SetIsDead(false);
    sendV2(0,v2packet().dump(),"STALE_GENERATION");vbad=v2packet();vbad["generation"]=observed.GetNpcGeneration();sendV2(0,vbad.dump(),"ACCEPTED",1);
    // Actual winners checked against houseCARL, instance C:/modOrganizer.
    for(const auto& pair:std::array<std::pair<const char*,uint32_t>,6>{{{"13201:Skyrim.esm",1},{"1320a:Skyrim.esm",2},{"53477:Skyrim.esm",6},{"131e7:Skyrim.esm",12},{"13205:Skyrim.esm",14},{"131e8:Skyrim.esm",16}}}) {
      const auto result=LeveledListUtils::ValidateRaceObservation(browser,resolve("1e7a0:Skyrim.esm"),resolve(pair.first),pair.second);
      check(result.accepted&&result.candidates==1,"actual predator winners not unique by race+level");
      std::cout<<"PREDATOR shifted="<<shifted<<" race="<<pair.first<<" level="<<pair.second<<" candidates="<<result.candidates<<" result="<<result.reason<<'\n';
    }

    goldens(host, shifted);
  }
  // Move Skyrim and every original plugin by inserting a master-free plugin.
  // No actors/player-hardcoded paths in this record-only phase.
  {
    auto paths=original;paths.insert(paths.begin(),padding);
    espm::Loader loader(paths);PartOne host;host.AttachEspm(&loader);
    check(host.worldState.pluginIndexMapping.GetEspmFileIndexByFilename("Skyrim.esm")>0,"Skyrim did not move for golden records");
    goldens(host,true);
  }
  std::cout<<"PASS DS-0g "<<count<<" native checks, fixture plugin moved, no sockets\n";
}
