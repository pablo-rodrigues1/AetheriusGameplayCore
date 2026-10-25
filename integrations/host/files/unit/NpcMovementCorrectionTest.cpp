#include "TestUtils.hpp"
#include "ActionListener.h"
#include "MovementValidation.h"
#include "WorldState.h"
#include "libespm/Loader.h"
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include "aetherius_combat/CombatProbe.h"

#ifndef AETHERIUS_MOVEMENT_STANDALONE
extern espm::Loader& GetEspmLoader();
#endif

namespace {
// Uses real PartOne/ActionListener and message serialization, no network server.
// Packet shapes match TestUtils.hpp and OnUpdateMovement/OnHostAttempt.
struct MovementFixture
{
  PartOne p;
  MovementValidation::NpcCorrections corrections;
  uint32_t first, second, npcId;
  MovementFixture()
  {
    p.worldState.espmFiles = {"Skyrim.esm"};
    p.worldState.pluginIndexMapping.Build(p.worldState.espmFiles);
    first = p.worldState.GenerateFormId();
    second = p.worldState.GenerateFormId();
    npcId = p.worldState.GenerateFormId();
    p.CreateActor(first, {0, 0, 0}, 0, 0x3c);
    p.CreateActor(second, {0, 0, 0}, 0, 0x3c);
    p.CreateActor(npcId, {0, 0, 0}, 25, 0x3c);
    DoConnect(p, 0); DoConnect(p, 1);
    p.SetUserActor(0, first); p.SetUserActor(1, second);
    p.worldState.hosters[npcId] = first;
    p.Messages().clear();
  }
  MpActor& Npc() { return p.worldState.GetFormAt<MpActor>(npcId); }
  bool Validate(float distance, int64_t ms = 0, Networking::UserId user = 0,
                std::optional<FormDesc> destination = {})
  {
    auto& npc = Npc();
    return MovementValidation::Validate(p, npc.GetPos(), npc.GetAngle(), npc.GetCellOrWorld(),
      npc.GetPos() + NiPoint3{distance, 0, 0}, destination.value_or(npc.GetCellOrWorld()),
      user, &npc, p.worldState.pluginIndexMapping, &corrections,
      MovementValidation::NpcCorrections::Clock::time_point{} + std::chrono::milliseconds(ms));
  }
  std::vector<PartOne::Message> Teleports()
  {
    std::vector<PartOne::Message> result;
    for (const auto& m : p.Messages())
      if (m.j.value("t", -1) == static_cast<int>(MsgType::Teleport) ||
          m.j.value("t", -1) == static_cast<int>(MsgType::Teleport2)) result.push_back(m);
    return result;
  }
  void Movement(float distance, Networking::UserId user = 0, std::optional<uint32_t> world = {})
  {
    auto msg = jMovement;
    msg["idx"] = Npc().GetIdx();
    msg["data"]["pos"] = {distance, 0, 0};
    if (world) msg["data"]["worldOrCell"] = *world;
    DoMessage(p, user, msg);
  }
};
struct ProbeGuard
{
  std::shared_ptr<aetherius::combat::CombatProbe> previous = aetherius::combat::InstalledCombatProbe();
  std::shared_ptr<aetherius::combat::CombatProbe> probe = std::make_shared<aetherius::combat::CombatProbe>();
  ProbeGuard() { aetherius::combat::InstallCombatProbe(probe); }
  ~ProbeGuard() { aetherius::combat::InstallCombatProbe(previous); }
};
}

TEST_CASE("Hosted NPC correction preserves the 4096 movement boundary", "[NpcMovementCorrection]")
{
  auto distance = GENERATE(4095.f, 4096.f, 4097.f);
  MovementFixture f;
  const auto pos = f.Npc().GetPos();
  REQUIRE(f.Validate(distance) == (distance < 4096));
  REQUIRE(f.Npc().GetPos() == pos);
  auto packets = f.Teleports();
  REQUIRE(packets.size() == (distance < 4096 ? 0 : 1));
  if (!packets.empty()) {
    REQUIRE(packets[0].j["t"] == static_cast<int>(MsgType::Teleport));
    REQUIRE(packets[0].j["idx"] == f.Npc().GetIdx());
    REQUIRE(packets[0].j["pos"] == nlohmann::json::array({0,0,0}));
    REQUIRE(packets[0].j["rot"] == nlohmann::json::array({0,0,25}));
    REQUIRE(packets[0].reliable);
    REQUIRE(packets[0].userId == 0);
  }
}

