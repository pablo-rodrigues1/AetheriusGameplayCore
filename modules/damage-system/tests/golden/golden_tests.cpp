#include "aetherius_combat/ds5a/Bridge.h"
#include <fstream>
#include <iostream>
#include <sstream>
#include <iomanip>
using namespace aetherius::combat;
namespace ds=ds5a;
namespace rules=ds5b;
using Json=nlohmann::json;
Json Read(const std::string& file) {std::ifstream in(file);if(!in)throw std::runtime_error("missing "+file);Json j;in>>j;return j;}
bool Near(double a,double b){return std::abs(a-b)<1e-6;}
std::string ExportKey(const StableFormKey& key) {const auto s=key.ToString();const auto i=s.rfind(':');return s.substr(i+1)+":"+s.substr(0,i);}
const Json& Compiled(const Json& data,const StableFormKey& key) {
  for(const auto& item:data.at("perks").items())if(rules::Form(item.key())==key)return item.value();
  throw std::runtime_error("compiled golden record absent "+key.ToString());
}
std::vector<StableFormKey> Keys(const Json& rows) {std::vector<StableFormKey> out;for(const auto& s:rows)out.push_back(StableFormKey::Parse(s));return out;}
rules::Table Table(const Json& list,const Json& compiled) {
  rules::Table table;table.perksKnown=true;table.perks=Keys(list);unsigned index=0;
  for(const auto& key:table.perks)for(const auto& row:Compiled(compiled,key).at("rules")) {
    auto r=rules::Convert(row,key,++index);if(r.entry!=rules::EP::Count)table.rules[unsigned(r.entry)].push_back(r);
  }
  for(auto& rows:table.rules)std::stable_sort(rows.begin(),rows.end(),[](const auto& a,const auto& b){return a.priority<b.priority;});
  return table;
}
rules::Context Context(const Json& skills,const rules::Table& table,const std::vector<StableFormKey>* keywords=nullptr) {
  rules::Context c;c.perks=&table.perks;c.keywords=keywords;
  // string_views point at stable JSON keys for the lifetime of this test.
  for(const auto& item:skills.items())c.values[c.valueCount++]={item.key(),item.value().get<double>()};
  return c;
}
struct FixedRandom {uint64_t state=1;double roll=.5;double Next(){return roll;}};
struct Result {std::string status="FAIL",detail;};
bool TryParseFormKey(const std::string& text,StableFormKey& out,std::string& error) {
  try {out=StableFormKey::Parse(text);return true;}catch(const std::exception& e){error=e.what();return false;}
}
bool LooksLikeRuntimeHex8(const std::string& text) {
  if (text.size() == 10 && text[0] == '0' && (text[1] == 'x' || text[1] == 'X')) {
    for (std::size_t i = 2; i < 10; ++i) {
      const unsigned char ch = static_cast<unsigned char>(text[i]);
      if (!std::isxdigit(ch)) return false;
    }
    return true;
  }
  if (text.size() == 8) {
    bool allHex = true;
    for (char c : text) {
      if (!std::isxdigit(static_cast<unsigned char>(c))) {
        allHex = false;
        break;
      }
    }
    if (allHex) return true;
  }
  return false;
}

