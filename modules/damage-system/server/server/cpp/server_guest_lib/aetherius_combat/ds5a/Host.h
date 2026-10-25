#pragma once
#include "Bridge.h"
#include "MpActor.h"
#include "WorldState.h"
#include "formulas/IDamageFormula.h"
#include <limits>

namespace aetherius::combat::ds5a {
// Accessed only on the server thread. Weak registry never keeps a world alive.
inline std::map<const WorldState*,std::weak_ptr<Bridge>>& Bridges() {
  static std::map<const WorldState*,std::weak_ptr<Bridge>> value;return value;
}
inline std::shared_ptr<Bridge> FindBridge(const WorldState* world) {
  const auto i=Bridges().find(world);return i==Bridges().end()?nullptr:i->second.lock();
}
inline Settings ReadSettings(const Json& combat) {
  Settings out;
  if(!combat.is_object())return out;
  if(combat.contains("families")) {
    const auto& rows=combat.at("families");
    if(!rows.is_object())throw std::invalid_argument("aetheriusCombat.families must be object");
    for(const auto& item:rows.items()) {
      const auto family=std::find(FamilyNames.begin(),FamilyNames.end(),item.key());
      if(family==FamilyNames.end())throw std::invalid_argument("unknown combat family");
      const auto mode=item.value().get<std::string>();
      if(mode!="off"&&mode!="shadow"&&mode!="active")throw std::invalid_argument("unknown family mode");
      out.modes[family-FamilyNames.begin()]=mode=="off"?Mode::Off:mode=="shadow"?Mode::Shadow:Mode::Active;
    }
  }
  if(combat.contains("multipliers")) {
    const auto& row=combat.at("multipliers");
    out.pve=Numeric(row.at("pve"),100);out.pvp=Numeric(row.at("pvp"),100);
  }
  return out;
}
inline bool Enabled(const Settings& s) { for(const auto m:s.modes)if(m!=Mode::Off)return true;return false; }
struct Sample { uint64_t sequence=0;uint32_t attacker=0,defender=0,source=0;float current=0;Trace trace; };
struct Buffer {
  static constexpr size_t Capacity=1024;
  std::array<Sample,Capacity> samples{};
  uint64_t hits=0;size_t size=0,next=0;
  void Add(Sample s) {s.sequence=++hits;samples[next]=s;next=(next+1)%Capacity;if(size<Capacity)++size;}
  Json Read() const {
    Json rows=Json::array();
    for(size_t n=0;n<size;++n) {
      const auto& s=samples[(next+Capacity-size+n)%Capacity];const auto& t=s.trace;
      rows.push_back({{"sequence",s.sequence},{"aggressor",s.attacker},{"target",s.defender},{"source",s.source},
        {"family",FamilyNames[static_cast<unsigned>(t.family)]},{"current",s.current},
        {"status",t.status==Status::Calculated?"CALCULATED":t.status==Status::Invalid?"INVALID":"UNSUPPORTED"},
        {"reason",ReasonName(t.reason)},{"candidate",t.status==Status::Calculated?Json(t.candidate):Json(nullptr)},
        {"attackerRevision",t.attackerRevision},{"defenderRevision",t.defenderRevision},
        {"weaponBase",t.weaponBase},{"ammoBase",t.ammoBase},{"weaponSkill",t.weaponSkill},{"skillFactor",t.skillFactor},
        {"armorRating",t.armor},{"recordDamageResist",t.recordDamageResist},{"armorReduction",t.armorReduction},
        {"blockConfirmed",t.blockConfirmed},{"blockReduction",t.blockReduction},{"globalMultiplier",t.global},{"preDefense",t.preDefense},
        {"refinementTier",0},{"q16Contribution",0},{"attackerUnsupportedEffects",t.attackerUnsupportedEffects},
        {"defenderUnsupportedEffects",t.defenderUnsupportedEffects},{"q16Reason","ACTIVE_EFFECT_INSTANCE_MAGNITUDE_UNAVAILABLE"},
        {"hitIdentity","HOST_RECEIVED_NO_UNIQUENESS_CLAIM"}});
    }
    return {{"capacity",Capacity},{"hits",hits},{"overwritten",hits-size},{"samples",rows}};
  }
};
class Formula final : public IDamageFormula {
public:
  Formula(std::unique_ptr<IDamageFormula> current,std::shared_ptr<Bridge> bridge,
      Settings settings,std::shared_ptr<Buffer> buffer):current(std::move(current)),bridge(std::move(bridge)),settings(settings),buffer(std::move(buffer)) {}
  Trace Evaluate(const MpActor& attacker,const MpActor& defender,const HitData& hit) const {
    Trace t;
    const auto fail=[&](Reason reason){t.reason=reason;return t;};
    if(!attacker.IsCreatedAsPlayer())bridge->RequestNpc(attacker.GetFormId());
    if(!defender.IsCreatedAsPlayer())bridge->RequestNpc(defender.GetFormId());
    const auto* a=bridge->Get(attacker.GetFormId(),&attacker);
    const auto* d=bridge->Get(defender.GetFormId(),&defender);
    if(a)t.attackerRevision=a->revision;
    if(d)t.defenderRevision=d->revision;
    const auto cat=bridge->catalog; // one immutable catalog and profile revision per side
    if(!cat)return fail(bridge->catalogReason);
    const bool unarmed=hit.source==0x1f4; // host protocol's unarmed sentinel; never persisted
    const auto found=cat->records.find(hit.source);
    const Record* weapon=found==cat->records.end()?nullptr:&found->second;
    t.family=unarmed?Family::Unarmed:weapon&&weapon->ranged?Family::Ranged:Family::Melee;
    if(!a||!d)return fail(Reason::ProfileAbsent);
    if((!a->player&&a->npcGeneration && a->npcGeneration!=attacker.GetNpcGeneration())
      ||(!d->player&&d->npcGeneration && d->npcGeneration!=defender.GetNpcGeneration()))return fail(Reason::ProfileAbsent);
    if((attacker.NeedsNpcObservation()&&!attacker.IsNpcConfirmed())
      ||(defender.NeedsNpcObservation()&&!defender.IsNpcConfirmed()))return fail(Reason::ProfileAbsent);
    if(!a->valid||!d->valid){t.status=Status::Invalid;return fail(Reason::ProfileInvalid);}
    // Reject stale player projection after disconnect even if the form remains alive.
    if((a->player&&attacker.GetUserId()==Networking::InvalidUserId)
        ||(d->player&&defender.GetUserId()==Networking::InvalidUserId))return fail(Reason::ProfileAbsent);
    t.attackerUnsupportedEffects=a->unsupportedEffects;t.defenderUnsupportedEffects=d->unsupportedEffects;
    const auto& offense=attacker.GetEquipment().inv.entries;
    const auto& defense=defender.GetEquipment().inv.entries;
    if(offense.size()>64||defense.size()>64)return fail(Reason::EquipmentCapacity);
    unsigned weaponCount=0,ammoCount=0;
    const Inventory::Entry* weaponEntry=nullptr;
    NeutralRefinement refinement;
    if(unarmed) {
      const auto race=cat->records.find(a->race);
      if(race==cat->records.end()||race->second.kind!=Record::Kind::Race||!race->second.supported)return fail(Reason::RaceAbsent);
      t.weaponBase=race->second.base;
    }else {
      if(!weapon)return fail(Reason::RecordAbsent);
      if(weapon->kind!=Record::Kind::Weapon||!weapon->supported)return fail(Reason::RecordUnsupported);
      for(const auto& entry:offense) {
        if(!entry.count||entry.GetWorn()==Inventory::Worn::None)continue;
        if(entry.baseId==hit.source){++weaponCount;weaponEntry=&entry;}
        if(weapon->ranged) {
          const auto row=cat->records.find(entry.baseId);
          if(row!=cat->records.end()&&row->second.kind==Record::Kind::Ammo) {
            if(!row->second.supported)return fail(Reason::RecordUnsupported);
            ++ammoCount;t.ammoBase=row->second.base;
          }
        }
      }
      if(!weaponCount)return fail(Reason::SourceNotEquipped);
      if(weaponCount>1||ammoCount>1)return fail(Reason::AmbiguousEquipment);
      if(weapon->ranged&&!ammoCount)return fail(Reason::AmmoAbsent);
      const auto skill=a->skills[static_cast<unsigned>(weapon->skill)];
      if(!skill.supported)return fail(Reason::SkillAbsent);
      t.weaponSkill=skill.value;t.weaponBase=weapon->base;
    }
    for(const auto& entry:defense) {
      if(!entry.count||entry.GetWorn()==Inventory::Worn::None)continue;
      const auto row=cat->records.find(entry.baseId);
      if(row==cat->records.end())return fail(Reason::RecordAbsent);
      const auto& rec=row->second;
      if(rec.kind!=Record::Kind::Armor)continue;
      if(!rec.supported)return fail(Reason::RecordUnsupported);
      if(entry.enchantmentId.value_or(0))return fail(Reason::InstanceEnchantment);
      double skill=0;
      if(!rec.clothing) {
        const auto value=d->skills[static_cast<unsigned>(rec.skill)];
        if(!value.supported)return fail(Reason::SkillAbsent);
        skill=value.value;
      }
      // Flat record ENCH DamageResist is preserved once, outside base scaling/Q16.
      t.armor+=rec.clothing?rec.base:ArmorPiece(rec.base,skill,cat->scaling,refinement.Tier(&entry));
      t.recordDamageResist+=rec.damageResist;
    }
    t.blockConfirmed=hit.isHitBlocked&&defender.IsBlockActive();
    if(t.blockConfirmed) {
      const auto skill=d->skills[static_cast<unsigned>(Skill::Block)];
      if(!skill.supported)return fail(Reason::SkillAbsent);
      t.blockReduction=Block(skill.value);
    }
    t.global=a->player&&d->player?settings.pvp:settings.pve;
    Finish(t,cat->scaling,refinement.Tier(weaponEntry),unarmed);
    return t;
  }
  float CalculateDamage(const MpActor& a,const MpActor& d,const HitData& hit) const override {
    const float applied=current->CalculateDamage(a,d,hit);
    auto t=Evaluate(a,d,hit);
    const auto mode=settings.modes[static_cast<unsigned>(t.family)];
    if(mode==Mode::Off)return applied;
    // DS-7 must supply actual hit identity and certify two-client application.
    if(mode==Mode::Active){t.status=Status::Unsupported;t.reason=Reason::ActiveRequiresDS7;}
    buffer->Add({0,hit.aggressor,hit.target,hit.source,applied,t});
    return applied;
  }
  float CalculateDamage(const MpActor& a,const MpActor& d,const SpellCastData& spell) const override {
    return current->CalculateDamage(a,d,spell);
  }
private:
  std::unique_ptr<IDamageFormula> current;
  std::shared_ptr<Bridge> bridge;
  Settings settings;
  std::shared_ptr<Buffer> buffer;
};
inline Json Capabilities(const Settings& settings,const Bridge& bridge) {
  Json families=Json::object();
  for(unsigned i=0;i<FamilyNames.size();++i) {
    const auto mode=settings.modes[i];
    families[FamilyNames[i]]={{"mode",mode==Mode::Off?"off":mode==Mode::Shadow?"shadow":"active"},
      {"owner","NATIVE_SERVER"},{"candidateOwner","AETHERIUS_SERVER"},
      {"status",mode==Mode::Shadow&&bridge.catalog?"SHADOW":"UNSUPPORTED"},
      {"reason",mode==Mode::Off?"FAMILY_OFF":mode==Mode::Active?"ACTIVE_REQUIRES_DS7":bridge.catalog?"NO_PERKS_DS5A":ReasonName(bridge.catalogReason)}};
  }
  return {{"version",1},{"families",families},{"recordDamageResist","PRESERVED_ONCE"},
    {"perks","UNSUPPORTED_DS5B"},{"q16","UNSUPPORTED_ZERO_CONTRIBUTION"},
    {"magicOwner","NATIVE_SERVER"},{"procsOwner","NATIVE_CLIENT"},{"deduplication","HOST_COOLDOWNS_ONLY_DS7_PENDING"}};
}
}
