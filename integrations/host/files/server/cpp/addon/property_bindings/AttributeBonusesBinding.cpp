#include "AttributeBonusesBinding.h"
#include "MpActor.h"
#include "ScampServer.h"
#include "PartOne.h"
#include <cmath>

Napi::Value AttributeBonusesBinding::Get(Napi::Env env, ScampServer& server, uint32_t id)
{
  auto& actor = server.GetPartOne()->worldState.GetFormAt<MpActor>(id);
  auto encode = [&](const BaseActorValues& values) {
    auto result = Napi::Object::New(env);
    result.Set("health", values.health);
    result.Set("magicka", values.magicka);
    result.Set("stamina", values.stamina);
    return result;
  };
  auto result = Napi::Object::New(env);
  result.Set("base", encode(actor.GetBaseValues()));
  result.Set("maximum", encode(actor.GetMaximumValues()));
  result.Set("origin", actor.HasDevAttributes() ? "DEV" : actor.HasAttributeBonuses() ? "CLASS_ADDITIVE" : "RECORDS");
  return result;
}
void AttributeBonusesBinding::Set(Napi::Env env, ScampServer& server, uint32_t id, Napi::Value value)
{
  auto& actor = server.GetPartOne()->worldState.GetFormAt<MpActor>(id);
  if (value.IsNull()) { actor.SetAttributeBonuses(std::nullopt); return; }
  if (!value.IsObject() || value.IsArray())
    throw Napi::TypeError::New(env, "Expected health, magicka, stamina deltas or null");
  const auto object = value.As<Napi::Object>();
  if (object.GetPropertyNames().Length() != 3)
    throw Napi::TypeError::New(env, "Expected exactly health, magicka, stamina");
  auto integer = [&](const char* key) {
    const auto field = object.Get(key);
    if (!field.IsNumber()) throw Napi::TypeError::New(env, "Expected integer allocation");
    const auto number = field.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(number) || std::floor(number) != number
        || number < 0 || number > 585 || std::fmod(number, 5) != 0)
      throw Napi::RangeError::New(env, "ATTRIBUTE_POINTS_INVALID");
    return static_cast<int>(number);
  };
  actor.SetAttributeBonuses(aetherius::attributes::Bonuses{
    integer("health"), integer("magicka"), integer("stamina") });
}
