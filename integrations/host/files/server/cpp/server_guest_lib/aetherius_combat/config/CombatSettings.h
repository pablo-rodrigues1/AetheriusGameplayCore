#pragma once
#include <nlohmann/json.hpp>
#include <cmath>
#include <stdexcept>
#include <string>

namespace aetherius::combat {
inline double Number(const nlohmann::json& j, const char* key, double min, double max) {
  const auto& v = j.at(key);
  if (!v.is_number()) throw std::invalid_argument(std::string(key) + " must be numeric");
  const double n = v.get<double>();
  if (!std::isfinite(n) || n < min || n > max) throw std::invalid_argument(std::string(key) + " out of range");
  return n;
}
inline void ExactKeys(const nlohmann::json& j, std::initializer_list<const char*> keys) {
  if (!j.is_object()) throw std::invalid_argument("expected object");
  for (const auto& it : j.items()) {
    bool found = false;
    for (const auto* key : keys) if (it.key() == key) found = true;
    if (!found) throw std::invalid_argument("unknown field: " + it.key());
  }
}
struct CombatSettings {
  std::string mode = "legacy";
  bool enabled = false;
  double physicalMultiplier = 1, magicMultiplier = 1;
  double softRating = 500, softReduction = .8, hardRating = 1000, hardReduction = .9;
  double hiddenArmorPerPiece = 0, blockCap = .85, magicCap = .85, elementalCap = .85;
  double blockBase = .2, blockPerSkill = .003;
  int tickMilliseconds = 250;
  bool trace = false;
  static CombatSettings FromJson(const nlohmann::json& j) {
    CombatSettings s;
    if (j.is_null()) return s;
    ExactKeys(j, {"mode","enabled","global","armor","block","resistances","effects","trace"});
    s.mode = j.at("mode").get<std::string>();
    s.enabled = j.at("enabled").get<bool>();
    if (s.mode != "legacy" && s.mode != "aetherius") throw std::invalid_argument("invalid combat mode");
    const auto& g = j.at("global"); ExactKeys(g, {"physicalDamageMultiplier","magicDamageMultiplier"});
    s.physicalMultiplier = Number(g,"physicalDamageMultiplier",0,100);
    s.magicMultiplier = Number(g,"magicDamageMultiplier",0,100);
    const auto& a = j.at("armor"); ExactKeys(a, {"softCapRating","softCapReduction","hardCapRating","hardCapReduction","hiddenArmorPerPiece"});
    s.softRating = Number(a,"softCapRating",1,100000);
    s.hardRating = Number(a,"hardCapRating",1,100000);
    s.softReduction = Number(a,"softCapReduction",0,.99);
    s.hardReduction = Number(a,"hardCapReduction",0,.99);
    s.hiddenArmorPerPiece = Number(a,"hiddenArmorPerPiece",0,1000);
    if (s.hardRating <= s.softRating || s.hardReduction < s.softReduction)
      throw std::invalid_argument("armor curve must be monotonic");
    const auto& b = j.at("block"); ExactKeys(b, {"maximumReduction","baseReduction","reductionPerSkill"});
    s.blockCap = Number(b,"maximumReduction",0,.99);
    s.blockBase = Number(b,"baseReduction",0,.99);
    s.blockPerSkill = Number(b,"reductionPerSkill",0,.1);
    const auto& r = j.at("resistances"); ExactKeys(r, {"magicCap","elementalCap"});
    s.magicCap = Number(r,"magicCap",0,.99); s.elementalCap = Number(r,"elementalCap",0,.99);
    const auto& e = j.at("effects"); ExactKeys(e, {"tickMilliseconds"});
    if (!e.at("tickMilliseconds").is_number_integer()) throw std::invalid_argument("tick must be integer");
    s.tickMilliseconds = static_cast<int>(Number(e,"tickMilliseconds",10,10000));
    if (j.contains("trace")) s.trace = j.at("trace").get<bool>();
    return s;
  }
};
}