TEST_CASE("Correction destination resolves stable world or interior after plugin reordering", "[NpcMovementCorrection]")
{
  const bool reordered = GENERATE(false, true);
  MovementFixture f;
  auto& world = f.p.worldState;
  world.espmFiles = reordered ? std::vector<std::string>{"Skyrim.esm", "Other.esp", "Location.esp"}
                             : std::vector<std::string>{"Skyrim.esm", "Location.esp", "Other.esp"};
  world.pluginIndexMapping.Build(world.espmFiles);
  const FormDesc location(0xabc, "Location.esp");
  f.Npc().SetCellOrWorldObsolete(location);
  REQUIRE_FALSE(f.Validate(0, 0, 0, FormDesc::Tamriel()));
  REQUIRE(f.Teleports().size() == 1);
  REQUIRE(f.Teleports()[0].j["worldOrCell"] == location.ToFormId(world.pluginIndexMapping));
  REQUIRE(FormDesc::FromFormId(f.Teleports()[0].j["worldOrCell"].get<uint32_t>(), world.pluginIndexMapping) == location);
  REQUIRE(f.Npc().GetCellOrWorld() == location);
}

TEST_CASE("NPC correction cadence is immediate then one second and resets on acceptance", "[NpcMovementCorrection]")
{
  MovementFixture f;
  REQUIRE_FALSE(f.Validate(4096, 0));
  REQUIRE_FALSE(f.Validate(4097, 999));
  REQUIRE(f.Teleports().size() == 1);
  REQUIRE_FALSE(f.Validate(4097, 1000));
  REQUIRE(f.Teleports().size() == 2);
  REQUIRE(f.Validate(10, 1001));
  REQUIRE_FALSE(f.Validate(4097, 1002));
  REQUIRE(f.Teleports().size() == 3);
  // Each retry uses the current authoritative position, not an old queued one.
  f.Npc().SetPos({100,0,0});
  f.Npc().SetTeleportFlag(false);
  REQUIRE_FALSE(f.Validate(4097, 2002));
  REQUIRE(f.Teleports().back().j["pos"] == nlohmann::json::array({100,0,0}));
}

TEST_CASE("Non hoster and owned player never receive an indexed NPC correction", "[NpcMovementCorrection]")
{
  MovementFixture f;
  REQUIRE_FALSE(f.Validate(4097, 0, 1));
  REQUIRE(f.Teleports().empty());
  f.Movement(4097, 1);
  REQUIRE(f.Teleports().empty());
  REQUIRE(f.Npc().GetPos() == NiPoint3{0,0,0});
  f.p.SetUserActor(1, f.npcId);
  REQUIRE_FALSE(f.Validate(4097));
  REQUIRE(f.Teleports().empty());
}

TEST_CASE("Host transfer clears NPC correction cadence and denies old hoster", "[NpcMovementCorrection][espm]")
{
  // UpdateHoster prepares a property packet through the real ESPM browser
  // (MpObjectReference.cpp:PreparePropertyMessage_), even for dynamic actors.

#ifdef AETHERIUS_MOVEMENT_STANDALONE
  const char* manifestPath = std::getenv("AETHERIUS_MOVEMENT_MANIFEST");
  REQUIRE(manifestPath != nullptr);
  std::ifstream input(manifestPath); nlohmann::json manifest; input >> manifest;
  std::vector<std::filesystem::path> paths;
  for (const auto& row : manifest.at("plugins"))
    paths.push_back(std::filesystem::path(manifestPath).parent_path() / row.at("filename").get<std::string>());
  espm::Loader loader(paths);
#else
  auto& loader = GetEspmLoader();
#endif
  MovementFixture f;
  f.p.AttachEspm(&loader);
  f.Movement(4097);
  REQUIRE(f.Teleports().size() == 1);
  auto idx = f.Npc().GetIdx();
  // This fixture assigns the initial hoster directly, before any accepted movement.
  f.p.worldState.lastMovUpdateByIdx.resize(static_cast<size_t>(idx) + 1);
  f.p.worldState.lastMovUpdateByIdx[idx] = std::chrono::system_clock::now() - std::chrono::seconds(3);
  DoMessage(f.p, 1, nlohmann::json{{"t", MsgType::Host}, {"remoteId", f.npcId}});
  REQUIRE(f.p.worldState.hosters.at(f.npcId) == f.second);
  f.p.Messages().clear();
  f.Movement(4097, 0);
  REQUIRE(f.Teleports().empty());
  f.Movement(4097, 1);
  REQUIRE(f.Teleports().size() == 1);
  REQUIRE(f.Teleports()[0].userId == 1);
  // Switching back in the same second also starts a fresh cadence.
  f.p.worldState.lastMovUpdateByIdx[idx] = std::chrono::system_clock::now() - std::chrono::seconds(3);
  DoMessage(f.p, 0, nlohmann::json{{"t", MsgType::Host}, {"remoteId", f.npcId}});
  f.p.Messages().clear(); f.Movement(4097);
  REQUIRE(f.Teleports().size() == 1);
  REQUIRE(f.Teleports()[0].userId == 0);
  REQUIRE(f.Npc().GetPos() == NiPoint3{0,0,0});
}

