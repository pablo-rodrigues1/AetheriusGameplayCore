#pragma once
#include "../forms/StableFormKey.h"
#include "../config/CombatSettings.h"
#include <map>
#include <set>
#include <vector>

namespace aetherius::combat {
inline const std::set<std::string>& Skills() {
  static const std::set<std::string> names = {"OneHanded","TwoHanded","Marksman","Block","HeavyArmor","LightArmor","Sneak","Destruction","Alteration","Restoration","Conjuration","Illusion","Alchemy","Enchanting","Smithing","Lockpicking","Speechcraft","Pickpocket"};
  return names;
}
struct PerkGrant { StableFormKey key; unsigned rank = 1; };
struct CombatProfile {
  uint64_t revision = 0;
  std::map<std::string,double> skills;
  std::vector<PerkGrant> perks;
  double health = 100, magicka = 100, stamina = 100;
  double Skill(const std::string& name) const {
    const auto it = skills.find(name); return it == skills.end() ? 0 : it->second;
  }
  bool Has(const StableFormKey& key) const {
    for (const auto& p : perks) if (p.key == key) return true;
    return false;
  }
  static CombatProfile FromJson(const nlohmann::json& j) {
    ExactKeys(j,{"schemaVersion","revision","skills","perks","baseAttributes"});
    if (!j.at("schemaVersion").is_number_integer() || j.at("schemaVersion") != 1)
      throw std::invalid_argument("unsupported CombatProfile schema");
    if (!j.at("revision").is_number_integer()) throw std::invalid_argument("revision must be integer");
    CombatProfile p;
    p.revision = static_cast<uint64_t>(Number(j,"revision",1,9007199254740991.0));
    if (!j.at("skills").is_object()) throw std::invalid_argument("skills must be object");
    for (const auto& item : j.at("skills").items()) {
      if (!Skills().count(item.key())) throw std::invalid_argument("unknown skill " + item.key());
      p.skills[item.key()] = Number(j.at("skills"),item.key().c_str(),0,100);
    }
    if (!j.at("perks").is_array() || j.at("perks").size() > 512) throw std::invalid_argument("invalid perks");
    std::set<StableFormKey> seen;
    for (const auto& perk : j.at("perks")) {
      ExactKeys(perk,{"key","rank","source"});
      if (perk.at("source") != "CLASS" || !perk.at("rank").is_number_integer()) throw std::invalid_argument("invalid perk grant");
      auto key = StableFormKey::Parse(perk.at("key").get<std::string>());
      if (!seen.insert(key).second) throw std::invalid_argument("duplicate perk");
      p.perks.push_back({key,static_cast<unsigned>(Number(perk,"rank",1,255))});
    }
    const auto& a = j.at("baseAttributes"); ExactKeys(a,{"health","magicka","stamina"});
    p.health = Number(a,"health",1,1000000); p.magicka = Number(a,"magicka",1,1000000); p.stamina = Number(a,"stamina",1,1000000);
    return p;
  }
  nlohmann::json ToJson() const {
    nlohmann::json grants = nlohmann::json::array();
    for (const auto& p : perks) grants.push_back({{"key",p.key.ToString()},{"rank",p.rank},{"source","CLASS"}});
    return {{"schemaVersion",1},{"revision",revision},{"skills",skills},{"perks",grants},{"baseAttributes",{{"health",health},{"magicka",magicka},{"stamina",stamina}}}};
  }
};
struct CombatRevision { uint64_t profile = 0, equipment = 0, effects = 0, providers = 0; };
struct ActorCombatState {
  CombatProfile profile;
  CombatRevision revision;
  // Validated on the server thread before publication. All absent skills become zero.
  bool Apply(CombatProfile incoming) {
    if (incoming.revision <= profile.revision) return false;
    profile = std::move(incoming); revision.profile = profile.revision; return true;
  }
};
}
