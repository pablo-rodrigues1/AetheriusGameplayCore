#pragma once
// DS-5b. Conversion only at publication; evaluation has no JSON, I/O or allocation.
#include "../forms/StableFormKey.h"
#include <nlohmann/json.hpp>
#include <array>
#include <cmath>
#include <cstring>
#include <optional>
#include <string_view>
#include <vector>

namespace aetherius::combat::ds5b {
using Json = nlohmann::json;
enum class EP : unsigned { Attack, Weapon, Power, Sneak, CritChance, CritDamage, Incoming, TargetArmor, Armor, Block, Count };
inline constexpr std::array<const char*,10> EntryNames={"ModAttackDamage","CalculateWeaponDamage","ModPowerAttackDamage","ModSneakAttackMult",
  "CalculateMyCriticalHitChance","CalculateMyCriticalHitDamage","ModIncomingDamage","ModTargetDamageResistance","ModArmorRating","ModPercentBlocked"};
inline EP Entry(std::string_view name) {
  for(unsigned i=0;i<EntryNames.size();++i)if(name==EntryNames[i])return static_cast<EP>(i);
  return EP::Count;
}
enum class Decision : unsigned { Applied, False, Missing, Unsupported, Operation, Disabled, Invalid, Order };
inline constexpr const char* DecisionNames[]={"APPLIED","CONDITION_FALSE","CONDITION_CONTEXT_UNAVAILABLE","PROFILE_RULE_UNSUPPORTED",
  "OPERATION_OR_AV_UNSUPPORTED","SNEAK_DISABLED_Q9","NUMERIC_INVALID","NONCOMMUTATIVE_PRIORITY_UNCERTIFIED"};
struct Condition {
  std::string function, compare, actorValue;
  std::optional<StableFormKey> key;
  double expected=0;
  bool target=false;
};
using Clause=std::vector<Condition>;
using Tab=std::vector<Clause>;
struct Rule {
  EP entry=EP::Count;
  StableFormKey perk;
  std::string modification,actorValue,sourceKey,reason;
  double value=0,priority=0;
  unsigned rank=0,effectIndex=0,index=0;
  bool supported=false,orderUncertified=false;
  std::array<char,256> provenance{};
  std::vector<Tab> tabs;
};
struct Table {
  std::array<std::vector<Rule>,10> rules;
  std::vector<StableFormKey> perks;
  bool perksKnown=false;
  unsigned unsupported=0,unsupportedRules=0;
};
struct Number { std::string_view name; double value; };
struct Context {
  const std::vector<StableFormKey>* keywords=nullptr;
  const std::vector<StableFormKey>* perks=nullptr;
  const StableFormKey* identity=nullptr;
  std::string_view weaponSkill;
  std::array<const std::vector<StableFormKey>*,64> worn{};
  size_t wornCount=0;
  bool wornKnown=false;
  std::array<Number,16> values{}, percents{};
  size_t valueCount=0,percentCount=0;
  std::array<std::optional<double>,2> hands{}; // Left, Right; absent differs from empty (0)
  std::optional<double> Value(std::string_view key,bool percent=false) const {
    const auto& rows=percent?percents:values;const auto count=percent?percentCount:valueCount;
    // Compiler calls the weapon AV Archery; fixed profile calls it Marksman.
    if(key=="Archery")key="Marksman";
    for(size_t i=0;i<count;++i)if(rows[i].name==key&&std::isfinite(rows[i].value))return rows[i].value;
    return {};
  }
};
inline bool Contains(const std::vector<StableFormKey>& rows,const StableFormKey& key) {
  return std::find(rows.begin(),rows.end(),key)!=rows.end();
}
inline std::optional<double> ConditionValue(const Condition& c,const Context& x) {
  if(c.function=="HasKeyword")return x.keywords&&c.key?std::optional<double>(Contains(*x.keywords,*c.key)):std::nullopt;
  if(c.function=="HasPerk")return x.perks&&c.key?std::optional<double>(Contains(*x.perks,*c.key)):std::nullopt;
  if(c.function=="GetIsID")return x.identity&&c.key?std::optional<double>(*x.identity==*c.key):std::nullopt;
  if(c.function=="WornHasKeyword"||c.function=="WornApparelHasKeywordCount") {
    if(!x.wornKnown||!c.key)return {};
    double count=0;for(size_t i=0;i<x.wornCount;++i)if(Contains(*x.worn[i],*c.key))++count;
    return c.function=="WornHasKeyword"?double(count>0):count;
  }
  if(c.function=="GetEquippedItemType") {
    if(c.actorValue=="Left")return x.hands[0];if(c.actorValue=="Right")return x.hands[1];return {};
  }
  if(c.function=="IsWeaponSkillType")return x.weaponSkill.empty()?std::nullopt:std::optional<double>(x.weaponSkill==c.actorValue);
  if(c.function=="GetActorValue")return x.Value(c.actorValue);
  if(c.function=="GetActorValuePercent")return x.Value(c.actorValue,true);
  return {};
}
inline bool Compare(double v,const std::string& op,double expected) {
  if(op=="EqualTo")return v==expected;if(op=="NotEqualTo")return v!=expected;
  if(op=="GreaterThan")return v>expected;if(op=="GreaterThanOrEqualTo")return v>=expected;
  if(op=="LessThan")return v<expected;if(op=="LessThanOrEqualTo")return v<=expected;
  return false;
}
inline Decision Matches(const Rule& rule,const Context* subject,const Context* target) {
  if(!rule.supported)return Decision::Unsupported;
  bool failed=false,missing=false;
  for(const auto& tab:rule.tabs)for(const auto& clause:tab) {
    bool any=false,unknown=false;
    for(const auto& c:clause) {
      const auto* x=c.target?target:subject;
      const auto value=x?ConditionValue(c,*x):std::nullopt;
      if(!value||!std::isfinite(*value)){unknown=true;continue;}
      if(Compare(*value,c.compare,c.expected))any=true;
    }
    if(!any){failed=true;missing|=unknown;}
  }
  return failed?(missing?Decision::Missing:Decision::False):Decision::Applied;
}
struct Step {
  unsigned rule=0;
  EP entry=EP::Count;
  Decision decision=Decision::False;
  bool defender=false;
  double before=0,after=0;
  double priority=0;
  std::array<char,256> provenance{};
};
struct Audit {
  std::array<Step,48> steps{};
  unsigned count=0,overflow=0,applied=0,missing=0,unsupported=0;
  bool invalid=false;
  void Add(const Rule& rule,Decision decision,double before,double after,bool defender) {
    if(count<steps.size())steps[count++]={rule.index,rule.entry,decision,defender,before,after,rule.priority,rule.provenance};else ++overflow;
    applied+=decision==Decision::Applied;missing+=decision==Decision::Missing;
    unsupported+=decision==Decision::Unsupported||decision==Decision::Operation||decision==Decision::Order;
    invalid|=decision==Decision::Invalid;
  }
};
// Operations modify the current entry-point value. Uncertified noncommuting groups are withheld at publication.
inline std::optional<double> Operate(const Rule& r,double current,const Context& subject) {
  if(r.modification=="Set")return r.value;
  if(r.modification=="Add")return current+r.value;
  if(r.modification=="Multiply")return current*r.value;
  const auto av=subject.Value(r.actorValue);if(!av)return {};
  if(r.modification=="MultiplyOnePlusAVMult")return current*(1+r.value**av);
  if(r.modification=="MultiplyAVMult")return current*r.value**av;
  if(r.modification=="AddAVMult"||r.modification=="AddActorValueMult")return current+r.value**av;
  return {};
}
inline double Apply(const Table& table,EP ep,double value,const Context& subject,const Context& target,Audit& audit,bool defender=false) {
  for(const auto& rule:table.rules[static_cast<unsigned>(ep)]) {
    auto decision=ep==EP::Sneak?Decision::Disabled:rule.orderUncertified?Decision::Order:Matches(rule,&subject,&target);
    const double before=value;
    if(decision==Decision::Applied) {
      const auto next=Operate(rule,value,subject);
      if(!next)decision=Decision::Operation;
      else if(!std::isfinite(*next)||std::abs(*next)>1e7)decision=Decision::Invalid;
      else value=*next;
    }
    audit.Add(rule,decision,before,value,defender);
  }
  return value;
}
inline StableFormKey Form(const std::string& value) {
  const auto split=value.find(':');
  if(split!=6)throw std::invalid_argument("compiled form key");
  return StableFormKey::Parse(value.substr(7)+":"+value.substr(0,6));
}
// DS-5c: compiled origins the host applies. CLASS (player class stage) and NPC_RECORD (perks of the
// winning NPC_, BaseData provider). RACE/STANDING_STONE stay counted as unsupported.
inline bool AppliedOrigin(const Json& kind) { return kind=="CLASS"||kind=="NPC_RECORD"; }
inline Rule Convert(const Json& j,const StableFormKey& perk,unsigned index) {
  Rule r;r.perk=perk;r.index=index;r.entry=Entry(j.at("entryPoint").get<std::string>());
  r.supported=j.at("status")=="SUPPORTED";r.reason=j.value("reason",std::string{});
  if(!r.supported)return r; // Never parse partial conditions into a usable rule.
  r.modification=j.at("modification");r.value=j.at("value");r.priority=j.at("priority");
  r.actorValue=j.value("actorValue",std::string{});r.rank=j.at("rank");r.effectIndex=j.at("effectIndex");
  r.sourceKey=j.at("origin").at("sourceKey");
  const auto provenance=perk.ToString()+"#"+std::to_string(r.effectIndex)+" "+j.at("origin").at("sourceKind").get<std::string>()+":"+r.sourceKey+" "+r.modification;
  if(provenance.size()>=r.provenance.size())throw std::invalid_argument("rule provenance capacity");
  std::memcpy(r.provenance.data(),provenance.c_str(),provenance.size()+1);
  if(!std::isfinite(r.value)||!std::isfinite(r.priority)||!(Form(j.at("perk"))==perk))throw std::invalid_argument("compiled rule identity/value");
  unsigned conditionCount=0;
  if(j.at("conditions").size()>16)throw std::invalid_argument("tab capacity");
  for(const auto& tab:j.at("conditions")) {
    Tab t;
    for(const auto& clause:tab.at("clauses")) {
      if(clause.empty())throw std::invalid_argument("empty clause");
      Clause cs;
      for(const auto& row:clause) {
        if(++conditionCount>256)throw std::invalid_argument("condition capacity");
        Condition c;c.function=row.at("function");c.compare=row.at("compare");c.expected=row.at("comparisonValue");
        const auto run=row.at("runOn").get<std::string>();
        if(run!="Subject"&&run!="Target")r.supported=false;
        c.target=run=="Target";c.actorValue=row.value("actorValue",std::string{});
        if(row.contains("parameter"))c.key=Form(row.at("parameter"));
        constexpr const char* functions[]={"HasKeyword","WornHasKeyword","WornApparelHasKeywordCount","HasPerk","GetIsID",
          "GetEquippedItemType","IsWeaponSkillType","GetActorValuePercent","GetActorValue"};
        if(std::find(std::begin(functions),std::end(functions),c.function)==std::end(functions)||!std::isfinite(c.expected))r.supported=false;
        cs.push_back(std::move(c));
      }
      t.push_back(std::move(cs));
    }
    r.tabs.push_back(std::move(t));
  }
  return r;
}
inline Table ConvertPerks(const Json& profile) {
  Table table;
  if(!profile.contains("perks")){table.unsupported=1;return table;}
  const auto& set=profile.at("perks");table.perksKnown=set.at("status")!="UNSUPPORTED";
  const auto& rows=set.at("value");if(!rows.is_array()||rows.size()>512)throw std::invalid_argument("perk capacity");
  unsigned index=0;
  for(const auto& item:rows) {
    const auto keyText=item.at("stableFormKey").get<std::string>();const auto split=keyText.rfind('|');
    if(split==std::string::npos)throw std::invalid_argument("profile perk key");
    const auto key=StableFormKey::Parse(keyText.substr(0,split)+":"+keyText.substr(split+1));
    // Grant presence is known even when its semantics are unsupported.
    if(!Contains(table.perks,key))table.perks.push_back(key);
    if(item.at("status")!="SUPPORTED"||!AppliedOrigin(item.at("sourceKind"))||item.at("compiled").is_null()) {
      ++table.unsupported;
      const auto& skipped=item.at("compiled");
      if(skipped.is_object()&&skipped.contains("rules")&&skipped.at("rules").is_array()) {
        table.unsupportedRules+=static_cast<unsigned>(skipped.at("rules").size());
        if(table.unsupportedRules>2048)throw std::invalid_argument("unsupported rule capacity");
      }
      continue;
    }
    const auto& compiled=item.at("compiled");
    if(!(Form(compiled.at("perk"))==key)||compiled.at("origin").at("sourceKind")!=item.at("sourceKind")
      ||compiled.at("origin").at("sourceKey")!=item.at("sourceKey"))throw std::invalid_argument("compiled origin");
    for(const auto& row:compiled.at("rules")) {
      if(++index>2048)throw std::invalid_argument("rule capacity");
      if(row.at("origin")!=compiled.at("origin"))throw std::invalid_argument("rule origin mismatch");
      Rule rule=Convert(row,key,index);
      if(rule.rank>=item.at("rank").get<unsigned>())rule.supported=false;
      if(!rule.supported)++table.unsupportedRules;
      // A record effect is active once even when two grants confer the same perk.
      if(rule.entry==EP::Count){++table.unsupported;continue;}
      auto& dest=table.rules[static_cast<unsigned>(rule.entry)];
      if(std::any_of(dest.begin(),dest.end(),[&](const Rule& x){return x.perk==key&&x.effectIndex==rule.effectIndex;}))continue;
      dest.push_back(std::move(rule));
    }
  }
  for(auto& rules:table.rules) {
    std::stable_sort(rules.begin(),rules.end(),[](const Rule& a,const Rule& b){return a.priority<b.priority;});
    const auto active=std::count_if(rules.begin(),rules.end(),[](const Rule& r){return r.supported;});
    const auto noncommutative=std::any_of(rules.begin(),rules.end(),[](const Rule& r){return r.supported
      &&r.modification!="Multiply"&&r.modification!="MultiplyOnePlusAVMult"&&r.modification!="MultiplyAVMult";});
    // Engine ordering for noncommuting operations has no certified proof yet.
    // Do not choose an approximate order: withhold the entire affected group.
    if(active>1&&noncommutative)for(auto& r:rules)if(r.supported)r.orderUncertified=true;
  }
  return table;
}
// Server-owned seed/state. One draw per eligible hit; reproducible from trace state.
struct Rng {
  uint64_t state;
  explicit Rng(uint64_t seed):state(seed?seed:1){}
  double Next() {state^=state<<13;state^=state>>7;state^=state<<17;return double(state>>11)*0x1.0p-53;}
};
}
