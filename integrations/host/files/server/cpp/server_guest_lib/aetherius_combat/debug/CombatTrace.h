#pragma once
#include <string>
#include <vector>
namespace aetherius::combat {
struct TraceStep { std::string stage, source; double value; };
class CombatTrace {
public:
  explicit CombatTrace(bool enabled = false) : enabled(enabled) {}
  void Add(const std::string& stage, double value, const std::string& source = "SERVER") {
    if (enabled) steps.push_back({stage,source,value});
  }
  const std::vector<TraceStep>& Steps() const { return steps; }
private:
  bool enabled;
  std::vector<TraceStep> steps;
};
}