TEST_CASE("Destruction with retained reference cannot carry cadence into reused actor id", "[NpcMovementCorrection]")
{
  MovementFixture f;
  REQUIRE_FALSE(f.Validate(4097));
  std::shared_ptr<MpActor> old;
  f.p.worldState.DestroyForm(f.npcId, &old);
  f.p.CreateActor(f.npcId, {0,0,0}, 25, 0x3c);
  f.p.worldState.hosters[f.npcId] = f.first;
  f.p.Messages().clear();
  REQUIRE_FALSE(f.Validate(4097, 1));
  REQUIRE(f.Teleports().size() == 1);
  REQUIRE(f.Teleports()[0].j["idx"] == f.Npc().GetIdx());
  f.p.Messages().clear();
  REQUIRE_FALSE(MovementValidation::Validate(f.p, old->GetPos(), old->GetAngle(), old->GetCellOrWorld(),
    {4097,0,0}, old->GetCellOrWorld(), 0, old.get(), f.p.worldState.pluginIndexMapping, &f.corrections));
  REQUIRE(f.Teleports().empty());
}

TEST_CASE("ActionListener rejects without advancing anchor or accepted timestamp and recovers", "[NpcMovementCorrection]")
{
  MovementFixture f;
  ProbeGuard guard;
  f.Movement(0);
  const auto idx = f.Npc().GetIdx();
  const auto accepted = f.p.worldState.lastMovUpdateByIdx[idx];
  f.p.Messages().clear(); f.Movement(4096); f.Movement(4097);
  REQUIRE(f.Npc().GetPos() == NiPoint3{0,0,0});
  REQUIRE(f.p.worldState.lastMovUpdateByIdx[idx] == accepted);
  REQUIRE(f.Teleports().size() == 1);
  auto counters = guard.probe->Read()["counters"];
  REQUIRE(counters["npcMovementRejections"]["DISTANCE"] == 2);
  REQUIRE(counters["npcCorrectionsSent"] == 1);
  REQUIRE(counters["npcCorrectionsSuppressed"] == 1);
  auto state = aetherius::combat::CombatProbe::StateJson(guard.probe->CaptureState(&f.Npc(), f.p.worldState));
  REQUIRE(state["lastNpcCorrection"]["idx"] == idx);
  REQUIRE(state["lastNpcCorrection"]["hoster"] == f.first);
  REQUIRE(state["lastNpcCorrection"]["reason"] == "DISTANCE");
  f.p.Messages().clear(); f.Movement(1);
  REQUIRE(f.Npc().GetPos() == NiPoint3{1,0,0});
  REQUIRE(f.Teleports().empty());
  f.Movement(4098);
  REQUIRE(f.Teleports().size() == 1);
  f.p.Messages().clear(); f.Movement(1, 0, 0xabc);
  REQUIRE(f.Npc().GetCellOrWorld() == FormDesc::Tamriel());
  REQUIRE(guard.probe->Read()["counters"]["npcMovementRejections"]["WORLD_OR_CELL"] == 1);
  f.Npc().SetTeleportFlag(true); f.Movement(1);
  REQUIRE(guard.probe->Read()["counters"]["npcMovementRejections"]["TELEPORT_FLAG"] == 1);
}

TEST_CASE("Own player retains unindexed Teleport2 correction", "[NpcMovementCorrection]")
{
  MovementFixture f;
  auto& player = f.p.worldState.GetFormAt<MpActor>(f.first);
  REQUIRE_FALSE(MovementValidation::Validate(f.p, player.GetPos(), player.GetAngle(), player.GetCellOrWorld(),
    {4096,0,0}, player.GetCellOrWorld(), 0, &player, f.p.worldState.pluginIndexMapping, &f.corrections));
  REQUIRE(f.Teleports().size() == 1);
  REQUIRE(f.Teleports()[0].j["t"] == static_cast<int>(MsgType::Teleport2));
  REQUIRE_FALSE(f.Teleports()[0].j.contains("idx"));
}
