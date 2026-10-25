#pragma once
// DS-0k: binary test plugins in TEMP, parsed by the real Loader/PartOne.
// Field layouts: libespm NPC_.cpp, WEAP.h, LeveledListBase.h, OTFT.cpp.
// No production double, game installation, sockets or settings edits.
#include "PartOne.h"
#include "ActionListener.h"
#include "HitMessage.h"
#include "aetherius_combat/CombatProbe.h"
#include "EvaluateTemplate.h"
#include "formulas/TES5DamageFormula.h"
#include <fstream>
#include <iostream>
#include <filesystem>
#include <limits>

std::vector<espm::CONT::ContainerObject> GetInventoryObjects(
  WorldState*, const std::vector<FormDesc>&, const espm::LookupResult&);

namespace ds0k {
using Bytes = std::string;
template<class T> Bytes Bin(T value) { return Bytes(reinterpret_cast<const char*>(&value), sizeof(value)); }
inline Bytes Field(const char* name, const Bytes& bytes) {
  return Bytes(name,4) + Bin(static_cast<uint16_t>(bytes.size())) + bytes;
}
inline Bytes Record(const char* type, uint32_t id, const Bytes& fields) {
  return Bytes(type,4) + Bin(static_cast<uint32_t>(fields.size())) + Bin(uint32_t{0}) + Bin(id) +
    Bin(uint32_t{0}) + Bin(uint16_t{44}) + Bin(uint16_t{0}) + fields;
}
inline Bytes Header(std::initializer_list<const char*> masters) {
  Bytes fields = Field("HEDR", Bin(1.7f) + Bin(uint32_t{16}) + Bin(uint32_t{0x900}));
  for (auto name : masters) fields += Field("MAST", Bytes(name)+char{0}) + Field("DATA", Bin(uint64_t{0}));
  return Record("TES4",0,fields);
}
// Relative IDs belong to a fixture plugin's master namespace, never runtime slots.
inline uint32_t Local(unsigned masterCount, uint32_t id) { return (masterCount << 24) | id; }
inline Bytes List(uint32_t id, uint32_t item) {
  return Record("LVLI",id,Field("LVLD",Bin(uint8_t{0}))+Field("LVLF",Bin(uint8_t{4}))+
    Field("LLCT",Bin(uint8_t{1}))+Field("LVLO",Bin(uint32_t{1})+Bin(item)+Bin(uint32_t{1})));
}
inline Bytes Npc(uint32_t id, uint32_t item, uint32_t outfit, uint32_t death, uint32_t parent=0) {
  Bytes acbs(24,0); uint16_t level=1, flags=parent ? espm::NPC_::UseInventory : 0; int16_t health=100;
  std::memcpy(acbs.data()+8,&level,2); std::memcpy(acbs.data()+18,&flags,2); std::memcpy(acbs.data()+20,&health,2);
  Bytes fields=Field("ACBS",acbs)+Field("RNAM",Bin(uint32_t{0x13746}))+Field("DOFT",Bin(outfit))+Field("INAM",Bin(death));
  if(item) fields+=Field("CNTO",Bin(item)+Bin(uint32_t{2}));
  if(parent) fields+=Field("TPLT",Bin(parent));
  return Record("NPC_",id,fields);
}
inline Bytes Weapon(uint32_t id, int16_t damage) {
  espm::WEAP::WeapData data{}; data.damage=damage;
  espm::WEAP::DNAM dnam{}; dnam.animType=espm::WEAP::AnimType::OneHandSword; dnam.speed=1; dnam.reach=1;
  return Record("WEAP",id,Field("DATA",Bin(data))+Field("DNAM",Bin(dnam)));
}
struct Files {
  std::filesystem::path dir;
  explicit Files(bool nested, bool death) {
    dir=std::filesystem::temp_directory_path()/ ("aetherius-ds0k-"+std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    std::filesystem::create_directories(dir);
    const auto own=[](uint32_t id){return Local(1,id);};
    Save("Filler.esp",Header({"Skyrim.esm"}));
    Save("Provider.esp",Header({"Skyrim.esm"})+Weapon(own(0x801),30)+
      List(own(0x810),own(0x811))+List(own(0x811),own(0x801))+
      Record("OTFT",own(0x804),Field("INAM",Bin(uint32_t{0x12e46})))+
      List(own(0x805),0x12e46)+Record("SPEL",own(0x803),{})+Record("SPEL",own(0xc5f2),{})+
      Npc(own(0x800),own(nested?0x810:0x801),own(0x804),death?own(0x805):0));
    Save("Root.esp",Header({"Skyrim.esm","Provider.esp"})+
      Npc(Local(2,0x800),0,0,death?own(0x805):0,own(0x800)));
  }
  void Save(const char* name,const Bytes& bytes){std::ofstream f(dir/name,std::ios::binary);f.write(bytes.data(),bytes.size());if(!f)throw std::runtime_error("fixture write failed");}
  ~Files(){std::error_code e;std::filesystem::remove_all(dir,e);}
};
}
inline void RunNpcEquipmentTests(const std::filesystem::path& manifestPath, bool namespaceOnly=false) {
  using namespace ds0k; using aetherius::combat::CombatProbe;
  std::cout<<std::unitbuf; int checks=0, passedCases=0, failedCases=0;
  const char* stage="namespace";
  auto check=[&](bool condition,const char* why){++checks;if(!condition)throw std::runtime_error("NPC equipment check "+std::to_string(checks)+": "+why);};
  for(bool reordered:{false,true}) for(bool nested:{false,true}) for(bool death:{false,true}) {
    stage="namespace";
    try {
    Files files(nested,death);
    std::vector<std::filesystem::path> paths{manifestPath.parent_path()/"Skyrim.esm"};
    if(reordered)paths.push_back(files.dir/"Filler.esp");
    paths.push_back(files.dir/"Provider.esp");paths.push_back(files.dir/"Root.esp");
    if(!reordered)paths.push_back(files.dir/"Filler.esp");
    espm::Loader loader(paths); PartOne host; host.AttachEspm(&loader);
    host.SetDamageFormula(std::make_unique<TES5DamageFormula>());
    auto resolve=[&](const char* key){return FormDesc::FromString(key).ToFormId(host.worldState.pluginIndexMapping);};
    const auto root=resolve("800:Root.esp"), provider=resolve("800:Provider.esp"), weapon=resolve("801:Provider.esp");
    const std::vector<FormDesc> chain{FormDesc::FromString("800:Root.esp"),FormDesc::FromString("800:Provider.esp")};
    const auto lookup=loader.GetBrowser().LookupById(provider);
    const auto raw=espm::Convert<espm::NPC_>(lookup.rec)->GetData(host.worldState.GetEspmCache()).objects.at(0);
    const auto actual=GetInventoryObjects(&host.worldState,chain,loader.GetBrowser().LookupById(root));
    const auto expected=lookup.ToGlobalId(raw.formId);
    std::cout<<"NAMESPACE reordered="<<reordered<<" nested="<<nested<<" raw="<<raw.formId<<" expected="<<expected<<" actual="<<actual.at(0).formId<<'\n';
    check(actual.size()==1 && actual[0].formId==expected && actual[0].count==raw.count,"CNTO not resolved in UseInventory provider namespace");
    if(namespaceOnly) { ++passedCases; continue; }
    stage="initialization";
    // Real host initialization, authoritative inventory and equipment.
    const auto playerId=host.worldState.GenerateFormId(), npcId=host.worldState.GenerateFormId();
    host.CreateActor(playerId,{0,0,0},0,0x3c);
    host.worldState.AddForm(std::make_unique<MpActor>(LocationalData{{0,0,0},{0,0,0},FormDesc::Tamriel()},host.CreateFormCallbacks(),root),npcId);
    auto& npc=host.worldState.GetFormAt<MpActor>(npcId);auto& player=host.worldState.GetFormAt<MpActor>(playerId);
    host.serverState.Connect(0,"DS-0k-hoster");host.SetUserActor(0,playerId);
    host.worldState.hosters[npcId]=playerId;MpObjectReference::Subscribe(&npc,&player);
    check(npc.GetInventory().HasItem(weapon),"weapon absent from initialized host inventory");
    check(npc.GetEquipment().inv.HasItem(weapon),"CNTO-only weapon not initially equipped");
    check(npc.GetInventory().GetItemCount(weapon)==(nested?1:2),"CNTO count changed");
    stage="respawn";
    // Native respawn uses spawnPoint, distinct from the initial position.
    npc.SetSpawnPoint(LocationalData{{0,0,0},{0,0,0},FormDesc::Tamriel()});
    auto probe=std::make_shared<CombatProbe>();aetherius::combat::InstallCombatProbe(probe);
    // Reproduce the colliding counter: rebuilt outfit zero + EquipBestWeapon one.
    auto eq=npc.GetEquipment();eq.numChanges=1;npc.SetEquipment(eq);
    const auto generation=npc.GetNpcGeneration();npc.SetRespawnTime(0);npc.SetIsDead(true);
    host.Messages().clear();npc.RespawnWithDelay(false);host.Tick();
    check(!npc.IsDead(),"native respawn timer did not fire");
    check(npc.GetNpcGeneration()==generation,"fixed-base NPC generation changed unexpectedly");
    check(npc.GetEquipment().inv.HasItem(weapon),"weapon absent after native respawn");
    check(npc.GetEquipment().numChanges==(death?2:1),"equipment counter collision or preserved-branch mutation");
    size_t publications=0;
    for(const auto& msg:host.Messages())if(msg.j.value("t",-1)==static_cast<int>(MsgType::UpdateEquipment)) {
      ++publications;check(msg.reliable && msg.userId==0,"equipment publication not reliable to subscriber");
      check(msg.j.at("data").at("numChanges")==2,"published stale equipment counter");
      check(msg.j.at("idx")==npc.GetIdx(),"wrong published actor index");
      check(Equipment::FromJson(msg.j.at("data")).inv.HasItem(weapon),"published equipment omitted weapon");
    }
    check(publications==(death?1:0),"missing/duplicate respawn equipment publication");
    const auto rows=probe->Read()["counters"]["npcEquipment"]["samples"];
    check(rows.front()["phase"]=="BEFORE_DEATH" && rows.back()["phase"]=="AFTER_RESPAWN","lifecycle probe missing");
    check(rows.front()["generation"]==generation && rows.back()["generation"]==npc.GetNpcGeneration(),"lifecycle generation mislabeled");
    check(rows.back()["hoster"]==playerId,"probe hoster missing");
    check(rows.back()["inventoryWeapons"][0]["key"]=="801:Provider.esp","stable weapon key missing after plugin reorder");
    check(rows.back()["inventoryWeapons"][0]["count"]==(nested?1:2),"probe weapon count");
    bool hand=false;for(const auto& i:rows.back()["equipment"])if(i["key"]=="801:Provider.esp")hand=i["hand"]=="RIGHT";
    check(hand,"probe did not capture equipped hand");
    stage="source-authority";
    // Source authority is unchanged: missing weapon, trigger and cloak refused.
    RawMessageData rawMessage;rawMessage.userId=0;
    for(const char* key:{"1397e:Skyrim.esm","803:Provider.esp","c5f2:Provider.esp"}) {
      HitMessage hit;hit.data.aggressor=npcId;hit.data.target=playerId;hit.data.source=resolve(key);
      const auto before=player.GetActorValues().healthPercentage;
      host.GetActionListener().OnHit(rawMessage,hit);
      const auto snapshot=probe->Read();
      check(snapshot["rejections"].back()["reason"]=="WEAPON_NOT_EQUIPPED","forged or magical source authorized");
      check(player.GetActorValues().healthPercentage==before,"refused source changed health");
      check(snapshot["rejections"].back()["npcEquipmentSequence"]==snapshot["counters"]["npcEquipment"]["samples"].back()["sequence"],"rejection equipment not linked");
    }
    HitMessage genuine;genuine.data.aggressor=npcId;genuine.data.target=playerId;genuine.data.source=weapon;
    const auto healthBefore=player.GetActorValues().healthPercentage;
    host.GetActionListener().OnHit(rawMessage,genuine);
    check(player.GetActorValues().healthPercentage<healthBefore,"host-equipped weapon did not damage target after respawn");
    // Bounded retention and complete explicit truncation, never silent loss.
    for(int i=0;i<70;++i)probe->RecordNpcEquipment(npc,"TEST",1000+i);
    auto bounded=probe->Read()["counters"]["npcEquipment"];
    check(bounded["samples"].size()==64 && bounded["overwritten"].get<int>()>0,"NPC equipment retention unbounded");
    aetherius::combat::InstallCombatProbe(nullptr);
    ++passedCases;
    std::cout<<"PASS CASE reordered="<<reordered<<" nested="<<nested<<" rebuild="<<death<<'\n';
    } catch(const std::exception& e) {
      ++failedCases;
      aetherius::combat::InstallCombatProbe(nullptr);
      std::cout<<"FAIL CASE reordered="<<reordered<<" nested="<<nested<<" rebuild="<<death
        <<" stage="<<stage<<" reason="<<e.what()<<'\n';
    }
  }
  std::cout<<"MATRIX passed="<<passedCases<<" failed="<<failedCases<<" checks="<<checks<<'\n';
  if(failedCases)throw std::runtime_error("NPC equipment matrix has failing cases");
  std::cout<<"PASS NPC equipment "<<checks<<" checks"<<'\n';
}
