#pragma once
#include "PropertyBinding.h"
// AETHERIUS D-P1: native, transient properties; never a custom/save property.
class PoisonDoseBinding : public PropertyBinding {
public:
  std::string GetPropertyName() const override { return "aetheriusPoisonDoseBonus"; }
  Napi::Value Get(Napi::Env env, ScampServer& server, uint32_t id) override;
  void Set(Napi::Env env, ScampServer& server, uint32_t id, Napi::Value value) override;
};
class PoisonStatusBinding : public PropertyBinding {
public:
  std::string GetPropertyName() const override { return "aetheriusPoisonStatus"; }
  Napi::Value Get(Napi::Env env, ScampServer& server, uint32_t id) override;
};
// AETHERIUS D-P1-fix2: command entry, not persisted/custom property.
class WeaponPoisonIntentBinding : public PropertyBinding {
public:
  std::string GetPropertyName() const override { return "aetheriusWeaponPoisonIntent"; }
  void Set(Napi::Env env, ScampServer& server, uint32_t id, Napi::Value value) override;
};