void AuditJsonFormKeysRecursive(
    const nlohmann::json& node,
    const std::string& jsonPath,
    std::vector<std::string>& invalidFormKeys) {
  if (node.is_object()) {
    for (const auto& it : node.items()) {
      const std::string childPath = jsonPath + "." + it.key();
      if (it.value().is_string()) {
        const std::string val = it.value().get<std::string>();
        if (LooksLikeRuntimeHex8(val)) {
          invalidFormKeys.push_back(childPath + " looks like 8-hex runtime FormID: " + val);
        }
        const bool isKeyField =
            it.key() == "formKey" || it.key() == "perkFormKey" ||
            it.key() == "blockerPerkFormKey" || it.key() == "requiredFormKey" ||
            it.key() == "forbiddenFormKey" || it.key() == "wrongFormKey" ||
            it.key() == "conditionKey" || it.key() == "perkKeyUpper" ||
            it.key() == "perkKeyLower" || it.key() == "keywordUpper" ||
            it.key() == "keywordLower";
        if (isKeyField && !val.empty()) {
          StableFormKey parsed;
          std::string err;
          if (!TryParseFormKey(val, parsed, err)) {
            invalidFormKeys.push_back(childPath + " invalid StableFormKey '" + val + "': " + err);
          }
        }
      } else if (
          it.value().is_array() &&
          (it.key() == "perks" || it.key() == "actorPerks" ||
           it.key() == "keywords" || it.key() == "positiveKeywords" ||
           it.key() == "negativeKeywords" || it.key() == "missingKeywords")) {
        for (std::size_t idx = 0; idx < it.value().size(); ++idx) {
          const std::string val = it.value()[idx].get<std::string>();
          StableFormKey parsed;
          std::string err;
          if (!TryParseFormKey(val, parsed, err)) {
            invalidFormKeys.push_back(
                childPath + "[" + std::to_string(idx) + "] invalid StableFormKey '" + val + "': " + err);
          }
        }
      } else {
        AuditJsonFormKeysRecursive(it.value(), childPath, invalidFormKeys);
      }
    }
  } else if (node.is_array()) {
    for (std::size_t idx = 0; idx < node.size(); ++idx) {
      AuditJsonFormKeysRecursive(
          node[idx], jsonPath + "[" + std::to_string(idx) + "]", invalidFormKeys);
    }
  }
}


