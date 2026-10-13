#pragma once
#include "aetherius_combat/WeaponPoison.h"
#include "ActionListener.h"
#include "FormDesc.h"
#include "HitMessage.h"
#include <iostream>
#include <thread>
#include "ActiveMagicEffectsMap.h"
#include "UpdateEquipmentMessage.h"
#include "MessageSerializerFactory.h"
#include "libespm/RecordHeaderAccess.h"
#include <cstring>
#include <spdlog/sinks/ostream_sink.h>
#include <sstream>

// Standalone native tests run on PartOne/WorldState without any network listener.
inline void RunWeaponPoisonTests(const std::filesystem::path& manifestPath,
                                const std::filesystem::path& fixturePath) {
  using namespace aetherius::poison;
  int checks = 0;
  auto check = [&](bool ok, const char* why) { ++checks; if (!ok) throw std::runtime_error(why); };
  std::ifstream in(manifestPath); nlohmann::json manifest; in >> manifest;
  std::vector<std::filesystem::path> paths;
  for (const auto& plugin : manifest.at("plugins")) paths.push_back(manifestPath.parent_path() / plugin.at("filename").get<std::string>());
  espm::Loader loader(paths); PartOne host; host.AttachEspm(&loader);
  auto resolve = [&](const char* key) { return FormDesc::FromString(key).ToFormId(host.worldState.pluginIndexMapping); };
  const auto cell = resolve("3c:Skyrim.esm"), dagger = resolve("1397e:Skyrim.esm"), bow = resolve("13985:Skyrim.esm");
  const auto poison = resolve("3a5a4:Skyrim.esm");
  // Native resolver itself must survive a changed plugin position.
  PluginIndexMapping initialMap, shiftedMap;
  initialMap.Build({"Skyrim.esm","Vokrii - Minimalistic Perks of Skyrim.esp"});
  shiftedMap.Build({"Vokrii - Minimalistic Perks of Skyrim.esp","Skyrim.esm"});
  const auto stablePoison=FormDesc::FromString("3a5a4:Skyrim.esm");
  check(stablePoison.ToFormId(initialMap)!=stablePoison.ToFormId(shiftedMap),"native resolution fixed a runtime slot");
  check(FormDesc::FromFormId(stablePoison.ToFormId(initialMap),initialMap)==stablePoison,"first native stable resolution mismatch");
  check(FormDesc::FromFormId(stablePoison.ToFormId(shiftedMap),shiftedMap)==stablePoison,"shifted native stable resolution mismatch");
  const auto alch = espm::GetData<espm::ALCH>(poison, &host.worldState);
  check(alch.isPoison && !alch.effects.empty(), "official poison fixture missing");
  std::cout << "FIXTURE poison=3a5a4:Skyrim.esm effects=" << alch.effects.size() << '\n';
  for (const auto& raw : alch.effects) {
    const auto record=loader.GetBrowser().LookupById(poison);
    const auto effectId=record.ToGlobalId(raw.effectId);
    const auto data=espm::GetData<espm::MGEF>(effectId,&host.worldState).data;
    std::cout << "effect av=" << static_cast<int>(data.primaryAV) << " type=" << static_cast<int>(data.effectType)
      << " magnitude=" << raw.magnitude << " duration=" << raw.duration << '\n';
  }
  const auto attackerId=host.CreateActor(0,{0,0,0},0,cell), targetId=host.CreateActor(0,{0,0,0},0,cell);
  auto& attacker=host.worldState.GetFormAt<MpActor>(attackerId);
  auto& target=host.worldState.GetFormAt<MpActor>(targetId);
  host.serverState.Connect(0,"D-P1-unit"); host.SetUserActor(0,attackerId);
  host.serverState.Connect(1,"D-P1-target"); host.SetUserActor(1,targetId);
  auto entry = [&](uint32_t id, Inventory::Worn hand) { Inventory::Entry e(id,1); e.SetWorn(hand); return e; };
  auto setup = [&](uint32_t weapon = 0, Inventory::Worn hand=Inventory::Worn::Right) {
    Inventory inv; inv.AddItem(poison,2); Equipment eq;
    if (weapon) { inv.AddItem(weapon,1); eq.inv.entries.push_back(entry(weapon,hand)); }
    attacker.SetInventory(inv); attacker.SetEquipment(eq);
  };
  auto weaponEntry = [&]() -> const Inventory::Entry& {
    for(const auto& e:attacker.GetInventory().entries) if(e.baseId==dagger && e.GetWorn()!=Inventory::Worn::None)return e;
    throw std::runtime_error("worn owned dagger missing");
  };
  const auto normalValues=attacker.GetChangeForm().actorValues;
  host.worldState.aetheriusWeaponPoison=true;
  setup(); auto before=attacker.GetInventory().ToJson().dump();
  check(attacker.OnEquip(poison),"poison refused before routed handler");
  check(attacker.GetInventory().ToJson().dump()==before,"without weapon consumed dose");
  check(attacker.GetPoisonResult()==static_cast<uint32_t>(Result::NoWeapon),"missing weapon reason");
  for(uint32_t bonus:{0u,2u,4u,6u}) {
    setup(dagger); attacker.SetPoisonDoseBonus(bonus); before=attacker.GetInventory().ToJson().dump();
    check(attacker.OnEquip(poison),"poison use failed");
    check(attacker.GetInventory().GetItemCount(poison)==1,"one dose not consumed exactly once");
    check(weaponEntry().poisonId==poison && weaponEntry().poisonCount==1+bonus,"wrong poison/cargo");
    check(weaponEntry().GetWorn()==Inventory::Worn::Right,"weapon unequipped in inventory");
    check(attacker.GetEquipment().inv.entries[0].poisonCount==1+bonus,"equipment projection lacks doses");
    check(attacker.GetChangeForm().actorValues.ToTuple()==normalValues.ToTuple(),"poison ingested or harmed user");
    const auto coated=attacker.GetInventory().ToJson().dump();
    (void)attacker.OnEquip(poison); check(attacker.GetInventory().ToJson().dump()==coated,"unverified replacement consumed second dose");
    // A delayed/untrusted equipment input cannot strip poison or invent more charges.
    auto stale=attacker.GetEquipment(); stale.inv.entries[0].poisonId=1; stale.inv.entries[0].poisonCount=500;
    attacker.SetEquipment(stale); check(weaponEntry().poisonCount==1+bonus,"client became poison writer");
    check(attacker.GetEquipment().inv.entries[0].poisonId==poison,"client poison record accepted");
    for(uint32_t i=0;i<1+bonus;++i){target.RemoveAllMagicEffects();target.SetPercentages(normalValues);const auto health=target.GetChangeForm().actorValues.healthPercentage;
      attacker.ApplyWeaponPoisonHit(target,dagger,false,false,false);
      check(target.GetChangeForm().actorValues.healthPercentage<health,"target did not lose health from official poison");
      check(attacker.GetPoisonResult()==static_cast<uint32_t>(Result::PartialEffects) &&
        (attacker.GetPoisonUnsupported() & static_cast<uint32_t>(Family::Conditions)),"official VMAD script parcel not declared unsupported");
      check(attacker.GetChangeForm().actorValues.ToTuple()==normalValues.ToTuple(),"attacker affected by poison hit");
      check(weaponEntry().poisonCount.value_or(0)==bonus-i,"dose not decremented");
    }
    check(!weaponEntry().poisonId && !weaponEntry().poisonCount,"zero dose not cleared");
  }
  setup(dagger,Inventory::Worn::Left);attacker.SetPoisonDoseBonus(0);(void)attacker.OnEquip(poison);
  check(weaponEntry().GetWorn()==Inventory::Worn::Left,"single left-hand weapon not preserved");
  const auto coated=attacker.GetInventory().ToJson().dump();
  for(int flags=0;flags<3;++flags){target.SetPercentages(normalValues);attacker.ApplyWeaponPoisonHit(target,dagger,flags==0,flags==1,flags==2);
    check(attacker.GetInventory().ToJson().dump()==coated,"blocked/bash/fatal consumed poison");
    check(target.GetChangeForm().actorValues.ToTuple()==normalValues.ToTuple(),"blocked/bash/fatal applied poison");}
  attacker.ApplyWeaponPoisonHit(target,bow,false,false,false);check(attacker.GetInventory().ToJson().dump()==coated,"other source consumed dose");
  auto dual=attacker.GetEquipment();dual.inv.entries.push_back(entry(dagger,Inventory::Worn::Right));attacker.SetEquipment(dual);
  target.SetPercentages(normalValues);attacker.ApplyWeaponPoisonHit(target,dagger,false,false,false);
  check(attacker.GetPoisonResult()==static_cast<uint32_t>(Result::AmbiguousWeapon),"same record dual hit not refused");
  check(target.GetChangeForm().actorValues.ToTuple()==normalValues.ToTuple(),"ambiguous hand damaged target");
  setup(dagger);dual=attacker.GetEquipment();dual.inv.entries.push_back(entry(dagger,Inventory::Worn::Left));attacker.SetEquipment(dual);
  before=attacker.GetInventory().ToJson().dump();(void)attacker.OnEquip(poison);
  check(before==attacker.GetInventory().ToJson().dump(),"ambiguous poison use consumed dose");
  setup(bow);(void)attacker.OnEquip(poison);before=attacker.GetInventory().ToJson().dump();attacker.ApplyWeaponPoisonHit(target,bow,false,false,false);
  check(before==attacker.GetInventory().ToJson().dump(),"ranged unverified rule consumed poison");
  check(attacker.GetPoisonResult()==static_cast<uint32_t>(Result::RangedUnsupported),"ranged reason missing");
  // Pure transition: stacked weapons poison exactly one physical item.
  Inventory stacked;stacked.AddItem(dagger,3);stacked.AddItem(poison,1);Equipment eq;eq.inv.entries.push_back(entry(dagger,Inventory::Worn::Right));
  check(Coat(stacked,eq,poison,6,{0})==Result::Applied,"stack coat refused");
  check(stacked.GetItemCount(dagger)==3 && stacked.entries.size()==2,"stack conservation failed");
  check(stacked.entries[0].count==1 && stacked.entries[1].count==2 && !stacked.entries[1].poisonId,"whole stack poisoned");
  check(FindOwned(stacked,eq.inv.entries[0]).has_value(),"poisoned stack instance became ambiguous");
  // Dedicated host effect operation: all three resources decrease, never restore.
  espm::Effects::Effect effect;effect.magnitude=5;
  effect.effectId=loader.GetBrowser().LookupById(poison).ToGlobalId(alch.effects.front().effectId);
  espm::MGEF::DATA info{};info.effectType=espm::MGEF::EffectType::ValueMod;info.flags=espm::MGEF::Flags::Detrimental;
  for(auto av:{espm::ActorValue::Health,espm::ActorValue::Magicka,espm::ActorValue::Stamina}){
    target.SetPercentages(normalValues);info.primaryAV=av;check(target.ApplyWeaponPoisonEffect(effect,info,false)==0,"direct family refused");
    const auto values=target.GetChangeForm().actorValues;
    check(av==espm::ActorValue::Health?values.healthPercentage<1:av==espm::ActorValue::Magicka?values.magickaPercentage<1:values.staminaPercentage<1,"resource restored instead of damaged");
  }
  info.primaryAV=espm::ActorValue::Health;
  target.RemoveAllMagicEffects();target.SetPercentages(normalValues);
  auto timed=effect;timed.duration=2;
  check(target.ApplyWeaponPoisonEffect(timed,info,false)==0,"timed damage refused");
  const auto first=target.GetChangeForm().actorValues.healthPercentage;
  check(target.GetActiveMagicEffects().ToJson().empty(),"transient poison persisted runtime identity");
  target.ReapplyMagicEffects();check(target.GetChangeForm().actorValues.healthPercentage==first,"transient poison reapplied as restoration");
  check(target.ApplyWeaponPoisonEffect(timed,info,false)==static_cast<uint32_t>(Family::Overlap),"overlap not declared");
  std::this_thread::sleep_for(std::chrono::milliseconds(1050));host.Tick();
  check(target.GetChangeForm().actorValues.healthPercentage<first,"timed tick did not damage target");
  check(!target.GetActiveMagicEffects().Has(info.primaryAV),"timed poison did not expire");

  for(int family=0;family<6;++family){auto unsupported=effect;auto data=info;bool condition=false;
    if(family==0)unsupported.duration=86401;if(family==1)data.effectType=espm::MGEF::EffectType::Paralysis;
    if(family==2)data.primaryAV=espm::ActorValue::None;if(family==3)unsupported.magnitude=-5;
    if(family==4)unsupported.areaOfEffect=1;if(family==5)condition=true;
    target.SetPercentages(normalValues);check(target.ApplyWeaponPoisonEffect(unsupported,data,condition)!=0,"unsupported family silently accepted");
    check(target.GetChangeForm().actorValues.ToTuple()==normalValues.ToTuple(),"unsupported effect changed resources");}
  target.RemoveAllMagicEffects();auto low=normalValues;low.healthPercentage=0.001f;target.SetPercentages(low);
  check(target.ApplyWeaponPoisonEffect(effect,info,false)==static_cast<uint32_t>(Family::Lethal),"uncertified poison kill not refused");
  check(target.GetChangeForm().actorValues.healthPercentage==low.healthPercentage,"refused lethal parcel changed health");
  // Native accepted-hit path, with the same existing formula on both sides.
  host.SetDamageFormula(Legacy());host.SetUserActor(0,attackerId);host.worldState.aetheriusWeaponPoison=true;
  setup(dagger);HitMessage msg;msg.data.aggressor=0x14;msg.data.target=targetId;msg.data.source=dagger;
  const float uncoatedDamage=host.CalculateDamage(attacker,target,msg.data);
  (void)attacker.OnEquip(poison);check(host.CalculateDamage(attacker,target,msg.data)==uncoatedDamage,"poison changed physical damage formula");
  target.RemoveAllMagicEffects();target.SetPercentages(normalValues);attacker.SetLastHitTime(targetId,std::chrono::steady_clock::now()-std::chrono::seconds(10));
  RawMessageData raw;raw.userId=0;host.GetActionListener().OnHit(raw,msg);
  check(!weaponEntry().poisonId,"accepted OnHit did not spend final dose");
  check(target.GetChangeForm().actorValues.healthPercentage<1-uncoatedDamage/target.GetMaximumValues().health,"OnHit did not apply separate poison damage");
  // Opt out restores the exact legacy inventory transition (remove ALCH only).
  host.worldState.aetheriusWeaponPoison=false;setup(dagger);auto expected=attacker.GetInventory();expected.RemoveItems({{poison,1}});
  (void)attacker.OnEquip(poison);check(attacker.GetInventory().ToJson().dump()==expected.ToJson().dump(),"disabled inventory differs byte-for-byte from legacy");
  check(!attacker.GetInventory().entries[0].poisonId,"disabled path poisoned weapon");
  // D-P1-fix1: data copied from the owner's session, not a synthetic base-game
  // weapon. Fixture stores StableFormKeys; remap every entry for this load order.
  std::ifstream fixtureIn(fixturePath); nlohmann::json fixture; fixtureIn >> fixture;
  std::cout << "REGRESSION source=" << fixture.at("source") << " sha256=" << fixture.at("sourceSha256") << '\n';
  auto remap = [&](nlohmann::json inventory) {
    for (auto& e : inventory.at("entries")) {
      e["baseId"] = resolve(e.at("baseKey").get<std::string>().c_str());
      e.erase("baseKey");
    }
    return inventory;
  };
  const auto realWeapon = resolve(fixture.at("weaponKey").get<std::string>().c_str());
  const auto corrosion = resolve(fixture.at("poisonKey").get<std::string>().c_str());
  const auto realInv = Inventory::FromJson(remap(fixture.at("inventory")));
  auto eqJson = fixture.at("equipment"); eqJson["inv"] = remap(eqJson["inv"]);
  const auto realEq = Equipment::FromJson(eqJson);
  const auto weaponData = espm::GetData<espm::WEAP>(realWeapon, &host.worldState);
  check(weaponData.weapDNAM && CanCoat(weaponData.weapDNAM->animType), "session weapon not coatable WEAP winner");
  check(weaponData.weapDNAM->animType==espm::WEAP::AnimType::OneHandDagger,"session weapon no longer dagger");
  const auto weaponRecord=loader.GetBrowser().LookupById(realWeapon);
  uint32_t enchantment=0;
  espm::RecordHeaderAccess::IterateFields(weaponRecord.rec,[&](const char* type,uint32_t size,const char* data){
    if(!std::memcmp(type,"EITM",4) && size==sizeof(enchantment))std::memcpy(&enchantment,data,size);
  },host.worldState.GetEspmCache());
  check(enchantment!=0,"plugin dagger lost built-in enchantment fixture");
  std::cout << "WEAPON key=" << fixture.at("weaponKey") << " winner=" << paths.at(weaponRecord.GetSourceId()).filename()
    << " enchantment=" << FormDesc::FromFormId(weaponRecord.ToGlobalId(enchantment),host.worldState.pluginIndexMapping).ToString() << '\n';
  check(FormDesc::FromFormId(realWeapon, host.worldState.pluginIndexMapping).file != "Skyrim.esm", "regression lost plugin weapon");
  check(realInv.GetItemCount(realWeapon)==2 && realInv.GetItemCount(corrosion)==20, "fixture no longer represents session stacks");
  PluginIndexMapping movedWeapon; movedWeapon.Build({"Grimoire.esp","Skyrim.esm"});
  const auto weaponKey=FormDesc::FromString(fixture.at("weaponKey").get<std::string>());
  check(weaponKey.ToFormId(movedWeapon)!=realWeapon &&
    FormDesc::FromFormId(weaponKey.ToFormId(movedWeapon),movedWeapon)==weaponKey, "plugin weapon pinned to original slot");
  auto makeActor = [&](const Inventory& inv, const Equipment& equipment, uint32_t bonus=6) -> MpActor& {
    const auto id=host.CreateActor(0,{0,0,0},0,cell);
    auto& actor=host.worldState.GetFormAt<MpActor>(id);
    host.worldState.aetheriusWeaponPoison=false;
    actor.SetInventory(inv); actor.SetEquipment(equipment); actor.SetPoisonDoseBonus(bonus);
    host.SetUserActor(0,id); host.worldState.aetheriusWeaponPoison=true;
    host.Tick(); host.Messages().clear();
    return actor;
  };
  auto counts = [&]() {
    host.Tick(); std::pair<int,int> result{};
    for(const auto& m:host.Messages()) if(m.userId==0) {
      if(m.j.value("t",0)==static_cast<int>(MsgType::UpdateEquipment)) ++result.first;
      if(m.j.value("t",0)==static_cast<int>(MsgType::SetInventory)) ++result.second;
    }
    host.Messages().clear(); return result;
  };
  auto update = [&](MpActor& actor, Equipment equipment) {
    UpdateEquipmentMessage updateMsg; updateMsg.idx=actor.GetIdx(); updateMsg.data=equipment;
    SLNet::BitStream packet;PartOne::GetMessageSerializerInstance().Serialize(updateMsg,packet);
    auto updateRaw=raw;updateRaw.unparsed=packet.GetData();updateRaw.unparsedLength=packet.GetNumberOfBytesUsed();
    host.GetActionListener().OnUpdateEquipment(updateRaw,updateMsg);
  };
  auto repeat = [&](MpActor& actor, Equipment equipment, const char* label,
                    std::pair<int,int> expected = {0,0}) {
    for(int i=0;i<100;++i) {
      update(actor,equipment);
      check(counts()==expected,"repeated equipment publication count differs");
    }
    // The client's equip/unequip feedback increments numChanges too.
    for(int i=0;i<100;++i) {
      ++equipment.numChanges; update(actor,equipment);
      check(counts()==expected,"numChanges-only publication count differs");
    }
    std::cout << "CONVERGENCE " << label << " identical=100 increasing-numChanges=100 equipment="
      << 200*expected.first << " inventory=" << 200*expected.second << '\n';
  };
  std::ostringstream useLogs;
  const auto oldLogger=spdlog::default_logger();
  auto sink=std::make_shared<spdlog::sinks::ostream_sink_mt>(useLogs);
  auto testLogger=std::make_shared<spdlog::logger>("poison-use-test",sink);
  spdlog::set_default_logger(testLogger);
  struct RestoreLogger { std::shared_ptr<spdlog::logger> logger; ~RestoreLogger(){spdlog::set_default_logger(logger);} } restore{oldLogger};
  auto& realActor=makeActor(realInv,realEq);
  update(realActor,realEq); check(counts()==std::pair<int,int>{0,0},"clean initial equipment published to owner");
  check(realActor.OnEquip(corrosion),"real corrosion use unhandled");
  check(counts()==std::pair<int,int>{1,1},"accepted coating must publish once per channel");
  const auto findWorn = [&](const MpActor& actor) -> const Inventory::Entry& {
    for(const auto& e:actor.GetInventory().entries) if(e.baseId==realWeapon && e.GetWorn()!=Inventory::Worn::None)return e;
    throw std::runtime_error("session worn weapon missing");
  };
  check(realActor.GetInventory().GetItemCount(corrosion)==19,"real dose not consumed exactly once");
  check(realActor.GetInventory().GetItemCount(realWeapon)==2,"real weapon stack count changed");
  check(findWorn(realActor).count==1 && findWorn(realActor).poisonCount==7,"real coated unit not split with seven doses");
  check(!findWorn(realActor).name && !findWorn(realActor).chargePercent,"client-only presentation imported into host instance");
  const auto spare=std::find_if(realActor.GetInventory().entries.begin(),realActor.GetInventory().entries.end(),[&](const auto& e){return e.baseId==realWeapon && e.GetWorn()==Inventory::Worn::None;});
  check(spare!=realActor.GetInventory().entries.end() && spare->count==1 && !spare->poisonId,"spare copy coated or lost");
  const auto authoritativeEq=realActor.GetEquipment();
  repeat(realActor,authoritativeEq,"accepted");
  check(findWorn(realActor).poisonCount==7,"spare equipment entry cleared equipped instance");
  auto forged=realEq;
  for(auto& e:forged.inv.entries) if(e.baseId==realWeapon && e.GetWorn()!=Inventory::Worn::None){e.poisonId=poison;e.poisonCount=999;}
  repeat(realActor,forged,"accepted-stale-or-forged");
  check(findWorn(realActor).poisonId==corrosion && findWorn(realActor).poisonCount==7,"client poison selected another owned instance");
  const auto corrosionRecord=loader.GetBrowser().LookupById(corrosion);
  const auto corrosionData=espm::GetData<espm::ALCH>(corrosion,&host.worldState);
  check(corrosionData.isPoison && corrosionData.effects.size()==1,"corrosion winner changed");
  target.RemoveAllMagicEffects(); target.SetPercentages(normalValues);
  realActor.ApplyWeaponPoisonHit(target,realWeapon,false,false,false);
  check(realActor.GetPoisonResult()==static_cast<uint32_t>(Result::EffectsUnsupported) &&
    (realActor.GetPoisonUnsupported() & static_cast<uint32_t>(Family::Conditions)),"corrosion condition not declared UNSUPPORTED");
  check(target.GetChangeForm().actorValues.ToTuple()==normalValues.ToTuple() && findWorn(realActor).poisonCount==7,"unsupported corrosion applied or spent");
  check(counts()==std::pair<int,int>{0,0},"unsupported hit published unchanged poison state");
  const auto effectId=corrosionRecord.ToGlobalId(corrosionData.effects.front().effectId);
  const auto mgefRecord=loader.GetBrowser().LookupById(effectId);
  const auto corrosionEffect=espm::GetData<espm::MGEF>(effectId,&host.worldState).data;
  std::cout << "WINNER poison=" << fixture.at("poisonKey") << " plugin=" << paths.at(corrosionRecord.GetSourceId()).filename()
    << " effect=" << FormDesc::FromFormId(effectId,host.worldState.pluginIndexMapping).ToString()
    << " plugin=" << paths.at(mgefRecord.GetSourceId()).filename()
    << " archetype=" << static_cast<int>(corrosionEffect.effectType) << " av=" << static_cast<int>(corrosionEffect.primaryAV)
    << " magnitude=" << corrosionData.effects.front().magnitude << " duration=" << corrosionData.effects.front().duration << " UNSUPPORTED=Conditions\n";
  // Each real refusal gets one clean correction in a fresh authoritative state.
  for(int reason=0;reason<4;++reason) {
    auto inv=realInv; auto equipment=realEq;
    if(reason==0) for(auto& e:equipment.inv.entries)e.SetWorn(Inventory::Worn::None);
    if(reason==1) {auto extra=entry(realWeapon,Inventory::Worn::Left);extra.name="Blessed Northern Iron Dagger";equipment.inv.entries.push_back(extra);}
    if(reason==2) {
      inv.entries.erase(std::remove_if(inv.entries.begin(),inv.entries.end(),[&](const auto& e){return e.baseId==corrosion;}),inv.entries.end());
      equipment.inv.entries.erase(std::remove_if(equipment.inv.entries.begin(),equipment.inv.entries.end(),[&](const auto& e){return e.baseId==corrosion;}),equipment.inv.entries.end());
    }
    if(reason==3) for(auto& e:inv.entries) if(e.baseId==realWeapon){e.health=1.5f;e.count=1;}
    auto& refused=makeActor(inv,equipment); const auto prior=refused.GetInventory();
    check(refused.OnEquip(corrosion),"refusal must be handled without eating");
    check(refused.GetInventory()==prior,"refusal consumed item or altered inventory");
    check(refused.GetPoisonResult()==static_cast<uint32_t>(reason==0?Result::NoWeapon:reason==2?Result::ItemAbsent:Result::AmbiguousWeapon),"wrong refusal reason");
    check(counts()==std::pair<int,int>{1,1},"refusal must correct once");
    auto local=equipment; for(auto& e:local.inv.entries)if(e.baseId==realWeapon){e.poisonId=corrosion;e.poisonCount=1;}
    repeat(refused,local,"refused");
    refused.ApplyWeaponPoisonHit(target,realWeapon,false,false,false);
    check(target.GetChangeForm().actorValues.ToTuple()==normalValues.ToTuple(),"refused local poison applied on host");
    check(counts()==std::pair<int,int>{0,0},"refused local hit published poison");
    (void)refused.OnEquip(corrosion); check(counts()==std::pair<int,int>{0,0},"repeated refusal republished unchanged state");
  }
  // Stored host extras must disambiguate; client-only fields cannot create an
  // instance. Current charge is ignored even when previously saved by host.
  auto owned=entry(realWeapon,Inventory::Worn::Right), reported=owned;
  reported.name="client presentation"; reported.chargePercent=0.f; reported.health=1.5f;
  reported.enchantmentId=poison; reported.maxCharge=100.f; reported.removeEnchantmentOnUnequip=true; reported.soul=3;
  check(SameInstance(owned,reported),"client-only extras caused false mismatch");
  for(int extra=0;extra<6;++extra) {
    auto e=owned;
    if(extra==0)e.health=2.f;if(extra==1)e.enchantmentId=corrosion;if(extra==2)e.maxCharge=200.f;
    if(extra==3)e.removeEnchantmentOnUnequip=false;if(extra==4)e.name="host rename";if(extra==5)e.soul=5;
    check(!SameInstance(e,reported),"host instance discriminator ignored");
  }
  owned.chargePercent=99.f;check(SameInstance(owned,reported),"mutable charge treated as physical identity");
  Inventory distinct;auto tempered=owned;tempered.health=2.f;distinct.entries={owned,tempered};
  check(FindOwned(distinct,reported)==0,"stored health did not disambiguate host instances");
  distinct.entries={owned,owned};check(!FindOwned(distinct,reported),"true owned ambiguity guessed an instance");
  // Direct poison still spends/publishes once; stale client packets cannot
  // resurrect the final charge. Use the same two-copy plugin weapon fixture.
  auto supportedInv=realInv;supportedInv.AddItem(poison,2);
  auto& spender=makeActor(supportedInv,realEq,2);(void)spender.OnEquip(poison);
  check(counts()==std::pair<int,int>{1,1},"direct coating publication count");
  const auto staleCharges=spender.GetEquipment();
  for(int charge=2;charge>=0;--charge) {
    target.RemoveAllMagicEffects();target.SetPercentages(normalValues);
    spender.ApplyWeaponPoisonHit(target,realWeapon,false,false,false);
    check(counts()==std::pair<int,int>{1,1},"charge change must publish once");
    check(findWorn(spender).poisonCount.value_or(0)==static_cast<uint32_t>(charge),"charge count after publication incorrect");
    repeat(spender,staleCharges,charge?"spent":"exhausted");
    check(findWorn(spender).poisonCount.value_or(0)==static_cast<uint32_t>(charge),"feedback resurrected spent charge");
  }
  check(!findWorn(spender).poisonId,"final poison record not cleared");
  // An unsolicited client-only poison mismatch before any use gets at most
  // one correction. A clean response does not rearm the correction budget.
  auto& unsolicited=makeActor(realInv,realEq);
  auto localPoison=realEq;
  for(auto& e:localPoison.inv.entries)if(e.baseId==realWeapon && e.GetWorn()!=Inventory::Worn::None){e.poisonId=corrosion;e.poisonCount=1;}
  update(unsolicited,localPoison);check(counts()==std::pair<int,int>{1,1},"first poison mismatch not corrected once");
  repeat(unsolicited,localPoison,"unsolicited-mismatch");
  update(unsolicited,realEq);check(counts()==std::pair<int,int>{0,0},"clean equipment rearmed publication");
  update(unsolicited,localPoison);check(counts()==std::pair<int,int>{0,0},"oscillating client poison restarted loop");
  check(!findWorn(unsolicited).poisonId,"unsolicited poison written to owned inventory");
  const auto logText=useLogs.str();
  check(logText.find("weapon=14c4:Grimoire.esp poison=ffa02:Skyrim.esm reason=Applied")!=std::string::npos,"accepted stable records absent from log");
  for(const char* reason:{"NoWeapon","AmbiguousWeapon","ItemAbsent"})
    check(logText.find(std::string("reason=")+reason)!=std::string::npos,"refusal not logged at info");
  check(logText.find("actor=")!=std::string::npos,"actor absent from use log");
  // Option disabled: maintainer OnUpdateEquipment stores input verbatim, and
  // legacy poison consumption publishes inventory only, never equipment.
  auto& disabled=makeActor(realInv,realEq);host.worldState.aetheriusWeaponPoison=false;
  update(disabled,forged);check(disabled.GetEquipment()==forged,"disabled equipment differs from maintainer");
  // Maintainer SendToNeighbours includes self in this host's listener set:
  // one original forwarded packet, no additional D-P1 deferred publication.
  check(counts()==std::pair<int,int>{1,0},"disabled update added maintainer publications");
  // makeActor's inventory lacked this legacy poison: add through ordinary host API.
  disabled.SetInventory(supportedInv); counts(); auto legacy=supportedInv;legacy.RemoveItems({{poison,1}});
  (void)disabled.OnEquip(poison);
  check(disabled.GetInventory()==legacy,"disabled use changed maintainer inventory transition");
  check(counts()==std::pair<int,int>{0,1},"disabled use added equipment publication");
  repeat(disabled,forged,"disabled-maintainer-forwarding",{1,0});
  std::cout << "USE LOGS\n" << logText;
  std::cout << "PASS D-P1 " << checks << " checks; native PartOne, no sockets, official winner poison fixture\n";
}
