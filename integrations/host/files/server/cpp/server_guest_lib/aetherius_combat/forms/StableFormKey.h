#pragma once
#include <algorithm>
#include <cctype>
#include <cstdint>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <string>

namespace aetherius::combat {
struct StableFormKey {
  std::string plugin;
  uint32_t localId = 0;
  static StableFormKey Parse(const std::string& text) {
    const auto colon = text.rfind(':');
    if (colon == std::string::npos || text.size() - colon - 1 != 6)
      throw std::invalid_argument("StableFormKey requires plugin:XXXXXX");
    auto file = text.substr(0, colon);
    std::transform(file.begin(), file.end(), file.begin(),
      [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    const auto dot = file.rfind('.');
    if (dot == std::string::npos ||
        (file.substr(dot) != ".esp" && file.substr(dot) != ".esm" && file.substr(dot) != ".esl") ||
        file.find_first_of("/\\:") != std::string::npos)
      throw std::invalid_argument("invalid plugin filename");
    const auto hex = text.substr(colon + 1);
    if (!std::all_of(hex.begin(), hex.end(), [](unsigned char c) { return std::isxdigit(c); }))
      throw std::invalid_argument("invalid local FormID");
    const auto id = static_cast<uint32_t>(std::stoul(hex, nullptr, 16));
    if (!id) throw std::invalid_argument("null local FormID");
    return {file, id};
  }
  std::string ToString() const {
    std::ostringstream out;
    out << plugin << ':' << std::uppercase << std::hex << std::setw(6) << std::setfill('0') << localId;
    return out.str();
  }
  bool operator==(const StableFormKey& r) const { return plugin == r.plugin && localId == r.localId; }
  bool operator<(const StableFormKey& r) const { return plugin < r.plugin || (plugin == r.plugin && localId < r.localId); }
};
}
