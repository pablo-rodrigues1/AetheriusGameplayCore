#pragma once
#include "PropertyBinding.h"
// AETHERIUS DEV-A1: native entry, not visible as a custom/persisted property.
class DevAttributesBinding : public PropertyBinding {
public:
  std::string GetPropertyName() const override { return "aetheriusDevAttributes"; }
  Napi::Value Get(Napi::Env env, ScampServer& server, uint32_t id) override;
  void Set(Napi::Env env, ScampServer& server, uint32_t id, Napi::Value value) override;
};
