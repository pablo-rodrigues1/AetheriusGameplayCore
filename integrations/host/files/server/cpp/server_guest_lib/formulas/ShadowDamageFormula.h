#pragma once
#include "IDamageFormula.h"
#include "aetherius_combat/ShadowStatus.h"
#include <array>
#include <cmath>
#include <memory>
#include <nlohmann/json.hpp>

// All methods run on the host's server thread. Read outside CalculateDamage;
// concurrent readers would require synchronization before using this API.
class ShadowDamageFormula final : public IDamageFormula {
public:
  static constexpr size_t kCapacity = 1024;
  enum class Status { Calculated, Unsupported, Exception, Invalid };
  struct Sample {
    uint64_t sequence = 0;
    HitData hit{};
    float current = 0, candidate = 0;
    bool neutralProfile = true;
    Status status = Status::Calculated;
    aetherius::combat::UnsupportedReason reason = aetherius::combat::UnsupportedReason::None;
  };
  struct Buffer {
    std::array<Sample, kCapacity> samples{};
    uint64_t hits = 0, failures = 0, exceptions = 0, invalid = 0, unsupported = 0;
    size_t size = 0, next = 0;
    // JSON/string allocation is confined to this explicitly requested read.
    nlohmann::json Read() const {
      auto rows = nlohmann::json::array();
      for (size_t i = 0; i < size; ++i) {
        const auto& s = samples[(next + kCapacity - size + i) % kCapacity];
        rows.push_back({{"sequence", s.sequence}, {"aggressor", s.hit.aggressor},
          {"target", s.hit.target}, {"source", s.hit.source}, {"projectile", s.hit.projectile},
          {"power", s.hit.isPowerAttack}, {"blocked", s.hit.isHitBlocked},
          {"sneak", s.hit.isSneakAttack}, {"bash", s.hit.isBashAttack},
          {"current", s.current}, {"candidate", s.status == Status::Calculated
            ? nlohmann::json(s.candidate) : nlohmann::json(nullptr)},
          {"neutralProfile", s.neutralProfile},
          {"status", s.status == Status::Calculated ? "CALCULATED" :
            s.status == Status::Unsupported ? "UNSUPPORTED" :
            s.status == Status::Exception ? "EXCEPTION" : "INVALID"},
          {"unsupportedReason", static_cast<int>(s.reason)}});
      }
      return {{"capacity", kCapacity}, {"hits", hits}, {"failures", failures},
        {"exceptions", exceptions}, {"invalid", invalid}, {"unsupported", unsupported},
        {"overwritten", hits - size}, {"profile", "NEUTRAL_SHADOW_ONLY"},
        {"samples", std::move(rows)}};
    }
  };
  ShadowDamageFormula(std::unique_ptr<IDamageFormula> current,
    std::unique_ptr<IDamageFormula> candidate, std::shared_ptr<Buffer> buffer)
    : current(std::move(current)), candidate(std::move(candidate)), buffer(std::move(buffer)) {
    if (!this->current || !this->candidate || !this->buffer)
      throw std::invalid_argument("shadow requires both formulas and buffer");
  }
  float CalculateDamage(const MpActor& attacker, const MpActor& defender,
    const HitData& hit) const override {
    const float applied = current->CalculateDamage(attacker, defender, hit);
    Sample sample{};
    sample.sequence = ++buffer->hits;
    sample.hit = hit;
    sample.current = applied;
    try {
      sample.candidate = candidate->CalculateDamage(attacker, defender, hit);
      if (!std::isfinite(sample.candidate) || sample.candidate < 0) {
        sample.status = Status::Invalid;
        ++buffer->failures; ++buffer->invalid;
      }
    } catch (const aetherius::combat::ShadowUnsupported& e) {
      sample.status = Status::Unsupported; sample.reason = e.reason;
      ++buffer->unsupported;
    } catch (...) {
      sample.status = Status::Exception;
      ++buffer->failures; ++buffer->exceptions;
    }
    buffer->samples[buffer->next] = sample;
    buffer->next = (buffer->next + 1) % kCapacity;
    if (buffer->size < kCapacity) ++buffer->size;
    return applied;
  }
  float CalculateDamage(const MpActor& attacker, const MpActor& defender,
    const SpellCastData& spell) const override {
    return current->CalculateDamage(attacker, defender, spell);
  }
private:
  std::unique_ptr<IDamageFormula> current, candidate;
  std::shared_ptr<Buffer> buffer;
};
