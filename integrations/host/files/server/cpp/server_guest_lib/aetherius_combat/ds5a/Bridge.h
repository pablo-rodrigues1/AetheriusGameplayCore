#pragma once
#include "Physical.h"
#include "../forms/StableFormKey.h"
#include <map>
#include <memory>
#include <set>
#include <string>
#include <functional>
#include <nlohmann/json.hpp>

namespace aetherius::combat::ds5a {
using Json = nlohmann::json;
inline StableFormKey Key(const std::string& text) {
  const auto split=text.rfind('|');
  if (split==std::string::npos) throw std::invalid_argument("expected plugin|XXXXXX");
  return StableFormKey::Parse(text.substr(0,split)+":"+text.substr(split+1));
}
inline Skill ParseSkill(const std::string& value) {
  for(unsigned i=0;i<SkillNames.size();++i) if(value==SkillNames[i])return static_cast<Skill>(i);
  return Skill::None;
}
inline double Numeric(const Json& value,double max=1e7) {
  if(!value.is_number())throw std::invalid_argument("numeric field absent");
  const double n=value.get<double>();
  if(!InRange(n,max))throw std::invalid_argument("numeric field invalid");
  return n;
}
inline uint32_t RuntimeId(const Json& value) {
  const double n=Numeric(value,4294967295.0);
  if(n<1||std::floor(n)!=n)throw std::invalid_argument("runtime id invalid");
  return static_cast<uint32_t>(n);
}
struct Record {
  enum class Kind { Weapon, Armor, Ammo, Race } kind;
  StableFormKey key;
  bool supported=false, ranged=false, clothing=false;
  double base=0, damageResist=0;
  Skill skill=Skill::None;
  Value criticalBase,itemType;
  std::vector<StableFormKey> keywords;
};
struct Catalog {
  Scaling scaling;
  Value powerBonus;
  std::map<uint32_t,Record> records;
  std::map<StableFormKey,uint32_t> ids;
};
// Cache is a conversion of the Core projection, not another mutable ActorCombatState.
// Ownership is weak. Maintenance is outside hits (publication/diagnostic reads).
class Bridge {
public:
  using Resolver=std::function<uint32_t(const StableFormKey&)>;
  using Hydrator=std::function<void(Catalog&)>;
  explicit Bridge(Resolver resolver,Hydrator hydrate={}):resolve(std::move(resolver)),hydrate(std::move(hydrate)) {}
  bool SetCatalog(const std::string& text) {
    if(catalog && text==catalogText)return true;
    if(catalog)return false; // accepted table is immutable for this host boot
    try {
      const auto j=Json::parse(text);
      if(j.at("version")!=1)throw std::invalid_argument("catalog version");
      auto next=std::make_shared<Catalog>();
      const auto& gmst=j.at("gmsts");
      auto setting=[&](const char* name){const auto& row=gmst.at(name);
        if(resolve(Key(row.at("stableFormKey")))!=RuntimeId(row.at("runtimeId")))throw std::invalid_argument("gmst identity");
        return Numeric(row.at("value"),100);};
      next->scaling={setting("fDamagePCSkillMax"),setting("fArmorRatingBase"),setting("fArmorRatingPCMax")};
      if(next->scaling.weaponMax<1||next->scaling.armorMax<next->scaling.armorBase)throw std::invalid_argument("gmst order");
      const auto& rows=j.at("records");
      if(!rows.is_array()||rows.empty()||rows.size()>100000)throw std::invalid_argument("catalog capacity");
      for(const auto& row:rows) {
        const auto key=Key(row.at("stableFormKey"));const auto id=RuntimeId(row.at("runtimeId"));
        if(resolve(key)!=id||next->ids.count(key)||next->records.count(id))throw std::invalid_argument("catalog identity");
        const auto type=row.at("type").get<std::string>();
        Record rec{};rec.key=key;
        if(type=="WEAP")rec.kind=Record::Kind::Weapon;
        else if(type=="ARMO")rec.kind=Record::Kind::Armor;
        else if(type=="AMMO")rec.kind=Record::Kind::Ammo;
        else if(type=="RACE")rec.kind=Record::Kind::Race;
        else throw std::invalid_argument("catalog record type");
        rec.supported=row.at("status")=="SUPPORTED";
        if(rec.supported) {
          rec.base=Numeric(row.at("base"));
          rec.skill=ParseSkill(row.at("skill"));
          rec.ranged=row.at("ranged").get<bool>();rec.clothing=row.at("clothing").get<bool>();
          rec.damageResist=Numeric(row.at("damageResist"));
          const auto& keywords=row.at("keywords");
          if(!keywords.is_array()||keywords.size()>512)throw std::invalid_argument("keywords");
          for(const auto& keyword:keywords)rec.keywords.push_back(Key(keyword));
          if(rec.kind==Record::Kind::Weapon && rec.skill!=Skill::OneHanded && rec.skill!=Skill::TwoHanded && rec.skill!=Skill::Marksman)
            throw std::invalid_argument("weapon skill");
          if(rec.kind==Record::Kind::Armor && !rec.clothing && rec.skill!=Skill::HeavyArmor && rec.skill!=Skill::LightArmor)
            throw std::invalid_argument("armor skill");
        }
        next->ids.emplace(key,id);next->records.emplace(id,std::move(rec));
      }
      if(hydrate)hydrate(*next);
      catalog=next;catalogText=text;catalogReason=Reason::None;return true;
    }catch(...){catalogReason=Reason::CatalogInvalid;return false;}
  }
  struct Entry {
    std::weak_ptr<void> actor;
    uint64_t revision=0;
    std::string raw;
    Profile profile;
  };
  void Sweep() { for(auto i=profiles.begin();i!=profiles.end();)if(i->second.actor.expired())i=profiles.erase(i);else ++i; }
  void RequestNpc(uint32_t id) {
    for(size_t i=0;i<requestCount;++i)if(requests[i]==id)return;
    if(requestCount<requests.size())requests[requestCount++]=id;
  }
  Json TakeRequests() { Json out=Json::array();for(size_t i=0;i<requestCount;++i)out.push_back(requests[i]);requestCount=0;return out; }
  bool Publish(uint32_t id,const std::shared_ptr<void>& actor,uint64_t revision,const std::string& text,uint64_t generation=0,const StableFormKey* identity=nullptr) {
    Sweep();
    if(text=="null"){profiles.erase(id);return true;}
    auto i=profiles.find(id);
    if(i!=profiles.end() && i->second.actor.lock()==actor) {
      if(i->second.revision==revision) {
        if(i->second.raw==text)return i->second.profile.valid;
        i->second.profile.valid=false;return false;
      }
      if(revision<i->second.revision){i->second.profile.valid=false;return false;}
    }
    if(profiles.size()>=4096 && i==profiles.end())return false;
    Entry next{actor,revision,text,{}};next.profile.revision=revision;next.profile.npcGeneration=generation;
    ++profileParses;
    try {
      const auto j=Json::parse(text);
      if(j.at("version")!=1||Numeric(j.at("revision"),9007199254740991.0)!=revision||revision==0)throw std::invalid_argument("profile version/revision");
      auto& p=next.profile;
      const auto kind=j.at("subject").at("kind");
      if(kind!="PLAYER"&&kind!="NPC")throw std::invalid_argument("profile subject");
      p.player=kind=="PLAYER";
      if(identity)p.identity=*identity;
      else if(j.at("subject").contains("stableFormKey")&&j.at("subject").at("stableFormKey").is_string())p.identity=Key(j.at("subject").at("stableFormKey"));
      p.perks=ds5b::ConvertPerks(j);
      if(j.contains("attributes")) {
        unsigned index=0;
        for(const auto* name:{"health","magicka","stamina"}) {
          const auto& attribute=j.at("attributes").at(name);
          if(attribute.at("status")=="SUPPORTED")p.maxima[index]={true,Numeric(attribute.at("value"))};
          ++index;
        }
      }
      const auto& race=j.at("race");
      if(race.at("status")=="SUPPORTED")p.race=resolve(Key(race.at("value")));
      for(unsigned s=0;s<SkillNames.size();++s) {
        const auto& value=j.at("skills").at(SkillNames[s]);
        if(value.at("status")=="SUPPORTED")p.skills[s]={true,Numeric(value.at("value"),1000)};
        else if(value.at("status")!="UNSUPPORTED")throw std::invalid_argument("skill status");
      }
      constexpr const char* effectNames[]={"fortifyOneHandedDamage","fortifyTwoHandedDamage","fortifyArcheryDamage","fortifyUnarmedDamage",
        "fortifyPowerAttacks","fortifyBashDamage","fortifyArmorRating","fortifyBlock","resistArrowDamage","resistPowerAttackDamage","fortifySneakAttacks"};
      for(unsigned e=0;e<11;++e) {
        const auto& value=j.at("effects").at(effectNames[e]);
        // No Q16 activation is certified in DS-5a. Even a future SUPPORTED value
        // is explicitly ignored rather than silently applied twice.
        if(value.at("status")!="INACTIVE")p.unsupportedEffects|=1u<<e;
      }
      p.valid=true;
    }catch(...){next.profile.valid=false;}
    const bool valid=next.profile.valid;profiles[id]=std::move(next);return valid;
  }
  const Profile* Get(uint32_t id,const void* actor) const {
    const auto i=profiles.find(id);
    if(i==profiles.end())return nullptr;
    const auto owner=i->second.actor.lock();
    return owner && owner.get()==actor ? &i->second.profile : nullptr;
  }
  size_t ProfileCount() { Sweep();return profiles.size(); }
  uint64_t profileParses=0;
  std::shared_ptr<const Catalog> catalog;
  Reason catalogReason=Reason::CatalogAbsent;
private:
  Resolver resolve;
  Hydrator hydrate;
  std::string catalogText;
  std::map<uint32_t,Entry> profiles;
  std::array<uint32_t,2048> requests{};
  size_t requestCount=0;
};
}
