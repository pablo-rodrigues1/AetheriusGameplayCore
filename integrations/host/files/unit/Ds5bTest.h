#pragma once
#include "aetherius_combat/ds5a/Host.h"
#include "aetherius_combat/ds5a/NativeRecords.h"
#include "UpdateAnimationMessage.h"
#include <fstream>
inline void RunDs5bTests(const std::filesystem::path& manifestPath,const std::filesystem::path& corpusPath) {
  using namespace aetherius::combat;
  namespace ds=ds5a;namespace r=ds5b;
  unsigned checks=0;std::cout<<std::unitbuf;
  const auto check=[&](bool ok,const char* what){++checks;if(!ok)throw std::runtime_error(std::string("DS5b ")+what);};
  const auto assertNear=[&](double a,double b,const char* what){check(std::abs(a-b)<1e-6,what);};
  // Synthetic arithmetic inputs exercise operations, not substitute record data.
  r::Context ac,dc;ac.values[ac.valueCount++]={"OneHanded",60};ac.values[ac.valueCount++]={"Stamina",60};
  r::Rule rule;rule.supported=true;rule.entry=r::EP::Attack;rule.value=.01;rule.actorValue="OneHanded";
  for(const auto& op:std::vector<std::pair<std::string,double>>{{"Set",.01},{"Add",2.01},{"Multiply",.02},{"MultiplyOnePlusAVMult",3.2},{"MultiplyAVMult",1.2},{"AddAVMult",2.6}}) {
    rule.modification=op.first;assertNear(*r::Operate(rule,2,ac),op.second,"operation");
  }
  rule.actorValue="Unknown";check(!r::Operate(rule,2,ac),"missing AV never neutral truth");
  r::Table ordered;rule.modification="Multiply";rule.value=3;rule.priority=20;rule.index=2;ordered.rules[0].push_back(rule);
  rule.modification="Add";rule.value=4;rule.priority=10;rule.index=1;ordered.rules[0].push_back(rule);
  std::stable_sort(ordered.rules[0].begin(),ordered.rules[0].end(),[](const auto& a,const auto& b){return a.priority<b.priority;});
  r::Audit audit;assertNear(r::Apply(ordered,r::EP::Attack,2,ac,dc,audit),18,"priority and Add exact");
  rule.modification="Set";rule.value=7;rule.priority=30;ordered.rules[0].push_back(rule);
  assertNear(r::Apply(ordered,r::EP::Attack,2,ac,dc,audit),7,"Set exact after multiply");
  rule.modification="Multiply";rule.value=99;rule.supported=false;ordered.rules[0]={rule};
  assertNear(r::Apply(ordered,r::EP::Attack,2,ac,dc,audit),2,"unsupported never applied");
  r::Condition condition;condition.function="GetActorValue";condition.actorValue="OneHanded";condition.compare="GreaterThan";condition.expected=50;
  rule.supported=true;rule.tabs={r::Tab{r::Clause{condition}}};
  check(r::Matches(rule,&ac,&dc)==r::Decision::Applied,"subject");
  rule.tabs[0][0][0].target=true;
  check(r::Matches(rule,&ac,&dc)==r::Decision::Missing,"Target missing");
  dc.values[dc.valueCount++]={"OneHanded",55};check(r::Matches(rule,&ac,&dc)==r::Decision::Applied,"Target selection");
  condition.actorValue="absent";condition.target=false;rule.tabs[0][0].push_back(condition);
  check(r::Matches(rule,&ac,&dc)==r::Decision::Applied,"OR true despite unknown");
  rule.tabs.push_back(r::Tab{r::Clause{condition}});check(r::Matches(rule,&ac,&dc)==r::Decision::Missing,"tabs AND");
  r::Rng rng(1234567),replay(1234567);for(int i=0;i<100;++i){const double roll=rng.Next();check(roll>=0&&roll<1&&roll==replay.Next(),"RNG reproducible range");}
  r::Table critical;rule.tabs.clear();rule.supported=true;rule.entry=r::EP::CritChance;rule.modification="Set";rule.value=100;critical.rules[4]={rule};
  rule.entry=r::EP::CritDamage;rule.modification="MultiplyOnePlusAVMult";rule.actorValue="OneHanded";rule.value=.05;critical.rules[5]={rule};
  ds::Trace t;t.weaponBase=20;t.weaponSkill=50;ds::Finish(t,{1.5,1,1.4},0,false);
  ds::FinishPerks(t,critical,r::Table{},ac,dc,{true,5},{true,1},rng);
  check(t.critical&&t.rngDraws==1,"one critical draw");assertNear(t.criticalComponent,20,"critical separate component");assertNear(t.candidate,45,"critical plus normal");
  r::Rng captured(t.rngState);assertNear(captured.Next(),t.rngRoll,"trace replays draw");
  auto rngBuffer=std::make_shared<ds::Buffer>();rngBuffer->Add({0,1,2,3,0,t});
  check(rngBuffer->Read().at("samples")[0].at("rngState")==std::to_string(t.rngState),"RNG trace preserves uint64 through JS JSON");
  ds::Trace noCrit;noCrit.weaponBase=20;ds::Finish(noCrit,{1.5,1,1.4},0,false);const auto state=rng.state;
  ds::FinishPerks(noCrit,r::Table{},r::Table{},ac,dc,{true,5},{true,1},rng);
  check(!noCrit.critical&&noCrit.rngDraws==0&&rng.state==state,"no perk no critical");
  ds::Trace missingBase;missingBase.weaponBase=20;ds::Finish(missingBase,{1.5,1,1.4},0,false);
  ds::FinishPerks(missingBase,critical,r::Table{},ac,dc,{}, {true,1},rng);check(missingBase.criticalBaseMissing&&missingBase.rngDraws==0,"missing critical record declared");
  ds::Trace power;power.weaponBase=20;power.powerConfirmed=true;ds::Finish(power,{1.5,1,1.4},0,false);
  ds::FinishPerks(power,r::Table{},r::Table{},ac,dc,{}, {true,1},rng);assertNear(power.candidate,40,"confirmed power default bonus");
  ds::Trace zero;zero.weaponBase=20;zero.global=0;ds::Finish(zero,{1.5,1,1.4},0,false);
  ds::FinishPerks(zero,r::Table{},r::Table{},ac,dc,{}, {true,1},rng);assertNear(zero.candidate,0,"zero global finite");
  r::AttackEvidence evidence;const auto now=std::chrono::steady_clock::now();
  evidence.Record("attackPowerStartInPlace",10,2,now);
  using Kind=r::AttackEvidence::Kind;
  check(evidence.Confirm(Kind::Power,10,2,now),"confirmed power");
  check(!evidence.Confirm(Kind::Power,11,2,now)&&!evidence.Confirm(Kind::Power,10,3,now),"hoster/generation invalidation");
  check(!evidence.Confirm(Kind::Power,10,2,now+std::chrono::seconds(2)),"bounded time");
  evidence.Record("BFCO_unknown",10,2,now);check(!evidence.Confirm(Kind::Power,10,2,now),"directional ordinary Q7");
  evidence.Record("bashStart",10,2,now);check(evidence.Confirm(Kind::Bash,10,2,now),"bash evidence only");

  std::ifstream stream(manifestPath);ds::Json manifest;stream>>manifest;
  std::vector<std::filesystem::path> paths;for(const auto& row:manifest.at("plugins"))paths.push_back(manifestPath.parent_path()/row.at("filename").get<std::string>());
  espm::Loader loader(paths);PartOne host;host.AttachEspm(&loader);const auto& browser=loader.GetBrowser();
  auto resolver=[&](const StableFormKey& key){const auto source=browser.FindSourceByFilename(key.plugin.c_str());if(!source)throw std::runtime_error("plugin absent");return browser.ToRuntimeFormId(*source,key.localId);};
  const auto weaponId=resolver(ds::Key("skyrim.esm|01397E"));
  ds::Catalog catalog;ds::Record weapon;weapon.kind=ds::Record::Kind::Weapon;weapon.key=ds::Key("skyrim.esm|01397E");weapon.supported=true;
  weapon.skill=ds::Skill::OneHanded;weapon.base=espm::Convert<espm::WEAP>(browser.LookupById(weaponId).rec)->GetData(browser.GetCache()).weapData->damage;
  catalog.records.emplace(weaponId,weapon);ds::HydrateNative(catalog,browser);
  assertNear(catalog.records.at(weaponId).criticalBase.value,2,"CRDT winning export 01397E");check(catalog.records.at(weaponId).criticalBase.supported,"critical exists");
  assertNear(catalog.records.at(weaponId).itemType.value,2,"dagger equipped type");assertNear(catalog.powerBonus.value,1,"winning power GMST 031899");
  const auto playerId=host.CreateActor(0,{0,0,0},0,0x3c),npcId=host.CreateActor(0,{0,0,0},0,0x3c);
  auto& player=host.worldState.GetFormAt<MpActor>(playerId);auto& npc=host.worldState.GetFormAt<MpActor>(npcId);
  host.serverState.Connect(0,"ds5b-test");host.SetUserActor(0,playerId);host.worldState.hosters[npcId]=playerId;
  auto send=[&](uint32_t idx,const char* name) {
    UpdateAnimationMessage msg;msg.idx=idx;msg.data.animEventName=name;SLNet::BitStream packet;
    PartOne::GetMessageSerializerInstance().Serialize(msg,packet);RawMessageData raw;raw.userId=0;
    raw.unparsed=packet.GetData();raw.unparsedLength=packet.GetNumberOfBytesUsed();host.GetActionListener().OnUpdateAnimation(raw,msg);
  };
  send(npc.GetIdx(),"attackPowerStartInPlace");
  check(npc.GetCombatAttackEvidence().Confirm(Kind::Power,playerId,npc.GetNpcGeneration(),std::chrono::steady_clock::now()),"hosted NPC accepted ingress");
  host.worldState.hosters.erase(npcId);send(npc.GetIdx(),"bashStart");
  check(!npc.GetCombatAttackEvidence().Confirm(Kind::Bash,playerId,npc.GetNpcGeneration(),std::chrono::steady_clock::now()),"non-hoster rejected");
  send(player.GetIdx(),"attackPowerStartForward");
  check(player.GetCombatAttackEvidence().Confirm(Kind::Power,playerId,player.GetNpcGeneration(),std::chrono::steady_clock::now()),"own actor accepted ingress");

  std::ifstream corpusStream(corpusPath);ds::Json corpus;corpusStream>>corpus;
  auto nativeCatalog=std::make_shared<ds::Catalog>(catalog);
  for(auto pair:std::vector<std::pair<const char*,const char*>>{{"weapon","skyrim.esm|0C5C0F"},{"base","skyrim.esm|01A157"},{"armor","skyrim.esm|0C5C0C"}}) {
    const auto value=espm::Convert<espm::GMST>(browser.LookupById(resolver(ds::Key(pair.second))).rec)->GetData(browser.GetCache()).value;
    if(std::string(pair.first)=="weapon")nativeCatalog->scaling.weaponMax=value;
    else if(std::string(pair.first)=="base")nativeCatalog->scaling.armorBase=value;
    else nativeCatalog->scaling.armorMax=value;
  }
  const auto lookup=browser.LookupById(weaponId);
  for(auto keyword:lookup.rec->GetKeywordIds(browser.GetCache())) {
    const auto resolved=browser.ResolveRuntimeFormId(lookup.ToGlobalId(keyword));
    const auto meta=resolved.source?browser.GetSourceMetadata(*resolved.source):nullptr;
    check(meta&&resolved.localId,"keyword stable mapping");
    auto plugin=meta->fileName;std::transform(plugin.begin(),plugin.end(),plugin.begin(),[](unsigned char c){return char(std::tolower(c));});
    nativeCatalog->records.at(weaponId).keywords.push_back({plugin,*resolved.localId});
  }
  const auto defenderId=host.CreateActor(0,{0,0,0},0,0x3c);
  auto& defender=host.worldState.GetFormAt<MpActor>(defenderId);defender.SetEquipment(Equipment{});
  Equipment equipment;equipment.inv.entries.push_back(Worn(weaponId));player.SetEquipment(equipment);
  auto bridge=std::make_shared<ds::Bridge>(resolver);bridge->catalog=nativeCatalog;
  ds::Json profile={{"version",1},{"revision",1},{"subject",{{"kind","PLAYER"}}},
    {"race",{{"status","UNSUPPORTED"},{"value",nullptr}}},{"skills",ds::Json::object()},
    {"effects",ds::Json::object()},{"perks",{{"status","SUPPORTED"},{"value",ds::Json::array()}}}};
  for(const auto* skill:ds::SkillNames)profile["skills"][skill]={{"status","SUPPORTED"},{"value",50}};
  for(const auto* effect:{"fortifyOneHandedDamage","fortifyTwoHandedDamage","fortifyArcheryDamage","fortifyUnarmedDamage","fortifyPowerAttacks",
    "fortifyBashDamage","fortifyArmorRating","fortifyBlock","resistArrowDamage","resistPowerAttackDamage","fortifySneakAttacks"})
    profile["effects"][effect]={{"status","UNSUPPORTED"},{"value",nullptr}};
  profile["perks"]["value"].push_back({{"sourceKind","CLASS"},{"sourceKey","golden-test"},{"stableFormKey","skyrim.esm|0BABE4"},
    {"rank",1},{"status","SUPPORTED"},{"compiled",corpus.at("perks").at("0BABE4:Skyrim.esm")}});
  auto owner=host.worldState.LookupFormById(playerId),victim=host.worldState.LookupFormById(defenderId);
  check(bridge->Publish(playerId,owner,1,profile.dump()),"real DS3 compiled projection publication");
  auto defenderProfile=profile;defenderProfile["subject"]["kind"]="NPC";defenderProfile["perks"]["value"]=ds::Json::array();
  check(bridge->Publish(defenderId,victim,1,defenderProfile.dump()),"defender projection");
  const auto parses=bridge->profileParses;
  auto buffer=std::make_shared<ds::Buffer>();ds::Settings settings;settings.modes.fill(ds::Mode::Shadow);
  ds::Formula formula(Legacy(),bridge,settings,buffer);
  HitData hit{};hit.aggressor=playerId;hit.target=defenderId;hit.source=weaponId;
  const double expected=nativeCatalog->records.at(weaponId).base*1.25*1.5;
  const auto initial=formula.Evaluate(player,defender,hit);
  std::cout<<"DS5b first candidate status="<<unsigned(initial.status)<<" reason="<<ds::ReasonName(initial.reason)<<" base="<<initial.weaponBase<<" armor="<<initial.armor<<" candidate="<<initial.candidate<<'\n';
  check(initial.status==ds::Status::Calculated,"host candidate calculated");
  assertNear(initial.candidate,expected,"real mastery participates in host hit");check(initial.rules.applied==1,"one weapon rule once");
  hit.isPowerAttack=true;send(player.GetIdx(),"attackPowerStartForward");
  const auto confirmed=formula.Evaluate(player,defender,hit);check(confirmed.powerConfirmed,"flag plus accepted animation");
  assertNear(confirmed.candidate,expected*2,"power with mastery");
  send(player.GetIdx(),"BFCO_unknown");const auto conventional=formula.Evaluate(player,defender,hit);
  check(!conventional.powerConfirmed,"forged power flag");assertNear(conventional.candidate,expected,"ordinary damage Q7");
  hit.isPowerAttack=false;hit.isSneakAttack=true;assertNear(formula.Evaluate(player,defender,hit).candidate,expected,"sneak flag inactive Q9");hit.isSneakAttack=false;
  check(bridge->profileParses==parses,"hit no profile parse");
  const auto benchmark=[&](const IDamageFormula& candidate,const char* label) {
    std::vector<double> times;times.reserve(20001);volatile float sink=0;
    for(unsigned i=0;i<2000;++i)sink=candidate.CalculateDamage(player,defender,hit);
    for(unsigned i=0;i<20001;++i){const auto start=std::chrono::steady_clock::now();sink=candidate.CalculateDamage(player,defender,hit);
      times.push_back(std::chrono::duration<double,std::nano>(std::chrono::steady_clock::now()-start).count());}
    std::sort(times.begin(),times.end());std::cout<<"BENCH DS5b "<<label<<" median_ns="<<times[10000]<<" p99_ns="<<times[19800]<<" samples=20001 sink="<<sink<<'\n';
  };
  auto legacy=Legacy();benchmark(*legacy,"legacy");benchmark(formula,"shadow_with_class_perks");
  check(buffer->Read().at("samples").back().at("rulesApplied")==1,"bounded trace records rule");
  profile["revision"]=2;profile["perks"]["value"][0]["status"]="UNSUPPORTED";
  check(bridge->Publish(playerId,owner,2,profile.dump()),"unsupported profile accepted as explicit absence of semantics");
  const auto unsupported=formula.Evaluate(player,defender,hit);check(unsupported.attackerUnsupportedPerks==1,"unsupported perk trace count");
  check(unsupported.attackerUnsupportedRules==2,"all rules of unsupported perk counted");
  assertNear(unsupported.candidate,expected/1.5,"whole unsupported perk never applied");

  // Deliberately synthetic conflicting operations test the production publication gate.
  auto conflict=profile;conflict["revision"]=3;conflict["perks"]["value"][0]["status"]="SUPPORTED";
  auto extra=conflict["perks"]["value"][0]["compiled"]["rules"][0];extra["modification"]="Add";extra["value"]=10;extra["effectIndex"]=99;
  conflict["perks"]["value"][0]["compiled"]["rules"].push_back(extra);
  check(bridge->Publish(playerId,owner,3,conflict.dump()),"noncommutative group publication");
  const auto refused=formula.Evaluate(player,defender,hit);
  assertNear(refused.candidate,expected/1.5,"uncertified ordering never guessed");check(refused.rules.unsupported==2,"ordering refusal counted per rule");
  auto duplicate=profile;duplicate["revision"]=4;duplicate["perks"]["value"][0]["status"]="SUPPORTED";
  duplicate["perks"]["value"].push_back(duplicate["perks"]["value"][0]);
  check(bridge->Publish(playerId,owner,4,duplicate.dump()),"duplicate grant origins projection");
  assertNear(formula.Evaluate(player,defender,hit).candidate,expected,"same perk effect once across grants");
  auto badOrigin=duplicate;badOrigin["revision"]=5;badOrigin["perks"]["value"][0]["compiled"]["rules"][0]["origin"]["sourceKey"]="other-origin";
  check(!bridge->Publish(playerId,owner,5,badOrigin.dump()),"inconsistent origin invalidates projection");
  std::cout<<"PASS DS-5b "<<checks<<" checks (operations, conditions, RNG, records, authorized animation ingress)\n";
}
