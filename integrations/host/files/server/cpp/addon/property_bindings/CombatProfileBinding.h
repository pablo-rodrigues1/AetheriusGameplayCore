#pragma once
#include "PropertyBinding.h"
#include "NapiHelper.h"
#include "aetherius_combat/ds5a/Host.h"

// Native private projection. No client publication, callback or hit-time JSON.
class CombatProfileBinding final : public PropertyBinding {
public:
  std::string GetPropertyName() const override { return "aetheriusCombatProfile"; }
  Napi::Value Get(Napi::Env env,ScampServer& server,uint32_t id) override {
    auto& actor=server.GetPartOne()->worldState.GetFormAt<MpActor>(id);
    return NapiHelper::ParseJson(env,actor.GetDynamicFields().GetValueDump(GetPropertyName()));
  }
  void Set(Napi::Env env,ScampServer& server,uint32_t id,Napi::Value value) override {
    auto& world=server.GetPartOne()->worldState;
    auto& actor=world.GetFormAt<MpActor>(id);
    uint64_t revision=0;
    if(!value.IsNull()) {
      if(!value.IsObject()||value.IsArray())throw Napi::TypeError::New(env,"Expected combat profile or null");
      const auto field=value.As<Napi::Object>().Get("revision");
      const double n=field.IsNumber()?field.As<Napi::Number>().DoubleValue():0;
      if(!std::isfinite(n)||n<1||n>9007199254740991.0||std::floor(n)!=n)
        throw Napi::RangeError::New(env,"Invalid combat profile revision");
      revision=static_cast<uint64_t>(n);
    }
    const auto raw=NapiHelper::Stringify(env,value);
    if(const auto bridge=aetherius::combat::ds5a::FindBridge(&world)) {
      const auto base=FormDesc::FromFormId(actor.GetBaseId(),world.pluginIndexMapping);
      std::optional<aetherius::combat::StableFormKey> identity;
      if(!base.file.empty()) {
        std::ostringstream key;key<<base.file<<':'<<std::uppercase<<std::hex<<std::setw(6)<<std::setfill('0')<<base.shortFormId;
        identity=aetherius::combat::StableFormKey::Parse(key.str());
      }
      bridge->Publish(id,world.LookupFormById(id),revision,raw,actor.GetNpcGeneration(),identity?&*identity:nullptr);
    }
    actor.SetPropertyValueDump(GetPropertyName(),raw,false,false);
  }
};

// Normalizes the host's confirmed private observation to the fixed DS-4 contract.
// JSON/record resolution is permitted here: this read is requested outside hits.
class CombatNpcObservationBinding final : public PropertyBinding {
public:
  std::string GetPropertyName() const override { return "aetheriusNpcObservation"; }
  Napi::Value Get(Napi::Env env,ScampServer& server,uint32_t id) override {
    auto& world=server.GetPartOne()->worldState;
    auto& actor=world.GetFormAt<MpActor>(id);
    nlohmann::json result={{"status","UNSUPPORTED"},{"reason","NPC_OBSERVATION_UNCONFIRMED"},
      {"generation",std::to_string(actor.GetNpcGeneration())},{"stableFormKey",nullptr}};
    if(!actor.IsCreatedAsPlayer()&&(!actor.NeedsNpcObservation()||actor.IsNpcConfirmed())) {
      FormDesc base=FormDesc::FromFormId(actor.GetBaseId(),world.pluginIndexMapping);
      if(actor.IsNpcConfirmed()) {
        const auto saved=nlohmann::json::parse(actor.GetDynamicFields().GetValueDump("private.aetheriusNpcObservation"));
        base=FormDesc::FromString(saved.at("base").get<std::string>());
        result["level"]=actor.GetNpcLevel();
      }
      std::ostringstream key;key<<base.file<<'|'<<std::uppercase<<std::hex<<std::setw(6)<<std::setfill('0')<<base.shortFormId;
      auto text=key.str();std::transform(text.begin(),text.begin()+text.find('|'),text.begin(),[](unsigned char c){return static_cast<char>(std::tolower(c));});
      result["status"]="CONFIRMED";result["stableFormKey"]=text;result["reason"]=nullptr;
    }
    return NapiHelper::ParseJson(env,result.dump());
  }
};
