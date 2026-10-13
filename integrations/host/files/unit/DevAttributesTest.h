#pragma once
#include "aetherius_combat/DevAttributes.h"
#include "CropRegeneration.h"
#include "EvaluateTemplate.h"
#include "CreateActorMessage.h"
#include <limits>

// Real PartOne/WorldState/ActionListener and installed winners. No listening socket.
inline void RunDevAttributesTests(const std::filesystem::path& manifestPath) {
  std::cout << std::unitbuf;
  std::ifstream in(manifestPath); nlohmann::json manifest; in >> manifest;
  std::vector<std::filesystem::path> paths;
  for (const auto& row : manifest.at("plugins"))
    paths.push_back(manifestPath.parent_path()/row.at("filename").get<std::string>());
  espm::Loader loader(paths); PartOne host; host.AttachEspm(&loader);
  auto resolve=[&](const char* key){return FormDesc::FromString(key).ToFormId(host.worldState.pluginIndexMapping);};
  int count=0;
  auto check=[&](bool ok,const char* why){++count;if(!ok)throw std::runtime_error(why);};
  auto assertNear=[&](float a,float b,const char* why){check(std::abs(a-b)<0.0001f,why);};
  PluginIndexMapping initialMap,shiftedMap;
  initialMap.Build({"Skyrim.esm","AETHERIUS - BALANCE.esp"});
  shiftedMap.Build({"AETHERIUS - BALANCE.esp","Skyrim.esm"});
  const auto nordKey=FormDesc::FromString("13746:Skyrim.esm");
  check(nordKey.ToFormId(initialMap)!=nordKey.ToFormId(shiftedMap),"race resolution fixed a plugin position");
  check(FormDesc::FromFormId(nordKey.ToFormId(initialMap),initialMap)==nordKey,"original stable race resolution");
  check(FormDesc::FromFormId(nordKey.ToFormId(shiftedMap),shiftedMap)==nordKey,"shifted stable race resolution");
  struct KnownDamage final : IDamageFormula {
    float CalculateDamage(const MpActor&,const MpActor&,const HitData&) const override {return 30.f;}
    float CalculateDamage(const MpActor&,const MpActor&,const SpellCastData&) const override {return 30.f;}
  };
  host.SetDamageFormula(std::make_unique<KnownDamage>());
  const auto cell=resolve("3c:Skyrim.esm");
  const auto attackerId=host.CreateActor(0,{0,0,0},0,cell),targetId=host.CreateActor(0,{0,0,0},0,cell);
  auto& attacker=host.worldState.GetFormAt<MpActor>(attackerId);
  auto& target=host.worldState.GetFormAt<MpActor>(targetId);
  host.serverState.Connect(0,"DEV-A1-attacker");host.SetUserActor(0,attackerId);
  host.serverState.Connect(1,"DEV-A1-target");host.SetUserActor(1,targetId);
  target.RegisterProfileId(2);

  Appearance appearance;appearance.raceId=resolve("13746:Skyrim.esm");
  target.SetAppearance(&appearance);
  const auto base=target.GetBaseValues();
  const auto race=espm::GetData<espm::RACE>(target.GetRaceId(),&host.worldState);
  const auto npc=EvaluateTemplate<espm::NPC_::UseStats>(&host.worldState,target.GetBaseId(),target.GetTemplateChain(),
    [](const auto& record,const auto& data){return std::make_pair(record.ToGlobalId(record.rec->GetId()),data);});
  auto winner=[&](uint32_t id){auto record=loader.GetBrowser().LookupById(id);return paths.at(record.GetSourceId()).filename().string();};
  std::cout << "NORD startingHealth=" << race.startingHealth << " healthOffset=" << npc.second.healthOffset
    << " resultingHealth=" << base.health << " raceWinner=" << winner(target.GetRaceId())
    << " base=" << FormDesc::FromFormId(target.GetBaseId(),host.worldState.pluginIndexMapping).ToString()
    << " statsNPC=" << FormDesc::FromFormId(npc.first,host.worldState.pluginIndexMapping).ToString()
    << " statsWinner=" << winner(npc.first) << " templateChain=";
  for(const auto& key:target.GetTemplateChain())std::cout << key.ToString() << ';';
  std::cout << '\n';
  check(target.GetMaximumValues().ToTuple()==base.ToTuple(),"absent override changed records");
  const auto persistentBefore=target.GetChangeForm().actorValues.ToTuple();
  // AETHERIUS C3d: actual GetMaximumValues, transient delivery and resource path.
  target.SetAttributeBonuses(aetherius::attributes::Bonuses{200,300,85});
  const auto allocated=target.GetMaximumValues();
  assertNear(allocated.health,base.health+200,"C3d additive health");
  assertNear(allocated.magicka,base.magicka+300,"C3d additive magicka");
  assertNear(allocated.stamina,base.stamina+85,"C3d additive stamina");
  check(target.GetBaseValues().ToTuple()==base.ToTuple(),"C3d changed record base");
  check(target.GetChangeForm().actorValues.ToTuple()==persistentBefore,"C3d persisted bonuses");
  check(allocated.healRate==base.healRate&&allocated.magickaRate==base.magickaRate&&allocated.staminaRate==base.staminaRate,"C3d changed regen rates");
  CreateActorMessage allocatedSpawn;target.VisitProperties(allocatedSpawn,VisitPropertiesMode::All);
  check(allocatedSpawn.props.health==allocated.health&&allocatedSpawn.props.magicka==allocated.magicka&&allocatedSpawn.props.stamina==allocated.stamina,"C3d spawn maximum");
  target.SetDevAttributes(aetherius::development::Attributes{300,300,300});
  check(target.GetMaximumValues().health==300&&target.GetMaximumValues().magicka==300&&target.GetMaximumValues().stamina==300,"C3d stacked on DEV absolute override");
  bool c3dRefused=false;
  try{target.SetAttributeBonuses(aetherius::attributes::Bonuses{5,0,0});}catch(const std::invalid_argument&){c3dRefused=true;}
  check(c3dRefused,"C3d accepted second writer during DEV override");
  target.SetDevAttributes(std::nullopt);
  check(target.GetMaximumValues().ToTuple()==allocated.ToTuple(),"C3d bonus lost behind DEV override");
  for(const auto bad : {aetherius::attributes::Bonuses{-5,0,0},aetherius::attributes::Bonuses{1,0,0},
    aetherius::attributes::Bonuses{590,0,0},aetherius::attributes::Bonuses{585,5,0}}){
    c3dRefused=false;try{target.SetAttributeBonuses(bad);}catch(const std::invalid_argument&){c3dRefused=true;}
    check(c3dRefused,"C3d invalid native allocation accepted");
  }
  target.SetAttributeBonuses(std::nullopt);
  check(target.GetMaximumValues().ToTuple()==base.ToTuple(),"C3d removal did not restore records");
  host.Tick();host.Messages().clear();
  target.SetDevAttributes(aetherius::development::Attributes{300,300,300});
  const auto maximum=target.GetMaximumValues();
  assertNear(maximum.health,300,"health maximum");assertNear(maximum.magicka,300,"magicka maximum");assertNear(maximum.stamina,300,"stamina maximum");
  check(target.GetChangeForm().actorValues.ToTuple()==persistentBefore,"override persisted into change form");
  check(target.GetBaseValues().ToTuple()==base.ToTuple(),"override mutated records");
  check(maximum.healRate==base.healRate&&maximum.magickaRate==base.magickaRate&&maximum.staminaRate==base.staminaRate,"regen rates altered");
  CreateActorMessage spawn;target.VisitProperties(spawn,VisitPropertiesMode::All);
  check(spawn.props.health==300&&spawn.props.magicka==300&&spawn.props.stamina==300,"spawn did not carry maxima");
  host.Tick();
  std::vector<uint32_t> snippets;
  for(const auto& message:host.Messages())if(message.j.value("function","")=="SetActorValue"){
    check(message.j.at("arguments").at(1).get<float>()==300,"snippet maximum mismatch");
    snippets.push_back(message.j.at("snippetIdx").get<uint32_t>());
  }
  check(snippets.size()==3,"client maximum delivery not three native snippets");
  host.Messages().clear();
  target.ResolveSnippet(snippets[0],VarValue::None());target.ResolveSnippet(snippets[1],VarValue::None());
  check(host.Messages().empty(),"percentages sent before all resource calls completed");
  target.ResolveSnippet(snippets[2],VarValue::None());
  check(host.Messages().size()==1&&host.Messages().front().j.at("data").at("health")==1,"percentages not sent after native ACKs");
  host.Messages().clear();
  target.SetDevAttributes(aetherius::development::Attributes{300,300,300});
  target.SetDevAttributes(aetherius::development::Attributes{250,600,900});
  host.Tick();snippets.clear();
  for(const auto& message:host.Messages())if(message.j.value("function","")=="SetActorValue")
    snippets.push_back(message.j.at("snippetIdx").get<uint32_t>());
  check(snippets.size()==6,"replacement delivery snippets");host.Messages().clear();
  for(size_t i=0;i<3;++i)target.ResolveSnippet(snippets[i],VarValue::None());
  check(host.Messages().empty(),"stale ACK from old maxima published percentages");
  for(size_t i=3;i<6;++i)target.ResolveSnippet(snippets[i],VarValue::None());
  check(host.Messages().size()==1,"replacement ACK did not publish once");
  assertNear(target.GetMaximumValues().health,250,"independent health");
  assertNear(target.GetMaximumValues().magicka,600,"independent magicka");
  assertNear(target.GetMaximumValues().stamina,900,"independent stamina");
  target.SetDevAttributes(aetherius::development::Attributes{300,300,300});

  auto full=target.GetActorValues();full.healthPercentage=1;full.magickaPercentage=1;full.staminaPercentage=1;
  auto reset=[&](){if(target.IsDead())target.SetIsDead(false);target.SetPercentages(full);};
  auto hit=[&](){reset();attacker.SetLastHitTime(targetId,std::chrono::steady_clock::now()-std::chrono::seconds(10));
    HitMessage message;message.data.aggressor=0x14;message.data.target=targetId;message.data.source=resolve("1f4:Skyrim.esm");
    RawMessageData raw;raw.userId=0;host.GetActionListener().OnHit(raw,message);return target.GetActorValues().healthPercentage;};
  assertNear(hit(),0.9f,"30 damage must remove 30/300");
  for(auto av:{espm::ActorValue::Health,espm::ActorValue::Magicka,espm::ActorValue::Stamina}){
    reset();target.DamageActorValue(av,30);assertNear(target.GetActorValues().GetValue(av),base.GetValue(av),"damage modified stored base");
    const auto values=target.GetActorValues();const auto percent=av==espm::ActorValue::Health?values.healthPercentage:av==espm::ActorValue::Magicka?values.magickaPercentage:values.staminaPercentage;
    assertNear(percent,0.9f,"resource damage fraction");target.RestoreActorValue(av,15);
    const auto restored=target.GetActorValues();assertNear(av==espm::ActorValue::Health?restored.healthPercentage:av==espm::ActorValue::Magicka?restored.magickaPercentage:restored.staminaPercentage,0.95f,"restoration fraction");
  }
  reset();auto half=full;half.healthPercentage=half.magickaPercentage=half.staminaPercentage=0.5f;target.SetPercentages(half);
  assertNear(CropHealthRegeneration(1,1,&target),0.5f+maximum.healRate*maximum.healRateMult/10000,"health regen validation");
  assertNear((CropHealthRegeneration(1,1,&target)-0.5f)*300,300*maximum.healRate*maximum.healRateMult/10000,"health regen absolute points");
  assertNear(CropMagickaRegeneration(1,1,&target),0.5f+maximum.magickaRate*maximum.magickaRateMult/10000,"magicka regen validation");
  assertNear(CropStaminaRegeneration(1,1,&target),0.5f+maximum.staminaRate*maximum.staminaRateMult/10000,"stamina regen validation");
  RawMessageData raw;raw.userId=1;ChangeValuesMessage values;values.data.health=std::numeric_limits<float>::quiet_NaN();
  host.GetActionListener().OnChangeValues(raw,values);assertNear(target.GetActorValues().healthPercentage,0.5f,"nonfinite client input accepted");
  target.SetLastAttributesPercentagesUpdate(std::chrono::steady_clock::now());
  values.data.health=2.f;values.data.magicka=2.f;values.data.stamina=2.f;host.GetActionListener().OnChangeValues(raw,values);
  check(target.GetActorValues().healthPercentage<0.501f&&target.GetActorValues().magickaPercentage<0.501f&&target.GetActorValues().staminaPercentage<0.501f,"client regen bypassed validation");

  // Certified ResourceDamage operation called by the real poison implementation.
  const auto poison=resolve("3a5a4:Skyrim.esm");auto poisonRecord=loader.GetBrowser().LookupById(poison);
  auto effect=espm::Convert<espm::ALCH>(poisonRecord.rec)->GetData(host.worldState.GetEspmCache()).effects.front();
  effect.effectId=poisonRecord.ToGlobalId(effect.effectId);effect.magnitude=30;effect.duration=0;effect.areaOfEffect=0;
  espm::MGEF::DATA info{};info.effectType=espm::MGEF::EffectType::ValueMod;info.flags=espm::MGEF::Flags::Detrimental;
  // Enable only this no-socket fixture's in-memory operation gate. The local
  // server settings file is never changed, and the fixture gate is restored.
  host.worldState.aetheriusWeaponPoison=true;
  for(auto av:{espm::ActorValue::Health,espm::ActorValue::Magicka,espm::ActorValue::Stamina}){
    reset();info.primaryAV=av;check(target.ApplyWeaponPoisonEffect(effect,info,false,&attacker)==0,"poison family refused");
    const auto value=target.GetActorValues();assertNear(av==espm::ActorValue::Health?value.healthPercentage:av==espm::ActorValue::Magicka?value.magickaPercentage:value.staminaPercentage,0.9f,"poison did not use 300");
  }
  host.worldState.aetheriusWeaponPoison=false;
  check(!host.worldState.aetheriusWeaponPoison,"test must leave weaponPoison false");
  target.SetIsDead(true);target.SetIsDead(false);assertNear(target.GetMaximumValues().health,300,"respawn lost transient maxima");
  target.SetDevAttributes(std::nullopt);check(target.GetMaximumValues().ToTuple()==base.ToTuple(),"clear did not restore original maxima");
  assertNear(hit(),1.f-30.f/base.health,"absent override changed original hit result");
  reset();target.DamageActorValue(espm::ActorValue::Health,30);assertNear(target.GetActorValues().healthPercentage,1.f-30.f/base.health,"original actor value fraction changed");
  const auto npcId=host.worldState.GenerateFormId();
  host.worldState.AddForm(std::make_unique<MpActor>(LocationalData{{0,0,0},{0,0,0},FormDesc::FromFormId(cell,host.worldState.pluginIndexMapping)},host.CreateFormCallbacks(),resolve("422b4:Skyrim.esm")),npcId);
  auto& creature=host.worldState.GetFormAt<MpActor>(npcId);creature.RegisterProfileId(3);
  host.serverState.Connect(2,"DEV-A1-NPC");host.SetUserActor(2,npcId);
  const auto npcBefore=creature.GetMaximumValues();bool refused=false;
  try{creature.SetDevAttributes(aetherius::development::Attributes{300,300,300});}catch(const std::invalid_argument&){refused=true;}
  check(refused&&!creature.HasDevAttributes()&&creature.GetMaximumValues().ToTuple()==npcBefore.ToTuple(),"NPC accepted override");
  for(auto bad:{0,100001}){refused=false;try{target.SetDevAttributes(aetherius::development::Attributes{bad,300,300});}catch(const std::invalid_argument&){refused=true;}check(refused,"native range accepted");}
  target.SetDevAttributes(aetherius::development::Attributes{300,300,300});host.SetUserActor(1,0);
  check(!target.HasDevAttributes()&&target.GetMaximumValues().ToTuple()==base.ToTuple(),"offline player retained override");
  target.SetAttributeBonuses(std::nullopt);
  std::cout << "PASS C3d + DEV-A1 " << count << " native checks; no sockets; weaponPoison=false\n";
}
