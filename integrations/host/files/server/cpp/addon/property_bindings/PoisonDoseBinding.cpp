#include "PoisonDoseBinding.h"
#include "MpActor.h"
#include "ScampServer.h"
#include "PartOne.h"
#include <cmath>
Napi::Value PoisonDoseBinding::Get(Napi::Env env, ScampServer& server, uint32_t id) {
  return Napi::Number::New(env, server.GetPartOne()->worldState.GetFormAt<MpActor>(id).GetPoisonDoseBonus());
}
void PoisonDoseBinding::Set(Napi::Env env, ScampServer& server, uint32_t id, Napi::Value value) {
  if (!value.IsNumber()) throw Napi::TypeError::New(env, "Poison bonus must be an integer");
  const auto bonus = value.As<Napi::Number>().DoubleValue();
  if (!std::isfinite(bonus) || std::floor(bonus) != bonus || bonus < 0 || bonus > 65534)
    throw Napi::RangeError::New(env, "Poison bonus outside 0..65534");
  server.GetPartOne()->worldState.GetFormAt<MpActor>(id).SetPoisonDoseBonus(static_cast<uint32_t>(bonus));
}
Napi::Value PoisonStatusBinding::Get(Napi::Env env, ScampServer& server, uint32_t id) {
  const auto& actor = server.GetPartOne()->worldState.GetFormAt<MpActor>(id);
  auto result = Napi::Object::New(env);
  result.Set("result", actor.GetPoisonResult());
  result.Set("unsupportedFamilies", actor.GetPoisonUnsupported());
  return result;
}
void WeaponPoisonIntentBinding::Set(Napi::Env env, ScampServer& server, uint32_t id, Napi::Value value) {
  if (!value.IsObject() || value.IsArray()) throw Napi::TypeError::New(env, "Expected weapon poison intent");
  const auto object = value.As<Napi::Object>();
  if (object.GetPropertyNames().Length() != 3 || !object.Get("hand").IsString())
    throw Napi::TypeError::New(env, "Expected weaponId, poisonId and hand");
  const auto hand = object.Get("hand").As<Napi::String>().Utf8Value();
  if (hand != "left" && hand != "right") throw Napi::TypeError::New(env, "Invalid hand");
  auto formId = [&](const char* key) {
    const auto field = object.Get(key);
    if (!field.IsNumber()) throw Napi::TypeError::New(env, "Invalid record evidence");
    const auto number = field.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(number) || std::floor(number) != number || number < 1 || number > UINT32_MAX)
      throw Napi::RangeError::New(env, "Invalid record evidence");
    return static_cast<uint32_t>(number);
  };
  server.GetPartOne()->worldState.GetFormAt<MpActor>(id).RequestWeaponPoison(formId("poisonId"), formId("weaponId"), hand == "left");
}
