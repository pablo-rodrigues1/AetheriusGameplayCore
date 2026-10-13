#pragma once
#include "../context/DamageContext.h"
#include <functional>
namespace aetherius::combat {
struct PerkCondition { std::string function; StableFormKey key; bool expected = true; bool orNext = false; };
struct PerkHandler {
  StableFormKey key;
  std::string editorId, winner, entryPoint, skill;
  double coefficient = 0;
  std::vector<std::vector<PerkCondition>> conditions;
  bool Matches(const CombatProfile& profile, const std::vector<StableFormKey>& keywords) const {
    for (const auto& group : conditions) {
      bool disjunction = false;
      for (const auto& c : group) {
        bool actual = false;
        if (c.function == "HasPerk") actual = profile.Has(c.key);
        else if (c.function == "HasKeyword") actual = std::find(keywords.begin(),keywords.end(),c.key) != keywords.end();
        else return false;
        disjunction = disjunction || (actual == c.expected);
        if (!c.orNext) { if (!disjunction) return false; disjunction = false; }
      }
      // Bethesda permits a terminal OR flag; it still terminates this group.
      if (!group.empty() && group.back().orNext && !disjunction) return false;
    }
    return true;
  }
};
class PerkRegistry {
public:
  void Load(const nlohmann::json& catalog) {
    if (catalog.at("schemaVersion") != 1) throw std::invalid_argument("invalid perk catalog");
    std::map<StableFormKey,std::vector<PerkHandler>> next;
    for (const auto& row : catalog.at("perks")) {
      auto key = StableFormKey::Parse(row.at("key").get<std::string>());
      if (next.count(key)) throw std::invalid_argument("duplicate catalog key");
      for (const auto& effect : row.at("effects")) {
        PerkHandler h; h.key = key; h.editorId = row.at("editorId"); h.winner = row.at("winner");
        h.entryPoint = effect.at("entryPoint"); h.skill = effect.at("skill");
        if (!Skills().count(h.skill)) throw std::invalid_argument("unknown handler skill");
        if (h.entryPoint != "CalculateWeaponDamage" && h.entryPoint != "ModAttackDamage" &&
            h.entryPoint != "CalculateMyCriticalHitDamage" && h.entryPoint != "ModArmorRating" && h.entryPoint != "ModPercentBlocked")
          throw std::invalid_argument("unsupported entry point");
        h.coefficient = Number(effect,"coefficient",0,1);
        for (const auto& group : effect.at("conditions")) {
          std::vector<PerkCondition> conditions;
          for (const auto& c : group) {
            auto f = c.at("function").get<std::string>();
            if (f != "HasKeyword" && f != "HasPerk") throw std::invalid_argument("unsupported condition");
            conditions.push_back({f,StableFormKey::Parse(c.at("key")),c.at("expected").get<bool>(),c.at("orNext").get<bool>()});
          }
          h.conditions.push_back(std::move(conditions));
        }
        next[key].push_back(std::move(h));
      }
    }
    handlers = std::move(next);
  }
  bool Supports(const StableFormKey& key) const { return handlers.count(key) != 0; }
  void Validate(const CombatProfile& p) const {
    for (const auto& grant : p.perks)
      if (!Supports(grant.key) || grant.rank != 1) throw std::invalid_argument("unsupported perk/rank " + grant.key.ToString());
  }
  double Multiplier(const std::string& point, const CombatProfile& p,
                    const std::vector<StableFormKey>& keywords, CombatTrace& trace) const {
    double multiplier = 1;
    for (const auto& grant : p.perks) {
      const auto found = handlers.find(grant.key);
      if (found == handlers.end()) continue;
      for (const auto& h : found->second) if (h.entryPoint == point && h.Matches(p,keywords)) {
        const auto m = 1 + h.coefficient * p.Skill(h.skill);
        multiplier *= m; trace.Add("perk."+point,m,h.key.ToString());
      }
    }
    return multiplier;
  }
private:
  std::map<StableFormKey,std::vector<PerkHandler>> handlers;
};
}
