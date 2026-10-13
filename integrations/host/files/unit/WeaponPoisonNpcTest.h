#pragma once
#include "FormCallbacks.h"

// FIX-1010 reproduction: actual winning NPC, PartOne transport, no sockets.
inline void RunWeaponPoisonNpcTests(const std::filesystem::path& manifestPath) {
  std::cout << std::unitbuf;
  std::ifstream in(manifestPath); nlohmann::json manifest; in >> manifest;
  std::vector<std::filesystem::path> paths;
  for (const auto& p : manifest.at("plugins")) paths.push_back(manifestPath.parent_path()/p.at("filename").get<std::string>());
  espm::Loader loader(paths); PartOne host; host.AttachEspm(&loader); host.SetDamageFormula(Legacy());
  auto resolve=[&](const char* key){return FormDesc::FromString(key).ToFormId(host.worldState.pluginIndexMapping);};
  auto cell=resolve("3c:Skyrim.esm"), base=resolve("422b4:Skyrim.esm"), dagger=resolve("1397e:Skyrim.esm");
  auto record=loader.GetBrowser().LookupById(base); auto npc=espm::Convert<espm::NPC_>(record.rec);
  if(!npc)throw std::runtime_error("FIX-1010 actual NPC absent");
  auto data=npc->GetData(host.worldState.GetEspmCache());
  std::cout << "NPC key=422b4:Skyrim.esm winner=" << paths.at(record.GetSourceId()).filename()
    << " race=" << FormDesc::FromFormId(record.ToGlobalId(data.race),host.worldState.pluginIndexMapping).ToString() << '\n';
  const auto playerId=host.CreateActor(0,{0,0,0},0,cell);
  const auto npcId=host.worldState.GenerateFormId();
  host.worldState.AddForm(std::make_unique<MpActor>(LocationalData{{0,0,0},{0,0,0},FormDesc::FromFormId(cell,host.worldState.pluginIndexMapping)},host.CreateFormCallbacks(),base),npcId);
  auto& player=host.worldState.GetFormAt<MpActor>(playerId); auto& creature=host.worldState.GetFormAt<MpActor>(npcId);
  const auto otherId=host.worldState.GenerateFormId();
  host.worldState.AddForm(std::make_unique<MpActor>(LocationalData{{0,0,0},{0,0,0},FormDesc::FromFormId(cell,host.worldState.pluginIndexMapping)},host.CreateFormCallbacks(),base),otherId);
  auto& other=host.worldState.GetFormAt<MpActor>(otherId);
  std::cout << "NPC effective race=" << FormDesc::FromFormId(creature.GetRaceId(),host.worldState.pluginIndexMapping).ToString() << " (UseTraits template resolution)\n";
  host.serverState.Connect(0,"FIX-1010"); host.SetUserActor(0,playerId); host.worldState.hosters[npcId]=playerId;
  host.worldState.hosters[otherId]=playerId;
  RawMessageData raw; raw.userId=0; int checks=0;
  auto check=[&](bool ok,const char* why){++checks;if(!ok)throw std::runtime_error(why);};
  const std::vector<uint32_t> sources={resolve("1f4:Skyrim.esm"),dagger,0,resolve("ffffff:Skyrim.esm"),0xfd123456,0xff123456};
  std::map<std::tuple<int,int,uint32_t>,float> offHealth;
  aetherius::combat::AetheriusDamageFormula candidate(loader.GetBrowser(),{
    aetherius::combat::StableFormKey::Parse("Skyrim.esm:01397E")});
  for(bool enabled:{false,true})for(int direction=0;direction<3;++direction)for(int state=0;state<3;++state)for(auto source:sources){
    host.worldState.aetheriusWeaponPoison=false;
    auto& aggressor=direction==2?player:creature;auto& target=direction==0?player:other;
    if(aggressor.IsDead())aggressor.SetIsDead(false);
    if(target.IsDead())target.SetIsDead(false);
    target.SetInventory(Inventory{});target.SetEquipment(Equipment{});
    Inventory inv; Equipment eq;
    if(state!=2)inv.AddItem(dagger,1);
    if(state==0) {auto e=Worn(dagger);eq.inv.entries.push_back(e);}
    aggressor.SetInventory(inv);aggressor.SetEquipment(eq);target.RemoveAllMagicEffects();
    auto values=target.GetChangeForm().actorValues;values.healthPercentage=1;target.SetPercentages(values);
    for(auto id:{playerId,npcId,otherId})aggressor.SetLastHitTime(id,std::chrono::steady_clock::now()-std::chrono::seconds(10));
    const auto before=aggressor.GetInventory();host.worldState.aetheriusWeaponPoison=enabled;
    HitMessage msg;msg.data.aggressor=direction==2?0x14:npcId;msg.data.target=target.GetFormId();msg.data.source=source;
    std::cout << "CASE poison=" << enabled << " direction=" << direction << " equipment=" << state << " source=" << std::hex << source << std::dec << " OnHit\n";
    host.GetActionListener().OnHit(raw,msg);
    check(aggressor.GetInventory()==before,"uncoated hit changed inventory");
    const auto key=std::make_tuple(direction,state,source);
    if(!enabled)offHealth[key]=target.GetChangeForm().actorValues.healthPercentage;
    else {std::cout << "HEALTH off=" << offHealth.at(key) << " on=" << target.GetChangeForm().actorValues.healthPercentage << '\n';check(offHealth.at(key)==target.GetChangeForm().actorValues.healthPercentage,"NPC/uncoated physical outcome changed with poison enabled");}
    std::cout << "CASE direct poison entry\n";
    aggressor.ApplyWeaponPoisonHit(target,source,false,false,false);
    check(aggressor.GetInventory()==before,"direct uncoated hit changed inventory");
    const auto health=target.GetChangeForm().actorValues;
    try {check(std::isfinite(candidate.CalculateDamage(aggressor,target,msg.data)),"NPC shadow candidate returned nonfinite value");}
    catch(const aetherius::combat::ShadowUnsupported&) {check(true,"explicit unsupported shadow context");}
    check(target.GetChangeForm().actorValues.ToTuple()==health.ToTuple() && aggressor.GetInventory()==before,"shadow candidate mutated NPC hit state");
  }
  host.worldState.aetheriusWeaponPoison=true;
  const auto npcInv=creature.GetInventory(); const auto npcEq=creature.GetEquipment();
  const auto status=creature.GetPoisonResult();
  for(auto source:sources) {creature.ApplyWeaponPoisonHit(player,source,false,false,false);check(creature.GetPoisonResult()==status,"NPC entered poison logic");}
  check(!creature.ReconcileWeaponPoisonEquipment(Equipment{}),"hosted NPC reconciled player poison equipment");
  check(creature.GetInventory()==npcInv && creature.GetEquipment()==npcEq,"NPC guard mutated equipment/inventory");
  creature.PublishWeaponPoisonEquipment(); check(creature.GetEquipment()==npcEq,"NPC published poison equipment");
  host.serverState.Connect(1,"FIX-1010-NPC-associated");host.SetUserActor(1,npcId);
  creature.ApplyWeaponPoisonHit(player,dagger,false,false,false);
  check(creature.GetPoisonResult()==status && !creature.ReconcileWeaponPoisonEquipment(Equipment{}),"non-player base with associated user entered poison logic");
  host.SetUserActor(1,0);host.worldState.hosters[npcId]=playerId;
  MpActor detached(LocationalData{},FormCallbacks::DoNothing());
  detached.ApplyWeaponPoisonHit(player,dagger,false,false,false);
  check(!detached.TryUseWeaponPoison(resolve("3a5a4:Skyrim.esm")),"detached poison use accepted");
  check(!detached.ReconcileWeaponPoisonEquipment(Equipment{}),"detached equipment accepted");
  detached.PublishWeaponPoisonEquipment();detached.ScheduleWeaponPoisonTick(espm::ActorValue::Health,{},Networking::InvalidUserId);
  HitData detachedHit{};detachedHit.source=dagger;
  try {(void)candidate.CalculateDamage(detached,player,detachedHit);throw std::runtime_error("detached shadow context accepted");}
  catch(const aetherius::combat::ShadowUnsupported&) {check(true,"detached shadow refused");}
  auto poisonId=resolve("3a5a4:Skyrim.esm");auto poisonRecord=loader.GetBrowser().LookupById(poisonId);
  auto effect=espm::Convert<espm::ALCH>(poisonRecord.rec)->GetData(host.worldState.GetEspmCache()).effects.front();
  effect.effectId=poisonRecord.ToGlobalId(effect.effectId);effect.duration=3;effect.magnitude=1;effect.areaOfEffect=0;
  espm::MGEF::DATA info{};info.effectType=espm::MGEF::EffectType::ValueMod;info.flags=espm::MGEF::Flags::Detrimental;info.primaryAV=espm::ActorValue::Health;
  const auto prior=player.GetChangeForm().actorValues;
  check(detached.ApplyWeaponPoisonEffect(effect,info,false,&player)!=0,"detached effect accepted");
  check(player.ApplyWeaponPoisonEffect(effect,info,false,&creature)!=0,"NPC poison source accepted by effect entry");
  check(player.GetChangeForm().actorValues.ToTuple()==prior.ToTuple(),"refused NPC source damaged player");
  const auto validId=effect.effectId;
  for(auto missing:{0u,0xfd123456u,0xff123456u}){effect.effectId=missing;check(player.ApplyWeaponPoisonEffect(effect,info,false,&player)!=0,"unresolved effect source accepted");}
  effect.effectId=validId;
  player.RemoveAllMagicEffects();
  check(other.ApplyWeaponPoisonEffect(effect,info,false,&player)==0,"hosted NPC target not supported");
  const auto afterFirst=other.GetChangeForm().actorValues;
  host.SetUserActor(0,0);
  check(!player.ReconcileWeaponPoisonEquipment(Equipment{}),"unbound player equipment entered poison");
  player.ApplyWeaponPoisonHit(other,dagger,false,false,false);
  check(other.GetChangeForm().actorValues.ToTuple()==afterFirst.ToTuple(),"unbound player applied poison");
  std::this_thread::sleep_for(std::chrono::milliseconds(1050));host.Tick();
  check(other.GetChangeForm().actorValues.ToTuple()==afterFirst.ToTuple(),"poison tick continued after source disconnect");
  check(!other.GetActiveMagicEffects().Has(info.primaryAV),"disconnected poison source retained timed parcel");
  host.SetUserActor(0,playerId);host.worldState.hosters[otherId]=playerId;
  player.RemoveAllMagicEffects();
  if(player.IsDead())player.SetIsDead(false);
  check(player.ApplyWeaponPoisonEffect(effect,info,false,&player)==0,"connected temporal player parcel refused");
  const auto targetHealth=player.GetChangeForm().actorValues;
  host.SetUserActor(0,0);std::this_thread::sleep_for(std::chrono::milliseconds(1050));host.Tick();
  check(player.GetChangeForm().actorValues.ToTuple()==targetHealth.ToTuple(),"disconnected target tick changed resources");
  check(!player.GetActiveMagicEffects().Has(info.primaryAV),"disconnected target retained temporal parcel");
  host.SetUserActor(0,playerId);
  Inventory owned;owned.AddItem(dagger,1);
  Equipment incoming;incoming.inv.entries.push_back(Worn(dagger));incoming.numChanges=1;
  for(bool enabled:{false,true}) {
    host.worldState.aetheriusWeaponPoison=false;
    player.SetInventory(owned);player.SetEquipment(Equipment{});
    creature.SetInventory(owned);host.worldState.hosters[npcId]=playerId;
    host.worldState.aetheriusWeaponPoison=enabled;
    auto npcEquipment=incoming;npcEquipment.inv.entries[0].poisonId=poisonId;npcEquipment.inv.entries[0].poisonCount=77;
    const auto originalNpcInventory=creature.GetInventory();creature.SetEquipment(npcEquipment);
    check(creature.GetEquipment()==npcEquipment && creature.GetInventory()==originalNpcInventory,"NPC equipment left maintainer path");
    host.Tick();host.Messages().clear();
    UpdateEquipmentMessage update;update.idx=creature.GetIdx();update.data=incoming;
    SLNet::BitStream packet;PartOne::GetMessageSerializerInstance().Serialize(update,packet);
    raw.unparsed=packet.GetData();raw.unparsedLength=packet.GetNumberOfBytesUsed();
    host.GetActionListener().OnUpdateEquipment(raw,update);host.Tick();
    bool forwarded=false;
    for(const auto& message:host.Messages())if(message.userId==0 && message.j.value("t",0)==static_cast<int>(MsgType::UpdateEquipment)) {
      check(message.j.at("idx")==creature.GetIdx(),"hosted NPC packet replaced with player equipment echo");
      check(message.j.at("data")==incoming.ToJson(),"hosted NPC equipment packet content changed");forwarded=true;
    }
    check(forwarded,"hosted NPC original equipment packet not forwarded");
    check(creature.GetEquipment()==npcEquipment,"OnUpdateEquipment changed NPC stored state outside maintainer semantics");
    host.Messages().clear();player.PublishWeaponPoisonEquipment(false);host.Tick();
    check(std::none_of(host.Messages().begin(),host.Messages().end(),[](const auto& message){return message.userId==0 && message.j.value("t",0)==static_cast<int>(MsgType::UpdateEquipment);}),"NPC listener routed observer update back to owner");
  }
  host.worldState.aetheriusWeaponPoison=true;
  const auto currentInv=player.GetInventory();const auto currentEq=player.GetEquipment();
  auto malformed=incoming;malformed.inv.entries[0].baseId=0xfd123456;
  check(!player.ReconcileWeaponPoisonEquipment(malformed),"unresolved equipment record entered poison reconciliation");
  check(player.GetInventory()==currentInv && player.GetEquipment()==currentEq,"unresolved equipment mutated poison state");
  // Real destruction, not simulated callbacks: pending timers hold only weak
  // source/target refs and use the same World's native effect scheduler.
  const auto transientSourceId=host.CreateActor(0,{0,0,0},0,cell);
  auto& transientSource=host.worldState.GetFormAt<MpActor>(transientSourceId);
  host.SetUserActor(0,transientSourceId);host.worldState.hosters[otherId]=transientSourceId;
  other.RemoveAllMagicEffects();if(other.IsDead())other.SetIsDead(false);
  check(other.ApplyWeaponPoisonEffect(effect,info,false,&transientSource)==0,"destruction fixture failed to start poison");
  const auto beforeDestroy=other.GetChangeForm().actorValues;host.DestroyActor(transientSourceId);
  std::this_thread::sleep_for(std::chrono::milliseconds(1050));host.Tick();
  check(other.GetChangeForm().actorValues.ToTuple()==beforeDestroy.ToTuple() && !other.GetActiveMagicEffects().Has(info.primaryAV),"destroyed poison source continued tick");
  host.SetUserActor(0,playerId);host.worldState.hosters[otherId]=playerId;
  check(other.ApplyWeaponPoisonEffect(effect,info,false,&player)==0,"destroyed target fixture failed to start poison");
  host.DestroyActor(otherId);std::this_thread::sleep_for(std::chrono::milliseconds(1050));host.Tick();
  check(true,"destroyed poison target tick survived");
  std::cout << "PASS FIX-1010 NPC " << checks << " checks; no sockets\n";
}
