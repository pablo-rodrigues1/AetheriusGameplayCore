#pragma once

// D-P1-fix2: native command reached by CustomPacket, no poison OnEquip input.
// Real host, real load-order winners and actual session fixture, no socket.
inline void RunWeaponPoisonIntentTests(const std::filesystem::path& manifestPath,
                                      const std::filesystem::path& fixturePath) {
  using namespace aetherius::poison;
  std::ifstream in(manifestPath); nlohmann::json manifest; in >> manifest;
  std::vector<std::filesystem::path> paths;
  for (const auto& p : manifest.at("plugins")) paths.push_back(manifestPath.parent_path()/p.at("filename").get<std::string>());
  espm::Loader loader(paths); PartOne host; host.AttachEspm(&loader);
  auto resolve=[&](const std::string& key){return FormDesc::FromString(key).ToFormId(host.worldState.pluginIndexMapping);};
  std::ifstream fixtureIn(fixturePath); nlohmann::json fixture; fixtureIn >> fixture;
  auto remap=[&](nlohmann::json inv){for(auto& e:inv.at("entries")){e["baseId"]=resolve(e.at("baseKey"));e.erase("baseKey");}return inv;};
  const auto inventory=Inventory::FromJson(remap(fixture.at("inventory")));
  auto equipmentJson=fixture.at("equipment");equipmentJson["inv"]=remap(equipmentJson["inv"]);
  const auto equipment=Equipment::FromJson(equipmentJson);
  const auto weapon=resolve(fixture.at("weaponKey")),poison=resolve(fixture.at("poisonKey"));
  const auto actorId=host.CreateActor(0,{0,0,0},0,resolve("3c:Skyrim.esm"));
  auto& actor=host.worldState.GetFormAt<MpActor>(actorId);
  host.serverState.Connect(0,"D-P1-fix2-native-intent");host.SetUserActor(0,actorId);
  int checks=0;auto check=[&](bool ok,const char* why){++checks;if(!ok)throw std::runtime_error(why);};
  auto setup=[&](bool left){host.worldState.aetheriusWeaponPoison=false;actor.SetInventory(inventory);auto eq=equipment;
    for(auto& e:eq.inv.entries)if(e.baseId==weapon&&e.GetWorn()!=Inventory::Worn::None)e.SetWorn(left?Inventory::Worn::Left:Inventory::Worn::Right);
    actor.SetEquipment(eq);actor.SetPoisonDoseBonus(6);host.worldState.aetheriusWeaponPoison=true;};
  for(bool left:{false,true}) {
    setup(left);auto before=actor.GetInventory();actor.RequestWeaponPoison(poison,weapon,!left);
    check(actor.GetPoisonResult()==static_cast<uint32_t>(Result::WrongWeapon),"wrong hand accepted");check(actor.GetInventory()==before,"wrong hand consumed dose");
    actor.RequestWeaponPoison(resolve("f:Skyrim.esm"),weapon,left);
    check(actor.GetPoisonResult()==static_cast<uint32_t>(Result::InvalidPoison),"non-poison item accepted");check(actor.GetInventory()==before,"non-poison consumed");
    actor.RequestWeaponPoison(poison,resolve("1397e:Skyrim.esm"),left);check(actor.GetInventory()==before,"unequipped weapon accepted");
    actor.RequestWeaponPoison(poison,weapon,left);check(actor.GetPoisonResult()==static_cast<uint32_t>(Result::Applied),"session dagger refused");
    check(actor.GetInventory().GetItemCount(poison)==19,"must consume one of 20 doses");check(actor.GetInventory().GetItemCount(weapon)==2,"lost a dagger");
    auto coated=actor.GetInventory();int held=0;
    for(const auto& e:coated.entries)if(e.baseId==weapon&&e.poisonId){++held;check(e.count==1&&e.poisonCount==7,"host did not own 7 charges on one copy");check(e.GetWorn()==(left?Inventory::Worn::Left:Inventory::Worn::Right),"lost hand");}
    check(held==1,"poison spread to spare");
    actor.RequestWeaponPoison(poison,weapon,left);check(actor.GetInventory()==coated,"replacement consumed second dose");
    setup(left);auto eq=actor.GetEquipment();for(auto& e:eq.inv.entries)if(e.baseId==weapon&&e.GetWorn()==Inventory::Worn::None)e.SetWorn(left?Inventory::Worn::Right:Inventory::Worn::Left);
    actor.SetEquipment(eq);before=actor.GetInventory();actor.RequestWeaponPoison(poison,weapon,left);
    check(actor.GetPoisonResult()==static_cast<uint32_t>(Result::AmbiguousWeapon),"two hands accepted");check(actor.GetInventory()==before,"refusal consumed dose");
    setup(left);auto absent=actor.GetInventory();absent.RemoveItems({{poison,20}});actor.SetInventory(absent);
    actor.RequestWeaponPoison(poison,weapon,left);check(actor.GetPoisonResult()==static_cast<uint32_t>(Result::ItemAbsent),"absent poison accepted");check(actor.GetInventory()==absent,"absence changed inventory");
    setup(left);host.worldState.aetheriusWeaponPoison=false;before=actor.GetInventory();actor.RequestWeaponPoison(poison,weapon,left);
    check(actor.GetPoisonResult()==static_cast<uint32_t>(Result::Disabled)&&actor.GetInventory()==before,"disabled command mutated inventory");
  }
  std::cout<<"PASS D-P1-fix2 native intent: "<<checks<<" checks; two real enchanted copies, both hands, host 7 charges, one dose, refusals; no OnEquip input\n";
}
