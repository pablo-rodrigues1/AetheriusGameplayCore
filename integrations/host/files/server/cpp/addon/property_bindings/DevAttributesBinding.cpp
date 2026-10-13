#include "DevAttributesBinding.h"
#include "MpActor.h"
#include "ScampServer.h"
#include "PartOne.h"
#include <cmath>

Napi::Value DevAttributesBinding::Get(Napi::Env env, ScampServer& server, uint32_t id)
{
  auto& actor = server.GetPartOne()->worldState.GetFormAt<MpActor>(id);
  if (!actor.HasDevAttributes()) return env.Null();
  const auto values = actor.GetMaximumValues();
  auto result = Napi::Object::New(env);
  result.Set("health", values.health);
  result.Set("magicka", values.magicka);
  result.Set("stamina", values.stamina);
  return result;
}

void DevAttributesBinding::Set(Napi::Env env, ScampServer& server, uint32_t id, Napi::Value value)
{
  auto& actor = server.GetPartOne()->worldState.GetFormAt<MpActor>(id);
  if (value.IsNull()) { actor.SetDevAttributes(std::nullopt); return; }
  if (!value.IsObject() || value.IsArray())
    throw Napi::TypeError::New(env, "Expected DEV health, magicka, stamina or null");
  const auto object = value.As<Napi::Object>();
  if (object.GetPropertyNames().Length() != 3)
    throw Napi::TypeError::New(env, "Expected exactly health, magicka, stamina");
  auto integer = [&](const char* key) {
    const auto field = object.Get(key);
    if (!field.IsNumber()) throw Napi::TypeError::New(env, "Expected DEV integer");
    const auto number = field.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(number) || std::floor(number) != number || number < 1 || number > 100000)
      throw Napi::RangeError::New(env, "DEV attributes outside 1..100000");
    return static_cast<int>(number);
  };
  actor.SetDevAttributes(aetherius::development::Attributes{
    integer("health"), integer("magicka"), integer("stamina") });
}
