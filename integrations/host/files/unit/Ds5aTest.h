#pragma once
#include "aetherius_combat/ds5a/Host.h"
#include <iomanip>
#include <numeric>

inline void RunDs5aTests(const std::filesystem::path& manifestPath) {
  using namespace aetherius::combat;
  namespace ds=ds5a;
  std::cout<<std::unitbuf;
  int total=0;
  const auto check=[&](bool ok,const char* message){++total;if(!ok)throw std::runtime_error(std::string("DS5a: ")+message);};
  const auto assertNear=[&](double a,double b,const char* message){check(std::abs(a-b)<1e-5,message);};
  // Arithmetic inputs below are the normative Q4/04 examples, not record substitutes.
  const ds::Scaling scaling{1.5,1,1.4};
  assertNear(ds::ArmorPiece(40,60,scaling),49.6,"armor +.4 percent");
  assertNear(ds::ArmorPiece(40,60,{1.5,2,2.4}),49.6,"armor Scaling uses GMST delta");
  for(auto pair:{std::make_pair(0.,0.),{500.,.8},{1000.,.9},{1500.,.9}})assertNear(ds::ArmorCurve(pair.first),pair.second,"absolute armor curve");
  assertNear(ds::Block(50),.35,"block skill");assertNear(ds::Block(1000),.85,"block cap");
  class TestRefinement final:public ds::RefinementTierProvider { public: unsigned value=0;unsigned Tier(const void*)const override{return value;} } provider;
  for(unsigned tier=0;tier<4;++tier){provider.value=tier;assertNear(ds::ArmorPiece(40,60,scaling,provider.Tier(nullptr)),49.6*(1+.25*tier),"refinement once");}
  for(double invalid:{-1.,std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN(),1e8}) {
    ds::Trace t;t.weaponBase=invalid;ds::Finish(t,scaling,0,false);check(t.status==ds::Status::Invalid,"invalid arithmetic isolated");
  }
  std::ifstream in(manifestPath);ds::Json manifest;in>>manifest;
  std::vector<std::filesystem::path> paths;
  for(const auto& row:manifest.at("plugins"))paths.push_back(manifestPath.parent_path()/row.at("filename").get<std::string>());
  espm::Loader loader(paths);PartOne host;host.AttachEspm(&loader);
  const auto& browser=loader.GetBrowser();auto& cache=browser.GetCache();
  auto resolve=[&](const StableFormKey& key){auto file=browser.FindSourceByFilename(key.plugin.c_str());if(!file)throw std::runtime_error("plugin absent");return browser.ToRuntimeFormId(*file,key.localId);};
  const auto id=[&](const char* text){return resolve(ds::Key(text));};
  const auto weaponId=id("skyrim.esm|01397E"),armorId=id("skyrim.esm|012E46"),raceId=id("skyrim.esm|013746");
  const auto weapon=espm::Convert<espm::WEAP>(browser.LookupById(weaponId).rec)->GetData(cache);
  const auto armor=espm::Convert<espm::ARMO>(browser.LookupById(armorId).rec)->GetData(cache);
  ds::Json catalog={{"version",1},{"records",ds::Json::array()},{"gmsts",ds::Json::object()}};
  for(const auto& pair:std::vector<std::pair<std::string,std::string>>{{"fDamagePCSkillMax","skyrim.esm|0C5C0F"},{"fArmorRatingBase","skyrim.esm|01A157"},{"fArmorRatingPCMax","skyrim.esm|0C5C0C"}}) {
    const auto runtime=id(pair.second.c_str());
    const auto gmst=espm::Convert<espm::GMST>(browser.LookupById(runtime).rec);
    check(gmst!=nullptr,"winning GMST present");
    catalog["gmsts"][pair.first]={{"stableFormKey",pair.second},{"runtimeId",runtime},{"value",gmst->GetData(cache).value}};
  }
  const auto row=[&](const char* key,const char* type,double base,const char* skill,bool ranged=false){return ds::Json{
    {"stableFormKey",key},{"runtimeId",id(key)},{"type",type},{"base",base},{"skill",skill},{"ranged",ranged},
    {"clothing",false},{"damageResist",0},{"keywords",ds::Json::array()},{"status","SUPPORTED"}};};
  catalog["records"].push_back(row("skyrim.esm|01397E","WEAP",weapon.weapData->damage,"OneHanded"));
  catalog["records"].push_back(row("skyrim.esm|012E46","ARMO",armor.baseRatingX100/100.,"LightArmor"));
  const auto race=espm::Convert<espm::RACE>(browser.LookupById(raceId).rec)->GetData(cache);
  catalog["records"].push_back(row("skyrim.esm|013746","RACE",race.unarmedDamage,""));
  const auto bowId=id("skyrim.esm|013841"),ammoId=id("skyrim.esm|01397D");
  const auto bow=espm::Convert<espm::WEAP>(browser.LookupById(bowId).rec)->GetData(cache);
  // AMMO libespm only exposes weight. Damage comes from the approved catalog
  // winner skyrim.esm|01397D (catalog/combat.json), not that incomplete reader.
  constexpr double ammoDamage=8;
  catalog["records"].push_back(row("skyrim.esm|013841","WEAP",bow.weapData->damage,"Marksman",true));
  catalog["records"].push_back(row("skyrim.esm|01397D","AMMO",ammoDamage,""));
  auto bridge=std::make_shared<ds::Bridge>(resolve);
  check(!bridge->catalog&&bridge->catalogReason==ds::Reason::CatalogAbsent,"catalog absent");
  check(!bridge->SetCatalog("{}")&&bridge->catalogReason==ds::Reason::CatalogInvalid,"catalog invalid");
  auto invalidCatalog=catalog;invalidCatalog["records"][0]["runtimeId"]=armorId;
  check(!bridge->SetCatalog(invalidCatalog.dump()),"catalog runtime mismatch");
  check(bridge->SetCatalog(catalog.dump()),"catalog accepted");
  check(bridge->SetCatalog(catalog.dump()),"same catalog reused");
  check(!bridge->SetCatalog(invalidCatalog.dump())&&bridge->catalog!=nullptr,"accepted catalog immutable");
  // Rebind every stable key to a different runtime namespace, never persist an index.
  ds::Json moved=catalog;
  const auto shifted=[&](const StableFormKey& key){return resolve(key)+static_cast<uint32_t>(1u<<24);};
  for(auto& item:moved["records"])item["runtimeId"]=shifted(ds::Key(item.at("stableFormKey")));
  for(auto& item:moved["gmsts"].items())item.value()["runtimeId"]=shifted(ds::Key(item.value().at("stableFormKey")));
  ds::Bridge reordered(shifted);check(reordered.SetCatalog(moved.dump()),"plugin changed position");
  assertNear(reordered.catalog->records.begin()->second.base,bridge->catalog->records.begin()->second.base,"same winner after reorder");
  const uint32_t actorA=std::numeric_limits<uint32_t>::max()-1,actorD=actorA-1;
  host.CreateActor(actorA,{0,0,0},0,0x3c);host.CreateActor(actorD,{0,0,0},0,0x3c);
  auto& attacker=host.worldState.GetFormAt<MpActor>(actorA);auto& defender=host.worldState.GetFormAt<MpActor>(actorD);
  Equipment offense,defense;offense.inv.entries.push_back(Worn(weaponId));defense.inv.entries.push_back(Worn(armorId));
  attacker.SetEquipment(offense);defender.SetEquipment(defense);
  ds::Json profile={{"version",1},{"revision",1},{"subject",{{"kind","NPC"}}},{"race",{{"status","SUPPORTED"},{"value","skyrim.esm|013746"}}},
    {"skills",ds::Json::object()},{"effects",ds::Json::object()}};
  for(const auto* skill:ds::SkillNames)profile["skills"][skill]={{"status","SUPPORTED"},{"value",50}};
  for(const auto* effect:{"fortifyOneHandedDamage","fortifyTwoHandedDamage","fortifyArcheryDamage","fortifyUnarmedDamage","fortifyPowerAttacks",
      "fortifyBashDamage","fortifyArmorRating","fortifyBlock","resistArrowDamage","resistPowerAttackDamage","fortifySneakAttacks"})
    profile["effects"][effect]={{"status","UNSUPPORTED"},{"value",nullptr}};
  auto ownerA=host.worldState.LookupFormById(actorA),ownerD=host.worldState.LookupFormById(actorD);
  ds::Settings settings;settings.modes.fill(ds::Mode::Shadow);
  auto buffer=std::make_shared<ds::Buffer>();ds::Formula formula(Legacy(),bridge,settings,buffer);
  HitData hit{};hit.aggressor=actorA;hit.target=actorD;hit.source=weaponId;
  check(formula.Evaluate(attacker,defender,hit).reason==ds::Reason::ProfileAbsent,"missing profiles");
  check(bridge->Publish(actorA,ownerA,1,profile.dump()),"new attacker profile");
  check(bridge->Publish(actorD,ownerD,1,profile.dump()),"new defender profile");
  const auto parses=bridge->profileParses;
  for(int i=0;i<20;++i)check(bridge->Publish(actorA,ownerA,1,profile.dump()),"same revision");
  check(bridge->profileParses==parses,"same revision parsed once");
  for(bool block:{false,true})for(int flags=0;flags<16;++flags) {
    defender.SetIsBlockActive(block);hit.isHitBlocked=(flags&1)!=0;hit.isPowerAttack=(flags&2)!=0;hit.isSneakAttack=(flags&4)!=0;hit.isBashAttack=(flags&8)!=0;
    const auto original=Legacy()->CalculateDamage(attacker,defender,hit);
    assertNear(formula.CalculateDamage(attacker,defender,hit),original,"shadow equals actual full legacy chain");
    const auto t=formula.Evaluate(attacker,defender,hit);
    check(t.status==ds::Status::Calculated&&t.attackerRevision==1&&t.defenderRevision==1,"atomic profiles");
    assertNear(t.candidate,weapon.weapData->damage*1.25*(1-ds::ArmorCurve(armor.baseRatingX100/100.*1.2))*(block&&hit.isHitBlocked?.65:1),"real host candidate");
  }
  check(bridge->profileParses==parses,"hits never parse profiles");
  ds::Settings off;auto offBuffer=std::make_shared<ds::Buffer>();ds::Formula offFormula(Legacy(),bridge,off,offBuffer);
  assertNear(offFormula.CalculateDamage(attacker,defender,hit),Legacy()->CalculateDamage(attacker,defender,hit),"off chain exact output");
  check(offBuffer->hits==0&&!ds::Enabled(off),"off no wrapper/trace");
  profile["revision"]=2;profile["skills"]["OneHanded"]["value"]=100;
  check(bridge->Publish(actorA,ownerA,2,profile.dump()),"new revision");
  check(formula.Evaluate(attacker,defender,hit).attackerRevision==2&&formula.Evaluate(attacker,defender,hit).defenderRevision==1,"one full revision per side");
  profile["skills"]["OneHanded"]["value"]=-1;profile["revision"]=3;
  check(!bridge->Publish(actorA,ownerA,3,profile.dump()),"negative profile rejected");
  check(formula.Evaluate(attacker,defender,hit).status==ds::Status::Invalid,"invalid profile trace");
  profile["revision"]=4;profile["skills"]["OneHanded"]={{"status","UNSUPPORTED"},{"value",nullptr}};
  check(bridge->Publish(actorA,ownerA,4,profile.dump()),"unsupported skill explicit");
  check(formula.Evaluate(attacker,defender,hit).reason==ds::Reason::SkillAbsent,"unsupported skill no neutral substitution");
  profile["revision"]=5;profile["skills"]["OneHanded"]={{"status","SUPPORTED"},{"value",50}};
  check(bridge->Publish(actorA,ownerA,5,profile.dump()),"restore profile");
  hit.isHitBlocked=false;hit.isPowerAttack=false;hit.isSneakAttack=false;hit.isBashAttack=false;
  defender.SetIsBlockActive(false);
  hit.source=0x1f4;check(formula.Evaluate(attacker,defender,hit).family==ds::Family::Unarmed,"unarmed race snapshot");
  hit.source=weaponId;
  Equipment ranged;ranged.inv.entries.push_back(Worn(bowId));attacker.SetEquipment(ranged);hit.source=bowId;
  check(formula.Evaluate(attacker,defender,hit).reason==ds::Reason::AmmoAbsent,"ranged needs equipped ammo");
  ranged.inv.entries.push_back(Worn(ammoId));attacker.SetEquipment(ranged);
  const auto arrowTrace=formula.Evaluate(attacker,defender,hit);
  check(arrowTrace.status==ds::Status::Calculated&&arrowTrace.family==ds::Family::Ranged,"equipped bow plus ammo");
  assertNear(arrowTrace.preDefense,(bow.weapData->damage+ammoDamage)*1.25,"ammo added exactly once");
  attacker.SetEquipment(offense);hit.source=weaponId;
  auto enchantCatalog=catalog;enchantCatalog["records"][1]["damageResist"]=50;
  auto enchantBridge=std::make_shared<ds::Bridge>(resolve);check(enchantBridge->SetCatalog(enchantCatalog.dump()),"record ENCH transport");
  enchantBridge->Publish(actorA,ownerA,5,profile.dump());enchantBridge->Publish(actorD,ownerD,5,profile.dump());
  ds::Formula enchantFormula(Legacy(),enchantBridge,settings,std::make_shared<ds::Buffer>());
  const auto enchantTrace=enchantFormula.Evaluate(attacker,defender,hit);
  assertNear(enchantTrace.recordDamageResist,50,"record DamageResist preserved once");
  assertNear(enchantTrace.armorReduction,ds::ArmorCurve(enchantTrace.armor+50),"record DamageResist before curve");
  auto invalidProfile=profile;invalidProfile["revision"]=6;invalidProfile["skills"]["OneHanded"]["value"]=nullptr;
  check(!enchantBridge->Publish(actorA,ownerA,6,invalidProfile.dump()),"null/NaN transport invalid");
  auto activeSettings=settings;activeSettings.modes.fill(ds::Mode::Active);auto activeBuffer=std::make_shared<ds::Buffer>();
  ds::Formula active(Legacy(),bridge,activeSettings,activeBuffer);
  assertNear(active.CalculateDamage(attacker,defender,hit),Legacy()->CalculateDamage(attacker,defender,hit),"active gated until DS7");
  check(activeBuffer->samples[0].trace.reason==ds::Reason::ActiveRequiresDS7,"active trace prerequisite");
  const auto bench=[&](const IDamageFormula& f,const char* label) {
    std::vector<double> times;times.reserve(20001);volatile float sink=0;
    for(int warm=0;warm<2000;++warm)sink=f.CalculateDamage(attacker,defender,hit);
    for(int round=0;round<20001;++round){auto begin=std::chrono::steady_clock::now();sink=f.CalculateDamage(attacker,defender,hit);
      times.push_back(std::chrono::duration<double,std::nano>(std::chrono::steady_clock::now()-begin).count());}
    std::sort(times.begin(),times.end());std::cout<<"BENCH "<<label<<" median_ns="<<times[10000]<<" p99_ns="<<times[19800]<<" samples=20001 hits_per_sample=1 sink="<<sink<<'\n';
  };
  auto legacy=Legacy();bench(*legacy,"legacy");bench(formula,"shadow");
  check(buffer->size==ds::Buffer::Capacity&&buffer->hits>ds::Buffer::Capacity,"bounded trace overwrite");
  check(buffer->Read()["samples"][0]["q16Contribution"]==0,"Q16 zero declared");
  auto ephemeral=std::make_shared<int>(1);check(bridge->Publish(123,ephemeral,5,profile.dump()),"weak cache owner");
  const auto count=bridge->ProfileCount();ephemeral.reset();check(bridge->ProfileCount()==count-1,"destroyed actor cleaned outside hit");
  bridge->Publish(actorA,ownerA,0,"null");check(!bridge->Get(actorA,&attacker),"unbound actor cleared");
  std::cout<<"PASS DS-5a "<<total<<" checks profileParses="<<bridge->profileParses<<'\n';
}