Result Test(const Json& tc,const Json& compiled,const Json& fixture) {
  const auto& in=tc.at("input");const auto& ex=tc.at("expected");const auto kind=tc.at("kind").get<std::string>();
  Result result;auto check=[&](bool ok,const std::string& detail){result.status=ok?"PASS":"FAIL";result.detail=detail;return result;};
  if(kind=="perk_entry_point") {
    if(in.value("statusReason","")=="NO_CLASS_PERK_IN_LOAD_ORDER")return {"PENDING","NO_CLASS_PERK_IN_LOAD_ORDER"};
    const auto key=StableFormKey::Parse(in.at("perkFormKey"));
    const auto& effect=tc.at("recordEffect");
    for(const auto& raw:Compiled(compiled,key).at("rules")) {
      if(raw.at("entryPoint")!=in.at("entryPoint")||raw.at("modification")!=in.at("operation")||raw.at("priority")!=effect.at("Priority"))continue;
      auto r=rules::Convert(raw,key,1);
      if(!r.supported)return {"PENDING",raw.value("reason", "UNSUPPORTED compiled effect")};
      if(r.entry==rules::EP::Sneak)return {"PENDING","DISABLED_Q9 (kernel separately proves no sneak bonus)"};
      auto table=Table(in.at("actorPerks"),compiled);const auto keywords=Keys(in.at("keywords"));auto c=Context(in.at("actorSkills"),table,&keywords);
      const auto match=rules::Matches(r,&c,&c);
      if(match==rules::Decision::Missing)return {"PENDING","FIXTURE_CONTEXT_UNAVAILABLE (compound rule); operation separately covered by native tests"};
      const auto v=match==rules::Decision::Applied?rules::Operate(r,r.entry==rules::EP::CritChance?0.:1.,c):std::optional<double>(1.);
      return check(v&&Near(*v,ex.at("multiplier")),"compiled full conditions + operation; actual="+(v?std::to_string(*v):"UNSUPPORTED_AV"));
    }
    return {"FAIL","exported effect not found by identity/entry/operation/priority"};
  }
  if(kind=="condition_eval") {
    const auto fn=in.at("conditionFunction").get<std::string>();
    if(fn=="UncertifiedRejection") {
      bool ok=true;
      for(const auto& item:in.at("uncertifiedCases")) {
        const auto key=StableFormKey::Parse(item.at("perkFormKey"));bool found=false;
        for(const auto& raw:Compiled(compiled,key).at("rules"))if(raw.at("entryPoint")==item.at("entryPoint")&&raw.at("priority")==item.at("priority")) {
          auto r=rules::Convert(raw,key,1);rules::Context c;found=true;ok&=!r.supported&&rules::Matches(r,&c,&c)==rules::Decision::Unsupported;
        }
        ok&=found;
      }
      return check(ok,"uncertified compiled rules rejected, never matched");
    }
    const auto key=StableFormKey::Parse(in.at("perkFormKey"));Json probe;
    // G3 is explicitly an isolated condition probe, including Alkahest (DS-1-fix4).
    for(const auto& raw:Compiled(compiled,key).at("rules")) {
      if(raw.at("entryPoint")!=in.at("entryPoint"))continue;
      Json tabs=Json::array();bool seen=false;
      for(const auto& tab:raw.at("conditions")) {
        Json clauses=Json::array();
        for(const auto& clause:tab.at("clauses")) {
          Json members=Json::array();for(const auto& c:clause)if(c.at("function")==fn)members.push_back(c);
          if(!members.empty()){clauses.push_back(members);seen=true;}
        }
        if(!clauses.empty())tabs.push_back({{"clauses",clauses}});
      }
      if(seen){probe=raw;probe["conditions"]=tabs;probe["status"]="SUPPORTED";probe.erase("reason");break;}
    }
    if(probe.is_null())return {"FAIL","certified condition absent in DS-3 compiled export"};
    auto rule=rules::Convert(probe,key,1);
    // Use one actual condition for GetIsID / IsWeaponSkillType / percent / count.
    // Other tabs describe the compound rule and are not certified by this probe.
    if(fn!="HasKeyword"&&fn!="HasPerk"&&fn!="WornHasKeyword")rule.tabs={rules::Tab{rules::Clause{rule.tabs.front().front().front()}}};
    rules::Table table;table.perks={key};table.perksKnown=true;
    Json skills=Json::object();if(in.contains("skill"))skills[in.at("skill").get<std::string>()]=in.at("skillValue");
    auto positive=Context(skills,table),negative=positive,missing=positive;
    std::vector<StableFormKey> posKeywords,negKeywords,empty;
    std::vector<StableFormKey> negPerks=table.perks;StableFormKey identity,wrongIdentity;
    if(fn=="HasKeyword") {
      posKeywords=Keys(in.at("positiveKeywords"));negKeywords=Keys(in.at("negativeKeywords"));
      positive.keywords=&posKeywords;negative.keywords=&negKeywords;missing.keywords=&empty;
    }else if(fn=="HasPerk") {
      negPerks.push_back(StableFormKey::Parse(in.at("blockerPerkFormKey")));negative.perks=&negPerks;
      missing.perks=nullptr;
    }else if(fn=="WornHasKeyword") {
      for(const auto& tab:rule.tabs)for(const auto& clause:tab)for(const auto& c:clause)if(c.key&&c.expected==1)posKeywords.push_back(*c.key);
      negKeywords=posKeywords;negKeywords.push_back(StableFormKey::Parse(in.at("forbiddenFormKey")));
      positive.wornKnown=negative.wornKnown=true;positive.worn[0]=&posKeywords;negative.worn[0]=&negKeywords;
      positive.wornCount=negative.wornCount=1;
    }else if(fn=="WornApparelHasKeywordCount") {
      posKeywords={StableFormKey::Parse(in.at("requiredFormKey"))};
      positive.wornKnown=negative.wornKnown=true;positive.wornCount=3;negative.wornCount=2;
      for(size_t i=0;i<3;++i){positive.worn[i]=&posKeywords;negative.worn[i]=&posKeywords;}
    }else if(fn=="GetIsID") {
      identity=StableFormKey::Parse(in.at("requiredFormKey"));wrongIdentity=StableFormKey::Parse(in.at("wrongFormKey"));
      positive.identity=&identity;negative.identity=&wrongIdentity;
    }else if(fn=="GetEquippedItemType") {positive.hands={1.,1.};negative.hands={0.,0.};}
    else if(fn=="IsWeaponSkillType") {positive.weaponSkill="OneHanded";negative.weaponSkill="TwoHanded";}
    else if(fn=="GetActorValuePercent") {positive.percents[0]={"Health",.4};negative.percents[0]={"Health",.8};positive.percentCount=negative.percentCount=1;}
    else if(fn=="GetActorValue") {positive.values[0]={"DamageResist",1};negative.values[0]={"DamageResist",0};positive.valueCount=negative.valueCount=1;}
    const auto evaluate=[&](const rules::Context& c){if(rules::Matches(rule,&c,&c)!=rules::Decision::Applied)return 1.;const auto value=rules::Operate(rule,1,c);return value.value_or(1);};
    const auto a=evaluate(positive),b=evaluate(negative),c=evaluate(missing);
    return check(Near(a,ex.at("positiveMultiplier"))&&Near(b,ex.at("negativeMultiplier"))&&Near(c,ex.at("missingMultiplier")),
      "isolated "+fn+" positive="+std::to_string(a)+" negative="+std::to_string(b)+" missing="+std::to_string(c));
  }
  if(kind=="physical_damage") {
    const auto& weapon=in.at("weapon");const auto& attack=in.at("attack");const auto& attacker=in.at("attacker");const auto& defender=in.at("defender");
    auto ap=Table(attacker.at("perks"),compiled),dp=Table(defender.at("perks"),compiled);
    const auto keywords=Keys(weapon.at("keywords"));auto ac=Context(attacker.at("skills"),ap,&keywords),dc=Context(defender.at("skills"),dp);
    ds::Trace trace;trace.weaponBase=(weapon.at("baseDamage").get<double>()+attack.value("flatItemDamage",0.))*attack.value("itemMultiplier",1.);
    trace.weaponSkill=attacker.at("skills").at(weapon.at("skill").get<std::string>());trace.armor=defender.at("armorRating");
    if(defender.at("blocking"))trace.blockReduction=std::clamp(rules::Apply(dp,rules::EP::Block,.2+.003*defender.at("skills").at("Block").get<double>(),dc,ac,trace.rules,true),0.,.85);
    ds::Finish(trace,{1.5,1,1.4},0,false);
    // Historical example injects an authorized provider chance of 100%, not a class perk.
    // The production profile currently has no certified critical chance provider.
    if(attack.value("criticalChance",0.)>0)return {"PENDING","NO_CERTIFIED_CLASS_CRITICAL_CHANCE_PROVIDER; RNG/kernel covered by native tests"};
    const auto initial=trace;FixedRandom rng;ds::FinishPerks(trace,ap,dp,ac,dc,{true,weapon.at("critDamage")},{true,1},rng);
    for(int hit=1;hit<attack.value("repeatHits",1);++hit) {
      auto repeat=initial;ds::FinishPerks(repeat,ap,dp,ac,dc,{true,weapon.at("critDamage")},{true,1},rng);
      if(!Near(repeat.candidate,trace.candidate))return {"FAIL","refinement changed between hits"};
    }
    return check(Near(trace.candidate,ex.at("finalDamage"))&&Near(trace.preDefense,ex.at("preDefenseDamage")),"native kernel final="+std::to_string(trace.candidate));
  }
  if(kind=="armor_piece") {
    auto table=Table(in.at("actorPerks"),compiled);const auto keywords=Keys(in.at("keywords"));auto c=Context(in.at("actorSkills"),table,&keywords);rules::Audit audit;
    const double base=(in.at("baseArmor").get<double>()+in.at("flatArmor").get<double>())*in.at("itemMultiplier").get<double>();
    const auto skill=in.at("actorSkills").at(in.at("skill").get<std::string>()).get<double>();
    const auto rating=rules::Apply(table,rules::EP::Armor,ds::ArmorPiece(base,skill,{1.5,1,1.4}),c,c,audit,true);
    return check(Near(rating,ex.at("armorRating")),"native armor rating="+std::to_string(rating));
  }
  if(kind=="armor_curve_table") {
    bool ok=true;for(const auto& p:in.at("points"))ok&=Near(ds::ArmorCurve(p.at("armor")),p.at("expectedReduction"));return check(ok,"absolute native curve");
  }
  if(kind=="block_reduction") {
    bool ok=true;
    for(const auto& sample:in.at("samples")) {
      auto table=Table(sample.at("perks"),compiled);Json skills={{"Block",sample.at("blockSkill")}};auto c=Context(skills,table);rules::Audit audit;
      const double base=sample.at("baseOverride").is_null()?.2:sample.at("baseOverride").get<double>();
      const auto reduction=std::clamp(rules::Apply(table,rules::EP::Block,base+.003*sample.at("blockSkill").get<double>(),c,c,audit,true),0.,.85);
      ok&=Near(reduction,sample.at("expectedReduction"));
    }
    return check(ok,"native block operation and cap, all samples");
  }
  if(kind=="invariant_check") {
    if(in.contains("auditAllCasesInFixture")) {
      bool ok=true;for(const auto& c:fixture.at("cases"))ok&=!c.at("origin").get<std::string>().empty();
      std::vector<std::string> errors;AuditJsonFormKeysRecursive(fixture,"$",errors);ok&=errors.empty();
      // Every identity in the compiled corpus is parsed through StableFormKey (6 local digits).
      for(const auto& item:compiled.at("perks").items())(void)rules::Form(item.key());
      return check(ok,"origins present; compiled identities local and parsed");
    }
    const auto a=StableFormKey::Parse(in.at("perkKeyUpper")),b=StableFormKey::Parse(in.at("perkKeyLower"));
    const auto ka=StableFormKey::Parse(in.at("keywordUpper")),kb=StableFormKey::Parse(in.at("keywordLower"));
    auto table=Table(Json::array({in.at("perkKeyUpper")}),compiled);Json skills={{"OneHanded",50}};std::vector<StableFormKey> keywords{ka};auto c=Context(skills,table,&keywords);rules::Audit audit;
    const auto value=rules::Apply(table,rules::EP::Weapon,25,c,c,audit);
    return check(a==b&&ka==kb&&Near(value,ex.at("expectedDamage")),"stable identity/case; native host test also moves plugin positions");
  }
  throw std::runtime_error("unknown kind "+kind);
}
int main(int argc,char** argv) {
  try {
    const auto fixture=Read(GOLDEN_FIXTURE_PATH);
    const auto compiled=Read(std::string(COMBAT_CONFIG_DIR)+"/../../../docs/DS5B_GOLDEN_RULES.json");
    unsigned pass=0,fail=0,pending=0,mismatch=0;bool strict=false,verify=false;
    for(int i=1;i<argc;++i){strict|=std::string(argv[i])=="--fail-on-pending";verify|=std::string(argv[i])=="--verify-expected-status";}
    for(const auto& c:fixture.at("cases")) {
      const auto r=Test(c,compiled,fixture);pass+=r.status=="PASS";fail+=r.status=="FAIL";pending+=r.status=="PENDING";mismatch+=r.status!=c.at("expectedStatus");
      std::cout<<'['<<r.status<<"] "<<c.at("id").get<std::string>()<<" ("<<c.at("group").get<std::string>()<<")\n  "<<r.detail<<"\n";
    }
    std::cout<<"Summary: total="<<fixture.at("cases").size()<<" PASS="<<pass<<" FAIL="<<fail<<" PENDING="<<pending<<" unexpectedStatusMismatch="<<mismatch<<'\n';
    return verify?(mismatch?1:0):(fail||(strict&&pending)?1:0);
  }catch(const std::exception& e){std::cerr<<"FATAL "<<e.what()<<'\n';return 2;}
}
