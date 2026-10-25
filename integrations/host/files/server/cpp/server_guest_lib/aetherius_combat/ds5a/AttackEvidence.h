#pragma once
#include <chrono>
#include <string_view>
#include <cstdint>
namespace aetherius::combat::ds5b {
// Fixed storage on each actor. Only the accepted animation ingress writes it.
// A confirmation is evidence of an animation, not a unique hit (DS-7 pending).
struct AttackEvidence {
  enum class Kind { None, Power, Bash };
  Kind kind=Kind::None;
  uint64_t generation=0;
  uint32_t hoster=0;
  std::chrono::steady_clock::time_point received{};
  void Record(std::string_view event,uint32_t owner,uint64_t epoch,std::chrono::steady_clock::time_point now) {
    // Exact event names from AnimationSystem.cpp; unknown/directional stays conventional (Q7).
    constexpr std::string_view power[]={"attackPowerStartInPlace","attackPowerStartBackward","attackPowerStartLeft",
      "attackPowerStartRight","attackPowerStartDualWield","attackPowerStartForward","attackPowerStart_2HWSprint","attackPowerStart_2HMSprint"};
    Kind next=Kind::None;
    for(auto name:power)if(event==name)next=Kind::Power;
    if(event=="bashStart"||event=="bashRelease"||event=="bashPowerStart")next=Kind::Bash;
    // Hit-frame events do not clear a preceding start confirmation.
    if(event=="weaponSwing"||event=="weaponLeftSwing"||event=="HitFrame")return;
    kind=next;hoster=owner;generation=epoch;received=now;
  }
  bool Confirm(Kind requested,uint32_t owner,uint64_t epoch,std::chrono::steady_clock::time_point now) const {
    const auto age=now-received;
    return kind==requested&&hoster==owner&&generation==epoch&&age>=std::chrono::steady_clock::duration::zero()
      &&age<=std::chrono::milliseconds(1500);
  }
};
}
