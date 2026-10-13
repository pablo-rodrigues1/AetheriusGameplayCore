#pragma once
#include "GetBaseActorValues.h"
#include <optional>
#include <stdexcept>

// AETHERIUS DEV-A1: transient resource maxima, never a change form or gameplay rule.
namespace aetherius::development {
struct Attributes {
  int health;
  int magicka;
  int stamina;
  void Validate() const {
    for (const auto value : { health, magicka, stamina })
      if (value < 1 || value > 100000)
        throw std::invalid_argument("DEV attributes outside 1..100000");
  }
  void Apply(BaseActorValues& values) const {
    values.health = static_cast<float>(health);
    values.magicka = static_cast<float>(magicka);
    values.stamina = static_cast<float>(stamina);
  }
};
}

// AETHERIUS C3d: normal server-authoritative additive allocation.
namespace aetherius::attributes {
struct Bonuses {
  int health;
  int magicka;
  int stamina;
  void Validate() const {
    for (const auto value : { health, magicka, stamina })
      if (value < 0 || value > 585 || value % 5 != 0)
        throw std::invalid_argument("ATTRIBUTE_POINTS_INVALID");
    if (health + magicka + stamina > 585)
      throw std::invalid_argument("ATTRIBUTE_POINTS_INVALID");
  }
  void Apply(BaseActorValues& values) const {
    values.health += static_cast<float>(health);
    values.magicka += static_cast<float>(magicka);
    values.stamina += static_cast<float>(stamina);
  }
};
}
