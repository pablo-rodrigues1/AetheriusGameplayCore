#pragma once
#include "PropertyBinding.h"
// AETHERIUS C3d: transient native state, never a persisted custom property.
class AttributeBonusesBinding : public PropertyBinding {
public:
  std::string GetPropertyName() const override { return "aetheriusAttributeBonuses"; }
  Napi::Value Get(Napi::Env env, ScampServer& server, uint32_t id) override;
  void Set(Napi::Env env, ScampServer& server, uint32_t id, Napi::Value value) override;
};
