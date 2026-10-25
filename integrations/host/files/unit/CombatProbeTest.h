#pragma once
// AETHERIUS DS-0b: development combat probe acceptance. Real PartOne/WorldState/
// ActionListener with the installed load order; no listening socket.
#include "aetherius_combat/CombatProbe.h"
#include "ActionListener.h"
#include "ChangeValuesMessage.h"
#include "FormDesc.h"
#include "HitMessage.h"
#include "UpdateAnimationMessage.h"
#include "MessageSerializerFactory.h"
#include "UpdateEquipmentMessage.h"
#include "UpdateMovementMessage.h"
#include "PartOneListener.h"
#include "PluginIndexMapping.h"
#include <fstream>
#include <iostream>
#include <tuple>

inline void RunCombatProbeTests(const std::filesystem::path& manifestPath)
{
  using aetherius::combat::CombatProbe;
  std::cout << std::unitbuf;
  int count = 0;
  auto check = [&](bool ok, const char* why) {
    ++count;
    if (!ok) throw std::runtime_error(why);
  };

  // DS-0g: bounded reports and cadence copy exact attempts, no timing sleeps.
  {
    auto p=std::make_shared<CombatProbe>();
    const auto base=FormDesc::FromString("23abe:Skyrim.esm");
    for(size_t i=0;i<260;++i)p->RecordNpcReport(1,base,2,1,i%2?"ACCEPTED":"NOT_CURRENT_HOSTER",1000+i);
    const auto json=p->Read();
    check(json["npcReports"].size()==256 && json["counters"]["overwrittenNpcReports"]==4,"NPC report ring overflow");
    check(json["counters"]["npcReportReasons"]["ACCEPTED"]==130,"NPC report reasons count");
    check(json["npcReports"][0]["base"]==base.ToString(),"NPC report stable base");
    const auto start=std::chrono::steady_clock::time_point(std::chrono::seconds(100));
    p->RecordAttackAttempt(1,0.7f,true,0,false,start);
    auto first=CombatProbe::CadenceJson(p->LatestCadence(1));
    check(first["sincePreviousAttemptMs"].is_null() && first["sincePreviousAcceptedMs"].is_null(),"first attack invented an interval");
    p->RecordAttackAttempt(1,0.7f,true,500,true,start+std::chrono::milliseconds(250));
    const auto next=CombatProbe::CadenceJson(p->LatestCadence(1));
    check(std::abs(next["sincePreviousAttemptMs"].get<float>()-250)<0.01,"previous attempt cadence");
    check(std::abs(next["limitMs"].get<float>()-864.2857f)<0.01,"slow weapon CanHit measurement");
    p->RecordAttackAttempt(2,1.f,true,1000,true,start);
    check(CombatProbe::CadenceJson(p->LatestCadence(2))["sincePreviousAttemptMs"].is_null(),"cadence mixed aggressors");
    check(std::abs(CombatProbe::CadenceJson(p->LatestCadence(2))["limitMs"].get<float>()-770.f)<0.01,"fast weapon CanHit measurement");
    p->RecordAttackAttempt(2,0,false,1000,true,start);
    check(CombatProbe::CadenceJson(p->LatestCadence(2))["weaponSpeed"].is_null(),"unavailable weapon speed invented");
  }

  // ---- 1. Pure buffers: overflow, order, non-destructive read ----------------
  {
    auto probe = std::make_shared<CombatProbe>(1000);
    CombatProbe::HitInput input;
    input.aggressor = 1; input.target = 2; input.source = 0x1f4;
    const size_t extra = 5;
    for (size_t i = 0; i < CombatProbe::kHitCapacity + extra; ++i) {
      input.damage = static_cast<float>(i);
      probe->RecordHit(input, 2000 + i);
    }
    const auto& hits = probe->Hits();
    check(hits.size == CombatProbe::kHitCapacity, "hit ring grew beyond capacity");
    check(hits.total == CombatProbe::kHitCapacity + extra, "hit total counter");
    check(hits.Overwritten() == extra, "hit overwrite counter");
    check(hits.At(0).sequence == extra + 1, "oldest retained hit sequence");
    check(hits.At(hits.size - 1).sequence == hits.total, "newest hit sequence");
    bool ascending = true;
    for (size_t i = 1; i < hits.size; ++i)
      ascending = ascending && hits.At(i).sequence == hits.At(i - 1).sequence + 1;
    check(ascending, "hit ring order");
    const auto first = probe->Read();
    const auto second = probe->Read();
    check(first == second, "read is not idempotent / emptied buffers");
    check(first["counters"]["overwrittenHits"] == extra, "json overwrite counter");
    check(first["hits"].size() == CombatProbe::kHitCapacity, "json hit rows");
    check(first["hits"][0]["sequence"] == extra + 1 &&
            first["hits"].back()["sequence"] == hits.total,
          "json hit order");
    check(first["hits"][0]["damage"] == static_cast<float>(extra), "json oldest hit payload");
    check(first["startedAtMs"] == 1000, "startedAtMs");

    for (size_t i = 0; i < CombatProbe::kHealthCapacity + 3; ++i)
      probe->RecordHealth(7, 1.f, 0.5f, 0.5f, 3000 + i);
    check(probe->Health().size == CombatProbe::kHealthCapacity &&
            probe->Health().Overwritten() == 3 &&
            probe->Health().At(0).sequence == 4,
          "health ring overflow/order");

    // Animations: ring, name table limited to 256, overflow counted.
    for (size_t i = 0; i < CombatProbe::kNameCapacity + 44; ++i)
      probe->RecordAnimation(9, "anim" + std::to_string(i), 4000 + i);
    for (int i = 0; i < 3; ++i) probe->RecordAnimation(9, "anim0", 5000 + i);
    check(probe->DistinctNames() == CombatProbe::kNameCapacity, "name table not limited");
    check(probe->NameOverflow() == 44, "name overflow count");
    const auto names = probe->Read()["animationNames"];
    check(names.size() == CombatProbe::kNameCapacity && names[0]["name"] == "anim0" &&
            names[0]["count"] == 4,
          "distinct-name counter");
    for (size_t i = 0; i < CombatProbe::kAnimationCapacity; ++i)
      probe->RecordAnimation(10, "attackStart", 6000);
    check(probe->Animations().size == CombatProbe::kAnimationCapacity &&
            probe->Animations().Overwritten() ==
              CombatProbe::kNameCapacity + 44 + 3,
          "animation ring overflow");
    const std::string longName(100, 'x');
    probe->RecordAnimation(10, longName, 6001);
    const auto truncated = probe->Read();
    check(truncated["counters"]["truncatedNames"] == 1 &&
            truncated["animations"].back()["name"].get<std::string>().size() ==
              CombatProbe::kNameBytes - 1,
          "long name truncation");
    probe->RecordAnimation(10, std::string("bad\xff\xfe", 5), 6002);
    bool dumped = true;
    try { (void)probe->ReadString(); } catch (...) { dumped = false; }
    check(dumped, "invalid UTF-8 animation name broke the read");

    // Last two animation events of the aggressor, with age at hit time.
    auto fresh = std::make_shared<CombatProbe>();
    fresh->RecordAnimation(11, "attackStart", 10000);
    fresh->RecordAnimation(12, "blockStart", 10050);
    fresh->RecordAnimation(11, "attackPowerStartInPlace", 10100);
    CombatProbe::HitInput power;
    power.aggressor = 11; power.target = 12; power.power = true;
    fresh->RecordHit(power, 10350);
    power.aggressor = 99;
    fresh->RecordHit(power, 10351);
    const auto recent = fresh->Read()["hits"];
    check(recent[0]["aggressorAnimations"].size() == 2 &&
            recent[0]["aggressorAnimations"][0]["name"] == "attackPowerStartInPlace" &&
            recent[0]["aggressorAnimations"][0]["ageMs"] == 250 &&
            recent[0]["aggressorAnimations"][1]["name"] == "attackStart" &&
            recent[0]["aggressorAnimations"][1]["ageMs"] == 350,
          "aggressor recent animations");
    check(recent[1]["aggressorAnimations"].empty(), "unknown aggressor must have no animations");

    // Actor table is fixed: more actors than slots evict, never grow.
    auto actors = std::make_shared<CombatProbe>();
    for (uint32_t a = 1; a <= CombatProbe::kActorSlots + 2; ++a)
      actors->RecordAnimation(a, "attackStart", a);
    check(actors->ActorEvictions() == 2, "actor table eviction count");

    // Equipment transitions: fixed ring, order, per-transition entry limit.
    auto equipment = std::make_shared<CombatProbe>();
    Equipment big;
    for (uint32_t i = 0; i < CombatProbe::kEquipmentItems + 1; ++i) {
      Inventory::Entry e(0x100 + i, 1);
      e.SetWorn(Inventory::Worn::Right);
      big.inv.entries.push_back(e);
    }
    big.inv.entries[0].enchantmentId = 0x77;
    for (size_t i = 0; i < CombatProbe::kEquipmentCapacity + 3; ++i) {
      big.numChanges = static_cast<uint32_t>(i);
      equipment->RecordEquipment(5, big, 7000 + i);
    }
    const auto& changes = equipment->EquipmentChanges();
    check(changes.size == CombatProbe::kEquipmentCapacity && changes.Overwritten() == 3 &&
            changes.At(0).sequence == 4 && changes.At(changes.size - 1).sequence == changes.total,
          "equipment ring overflow/order");
    const auto eqJson = equipment->Read();
    check(eqJson["counters"]["truncatedEquipmentEntries"] == CombatProbe::kEquipmentCapacity + 3 &&
            eqJson["equipment"][0]["items"].size() == CombatProbe::kEquipmentItems &&
            eqJson["equipment"][0]["totalEntries"] == CombatProbe::kEquipmentItems + 1 &&
            eqJson["equipment"][0]["items"][0]["enchantmentId"] == 0x77 &&
            eqJson["equipment"][0]["items"][1]["enchantmentId"].is_null() &&
            eqJson["counters"]["overwrittenEquipment"] == 3,
          "equipment entries truncation counted / json");
    CombatProbe::ActorState state; state.present = true; state.actor = 1;
    state.position = { 0, 0, 0 }; state.cellOrWorld.Assign(FormDesc::FromString("3c:Skyrim.esm"));
    auto distantState = state; distantState.actor = 2; distantState.position = { 5000, 0, 0 };
    for (size_t i = 0; i < CombatProbe::kRejectionCapacity + 3; ++i)
      equipment->RecordRejection("TOO_DISTANT", 1, 2, 3, 0, state, distantState, 8000 + i);
    const auto refused = equipment->Read();
    check(refused["rejections"].size() == CombatProbe::kRejectionCapacity &&
      refused["counters"]["overwrittenRejections"] == 3 && refused["rejections"][0]["sequence"] == 4,
      "rejection ring overflow/order");
    check(refused["rejections"][0]["distance"] == 5000 &&
      refused["rejections"][0]["targetState"]["cellOrWorld"] == "3c:Skyrim.esm",
      "rejection distance / portable cell");
    std::cout << "Fixed probe bytes=" << sizeof(CombatProbe)
              << " hits=" << CombatProbe::kHitCapacity
              << " animations=" << CombatProbe::kAnimationCapacity
              << " health=" << CombatProbe::kHealthCapacity
              << " names=" << CombatProbe::kNameCapacity << '\n';
  }

  // ---- 1b. ResolveEnchantment with the ENCH/MGEF plugin in two positions -----
  // Same StableFormKeys, two valid arrangements of the vanilla masters (the DLC
  // masters depend only on Skyrim.esm/Update.esm). Dragonborn.esm moves from
  // index 4 to index 2, so both the ENCH and its MGEF get other runtime IDs.
  {
    const auto dataDir = manifestPath.parent_path();
    const std::vector<std::vector<std::string>> arrangements = {
      { "Skyrim.esm", "Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm" },
      { "Skyrim.esm", "Update.esm", "Dragonborn.esm", "Dawnguard.esm", "HearthFires.esm" }
    };
    std::vector<nlohmann::json> stable;
    std::vector<uint32_t> runtimeEnch, runtimeMgef;
    for (const auto& names : arrangements) {
      std::vector<std::filesystem::path> files;
      for (const auto& name : names) files.push_back(dataDir / name);
      espm::Loader arranged(files);
      PluginIndexMapping mapping;
      mapping.Build(arranged.GetFileNames(), &arranged);
      const uint32_t spell = FormDesc::FromString("1e2a6:Dragonborn.esm").ToFormId(mapping);
      check(CombatProbe::ResolveRecordType(arranged.GetBrowser(), spell)["type"] == "SPEL",
            "reordered spell type unresolved");
      const uint32_t ench = FormDesc::FromString("1e288:Dragonborn.esm").ToFormId(mapping);
      check(CombatProbe::ResolveRecordType(arranged.GetBrowser(), ench)["type"] == "ENCH",
            "record type changes with plugin position");
      const auto result = CombatProbe::ResolveEnchantment(arranged.GetBrowser(),
                                                          arranged.GetBrowser().GetCache(), ench);
      check(result["status"] == "SUPPORTED" && result["effects"].size() == 1,
            "reordered ENCH 01E288:Dragonborn.esm not resolved");
      const auto& effect = result["effects"][0];
      const auto mgefKey = FormDesc::FromFormId(effect["mgef"].get<uint32_t>(), mapping).ToString();
      check(effect["mgef"].get<uint32_t>() ==
              FormDesc::FromString("1e289:Dragonborn.esm").ToFormId(mapping),
            "MGEF runtime id does not match its StableFormKey in this arrangement");
      stable.push_back({ { "mgef", mgefKey }, { "magnitude", effect["magnitude"] },
                         { "actorValue", effect["actorValue"] }, { "archetype", effect["archetype"] } });
      runtimeEnch.push_back(ench);
      runtimeMgef.push_back(effect["mgef"].get<uint32_t>());
      std::cout << "ARRANGEMENT [" << names[2] << ',' << names[3] << ',' << names[4]
                << "] ench=0x" << std::hex << ench << std::dec << " -> " << result.dump()
                << " stable=" << stable.back().dump() << '\n';
    }
    check(runtimeEnch[0] != runtimeEnch[1], "arrangements did not move the ENCH plugin");
    check(runtimeMgef[0] != runtimeMgef[1], "arrangements did not move the MGEF plugin");
    check(stable[0] == stable[1], "reordered resolution changed MGEF identity/magnitude/actor value");
    check(stable[0]["magnitude"] == 5.0, "winner magnitude of 01E288:Dragonborn.esm");
  }

  // ---- 2. Real host path: off has no effect, on records, game unchanged ------
  std::ifstream in(manifestPath);
  nlohmann::json manifest;
  in >> manifest;
  std::vector<std::filesystem::path> paths;
  for (const auto& row : manifest.at("plugins"))
    paths.push_back(manifestPath.parent_path() / row.at("filename").get<std::string>());
  espm::Loader loader(paths);
  PartOne host;
  host.AttachEspm(&loader);
  auto resolve = [&](const char* key) {
    return FormDesc::FromString(key).ToFormId(host.worldState.pluginIndexMapping);
  };
  struct KnownDamage final : IDamageFormula
  {
    float CalculateDamage(const MpActor&, const MpActor&, const HitData&) const override { return 30.f; }
    float CalculateDamage(const MpActor&, const MpActor&, const SpellCastData&) const override { return 30.f; }
  };
  host.SetDamageFormula(std::make_unique<KnownDamage>());
  const auto cell = resolve("3c:Skyrim.esm");
  const auto attackerId = host.CreateActor(0, { 0, 0, 0 }, 0, cell);
  const auto targetId = host.CreateActor(0, { 0, 0, 0 }, 0, cell);
  auto& attacker = host.worldState.GetFormAt<MpActor>(attackerId);
  auto& target = host.worldState.GetFormAt<MpActor>(targetId);
  host.serverState.Connect(0, "DS-0b-attacker");
  host.SetUserActor(0, attackerId);
  host.serverState.Connect(1, "DS-0b-target");
  host.SetUserActor(1, targetId);
  const auto unarmed = resolve("1f4:Skyrim.esm");
  // NPC hosted by the attacker's client (same construction as DevAttributesTest).
  const auto npcId = host.worldState.GenerateFormId();
  host.worldState.AddForm(std::make_unique<MpActor>(
    LocationalData{ { 0, 0, 0 }, { 0, 0, 0 },
                    FormDesc::FromFormId(cell, host.worldState.pluginIndexMapping) },
    host.CreateFormCallbacks(), resolve("422b4:Skyrim.esm")), npcId);
  auto& npc = host.worldState.GetFormAt<MpActor>(npcId);
  host.worldState.hosters[npcId] = attackerId;

  // Read-only enchantment resolution against the installed winners.
  {
    using R = CombatProbe;
    auto& browser = loader.GetBrowser();
    auto& cache = host.worldState.GetEspmCache();
    const auto fire = R::ResolveEnchantment(browser, cache, resolve("45c35:Skyrim.esm"));
    check(fire["status"] == "SUPPORTED" && !fire["effects"].empty() &&
            fire["effects"][0]["mgef"] == resolve("4605a:Skyrim.esm"),
          "static ENCH 045C35:Skyrim.esm not resolved with its MGEF");
    check(R::ResolveEnchantment(browser, cache, resolve("1397e:Skyrim.esm"))["reason"] == "NOT_AN_ENCH_RECORD",
          "non-ENCH accepted as enchantment");
    check(R::ResolveEnchantment(browser, cache, 0xFF000123)["reason"] == "CREATED_RECORD_NOT_IN_LOAD_ORDER",
          "created enchantment not declared unsupported");
    check(R::ResolveEnchantment(browser, cache, 0)["status"] == "UNSUPPORTED", "zero id");
    std::cout << "ENCH 045C35:Skyrim.esm -> " << fire.dump() << '\n';
  }

  // One scripted exchange: animation, accepted hit, client health report.
  auto scenario = [&]() {
    auto full = target.GetActorValues();
    full.healthPercentage = 1.f; full.magickaPercentage = 1.f; full.staminaPercentage = 1.f;
    if (target.IsDead()) target.SetIsDead(false);
    target.SetPercentages(full);
    attacker.SetLastHitTime(targetId, std::chrono::steady_clock::now() - std::chrono::seconds(10));
    RawMessageData attackerRaw; attackerRaw.userId = 0;
    // The host forwards the raw packet; serialize it as the network would.
    auto sendAnimation = [&](uint32_t idx, const char* name) {
      UpdateAnimationMessage anim; anim.idx = idx; anim.data.animEventName = name;
      SLNet::BitStream packet; PartOne::GetMessageSerializerInstance().Serialize(anim, packet);
      RawMessageData raw = attackerRaw;
      raw.unparsed = packet.GetData(); raw.unparsedLength = packet.GetNumberOfBytesUsed();
      host.GetActionListener().OnUpdateAnimation(raw, anim);
    };
    // Hosted NPC animation first, then the player's own attack animation.
    // AnimationSystem is not initialized here (no SweetPie callbacks): the probe
    // must record names independently of any callback.
    sendAnimation(npc.GetIdx(), "attackStart");
    sendAnimation(attacker.GetIdx(), "attackPowerStartInPlace");
    HitMessage hit; hit.data.aggressor = 0x14; hit.data.target = targetId;
    hit.data.source = unarmed; hit.data.isPowerAttack = true;
    host.GetActionListener().OnHit(attackerRaw, hit);
    const float afterHit = target.GetActorValues().healthPercentage;
    RawMessageData targetRaw; targetRaw.userId = 1;
    ChangeValuesMessage values; values.data.health = afterHit - 0.2f;
    host.GetActionListener().OnChangeValues(targetRaw, values);
    const float afterReport = target.GetActorValues().healthPercentage;
    return std::make_tuple(afterHit, afterReport, attacker.IsBlockActive(),
                           target.IsBlockActive(), attacker.GetLastAnimEvent().has_value());
  };

  aetherius::combat::InstallCombatProbe(nullptr);
  check(aetherius::combat::ActiveCombatProbe() == nullptr, "probe active without installation");
  const auto off = scenario();
  check(std::get<0>(off) < 1.f, "baseline hit did not apply damage");
  check(std::get<1>(off) < std::get<0>(off), "baseline client drop not accepted");

  auto probe = std::make_shared<CombatProbe>(aetherius::combat::CombatProbeNowMs());
  aetherius::combat::InstallCombatProbe(probe);
  const auto on = scenario();
  check(on == off, "probe ON changed game state");
  const auto snapshot = probe->Read();
  check(snapshot["hits"].size() == 1, "accepted hit not recorded");
  const auto& h = snapshot["hits"][0];
  check(h["aggressor"] == attackerId && h["target"] == targetId && h["source"] == unarmed,
        "hit identity");
  check(h["family"] == "UNARMED" && h["power"] == true && h["clientBlocked"] == false,
        "hit family/flags");
  check(std::abs(h["damage"].get<float>() - 30.f) < 1e-4f, "hit damage from current chain");
  check(std::abs(h["healthBefore"].get<float>() - 1.f) < 1e-4f &&
          std::abs(h["healthAfter"].get<float>() - std::get<0>(on)) < 1e-4f,
        "hit health before/after");
  check(h["aggressorAnimations"].size() == 1 &&
          h["aggressorAnimations"][0]["name"] == "attackPowerStartInPlace" &&
          h["aggressorAnimations"][0]["ageMs"].get<int64_t>() >= 0,
        "hit carries aggressor animation");
  check(std::abs(h["healthCandidate"].get<float>() - std::get<0>(on)) < 1e-4f,
        "candidate health percentage");
  check(h["detection"] == "UNAVAILABLE", "detection must be declared unavailable");
  check(snapshot["animations"].size() == 2 && snapshot["animations"][0]["actor"] == npcId &&
          snapshot["animations"][0]["name"] == "attackStart" &&
          snapshot["animations"][1]["actor"] == attackerId,
        "accepted animations (hosted NPC and player) not recorded");
  check(snapshot["health"].size() == 1 && snapshot["health"][0]["actor"] == targetId &&
          std::abs(snapshot["health"][0]["after"].get<float>() - std::get<1>(on)) < 1e-4f,
        "accepted client health change not recorded");
  std::cout << "Probe ON snapshot: " << probe->ReadString() << '\n';

  // Equipment A -> B -> A between two reads, through the real OnUpdateEquipment.
  const auto dagger = resolve("1397e:Skyrim.esm");
  const auto enchA = resolve("45c35:Skyrim.esm"), enchB = resolve("45c30:Skyrim.esm");
  auto sendEquipment = [&](uint32_t enchantment, uint32_t numChanges) {
    Equipment eq; Inventory::Entry e(dagger, 1); e.SetWorn(Inventory::Worn::Right);
    e.enchantmentId = enchantment; eq.inv.entries.push_back(e); eq.numChanges = numChanges;
    UpdateEquipmentMessage update; update.idx = attacker.GetIdx(); update.data = eq;
    SLNet::BitStream packet; PartOne::GetMessageSerializerInstance().Serialize(update, packet);
    RawMessageData raw; raw.userId = 0;
    raw.unparsed = packet.GetData(); raw.unparsedLength = packet.GetNumberOfBytesUsed();
    host.GetActionListener().OnUpdateEquipment(raw, update);
    return attacker.GetEquipment().inv.entries.empty() ? 0u
      : attacker.GetEquipment().inv.entries[0].enchantmentId.value_or(0);
  };
  {
    Inventory owned; owned.AddItem(dagger, 1); attacker.SetInventory(owned);
    const auto before = probe->EquipmentChanges().total;
    (void)probe->Read(); // first read
    check(sendEquipment(enchA, 1) == enchA && sendEquipment(enchB, 2) == enchB &&
            sendEquipment(enchA, 3) == enchA,
          "host did not accept the equipment transitions");
    const auto rows = probe->Read()["equipment"]; // second read
    check(probe->EquipmentChanges().total == before + 3 && rows.size() >= 3,
          "A->B->A transitions not all recorded");
    const auto n = rows.size();
    check(rows[n - 3]["items"][0]["enchantmentId"] == enchA &&
            rows[n - 2]["items"][0]["enchantmentId"] == enchB &&
            rows[n - 1]["items"][0]["enchantmentId"] == enchA &&
            rows[n - 2]["numChanges"] == 2 && rows[n - 2]["actor"] == attackerId,
          "intermediate equipment B lost");
    const auto resolvedB = CombatProbe::ResolveEnchantment(loader.GetBrowser(),
                                                           host.worldState.GetEspmCache(), enchB);
    check(resolvedB["status"] == "SUPPORTED", "enchantment of B not resolved");
    std::cout << "A->B->A equipment rows=" << n << " B=" << rows[n - 2].dump()
              << " B enchantment=" << resolvedB.dump() << '\n';
  }

  // DS-0d: rejected hits have a separate ring; accepted totals stay unchanged.
  {
    RawMessageData attackerRaw; attackerRaw.userId = 0;
    HitMessage hit; hit.data.aggressor = 0x14; hit.data.target = targetId; hit.data.source = unarmed;
    attacker.SetLastHitTime(targetId, std::chrono::steady_clock::now());
    const auto before = target.GetActorValues().healthPercentage;
    host.GetActionListener().OnHit(attackerRaw, hit);
    check(target.GetActorValues().healthPercentage == before, "cooldown fixture did not reject the hit");
    check(probe->Hits().total == 1, "rejected hit recorded as accepted");
    check(probe->Read()["rejections"].back()["reason"] == "SPLASH_TARGET_COOLDOWN", "cooldown reason");
  }

  // Real OnHit early exits and permissions; no sockets, no production double.
  {
    struct Veto final : PartOneListener {
      std::string blocked; std::vector<std::string> seen;
      void OnConnect(Networking::UserId) override {}
      void OnDisconnect(Networking::UserId) override {}
      void OnCustomPacket(Networking::UserId, const simdjson::dom::element&) override {}
      bool OnMpApiEvent(const GameModeEvent& e) override { seen.push_back(e.GetName()); return blocked != e.GetName(); }
    };
    auto veto = std::make_shared<Veto>(); host.AddListener(veto);
    RawMessageData raw; raw.userId = 0;
    HitMessage hit; hit.data.aggressor = 0x14; hit.data.target = targetId; hit.data.source = unarmed;
    auto reject = [&](const char* reason) {
      const auto countBefore = probe->Read()["counters"]["rejections"].get<uint64_t>();
      const auto healthBefore = target.GetActorValues().healthPercentage;
      host.GetActionListener().OnHit(raw, hit);
      const auto result = probe->Read();
      check(result["counters"]["rejections"] == countBefore + 1 && result["rejections"].back()["reason"] == reason, reason);
      check(target.GetActorValues().healthPercentage == healthBefore, "rejected hit changed health");
    };
    raw.userId = 123; reject("NO_USER_ACTOR"); raw.userId = 0;
    hit.data.aggressor = npcId; host.worldState.hosters.erase(npcId);
    reject("NO_HOST_PERMISSION"); host.worldState.hosters[npcId] = attackerId; hit.data.aggressor = 0x14;
    hit.data.target = host.worldState.GenerateFormId(); reject("TARGET_NOT_FOUND"); hit.data.target = targetId;
    const auto originalCell = target.GetCellOrWorld();
    target.SetCellOrWorldObsolete(FormDesc(123, "")); reject("DIFFERENT_CELL"); target.SetCellOrWorldObsolete(originalCell);
    target.SetPos({ 5000, 0, 0 }); reject("TOO_DISTANT"); target.SetPos({ 0, 0, 0 });
    attacker.SetIsDead(true); reject("AGGRESSOR_DEAD"); attacker.SetIsDead(false);
    attacker.SetEquipment(Equipment{}); hit.data.source = dagger; reject("WEAPON_NOT_EQUIPPED"); hit.data.source = unarmed;
    veto->blocked = "onSkySocialHit"; veto->seen.clear(); reject("SKYSOCIAL_DENIED");
    check(std::find(veto->seen.begin(), veto->seen.end(), "onSkyDeathHit") == veto->seen.end(), "probe broke permission short circuit");
    veto->blocked = "onSkyDeathHit"; reject("SKYDEATH_DENIED"); veto->blocked.clear();
    target.SetPropertyValueDump("aetheriusInvulnerableUntil", "9999999999999", false, false);
    reject("TARGET_INVULNERABLE"); target.SetPropertyValueDump("aetheriusInvulnerableUntil", "null", false, false);
    attacker.SetLastHitTime(targetId, std::chrono::steady_clock::now() - std::chrono::milliseconds(200));
    reject("ATTACK_COOLDOWN");

    attacker.SetLastHitTime(targetId, std::chrono::steady_clock::now() - std::chrono::seconds(10));
    for (int i = 0; i < 4; ++i)
      attacker.SetLastHitTime(host.worldState.GenerateFormId(), std::chrono::steady_clock::now());
    reject("SPLASH_TARGET_LIMIT");
    const auto objectId = host.worldState.GenerateFormId();
    host.worldState.AddForm(std::make_unique<MpObjectReference>(
      LocationalData{{0,0,0},{0,0,0},originalCell}, host.CreateFormCallbacks(), dagger, "WEAP"), objectId);
    hit.data.target = objectId; reject("TARGET_NOT_ACTOR"); hit.data.target = targetId;
    Equipment spellEquipment; spellEquipment.rightSpell = resolve("1e2a6:Dragonborn.esm");
    attacker.SetEquipment(spellEquipment); hit.data.source = *spellEquipment.rightSpell;
    veto->blocked = "onSkySocialSpellHit"; reject("SKYSOCIAL_SPELL_DENIED");
    veto->blocked.clear(); hit.data.source = unarmed; attacker.SetEquipment(Equipment{});

    // A real accepted hosted-NPC movement, then a rejected jump / parent switch.
    UpdateMovementMessage movement; movement.idx = npc.GetIdx();
    movement.data.pos = { 10, 20, 30 }; movement.data.worldOrCell = cell;
    auto sendMovement = [&]() {
      SLNet::BitStream packet; PartOne::GetMessageSerializerInstance().Serialize(movement, packet);
      raw.unparsed = packet.GetData(); raw.unparsedLength = packet.GetNumberOfBytesUsed();
      host.GetActionListener().OnUpdateMovement(raw, movement);
    };
    sendMovement();
    auto position = probe->CaptureState(&npc, host.worldState);
    check(position.lastMovementMs > 0 && position.movementMatches && position.hoster == attackerId && position.position[0] == 10,
      "accepted hosted movement not captured");
    const auto acceptedTime = position.lastMovementMs;
    movement.data.pos = { 6000, 20, 30 }; sendMovement();
    position = probe->CaptureState(&npc, host.worldState);
    check(position.position[0] == 10 && position.lastMovementMs == acceptedTime &&
      position.lastAttemptPosition[0] == 6000 && !position.lastMovementAccepted && position.rejectedMovements == 1, "rejected movement refreshed position/time");
    movement.data.pos = { 10, 20, 30 }; movement.data.worldOrCell = FormDesc(123, "").ToFormId(host.worldState.pluginIndexMapping);
    sendMovement();
    check(probe->CaptureState(&npc, host.worldState).lastMovementMs == acceptedTime, "different parent movement refreshed time");
    const float maximum = npc.GetMaximumValues().health;
    const auto state = probe->CaptureState(&npc, host.worldState);
    check(state.maximumAvailable && state.maximumHealth == maximum && state.templateTotal == npc.GetTemplateChain().size(),
      "observed maximum / template chain");
    const double testNow = aetherius::combat::CombatProbeNowMs();
    const auto weaknessUntil = testNow + 100000;
    npc.SetPropertyValueDump("skyDeathAidWeakness", nlohmann::json{{"until", weaknessUntil}}.dump(), false, false);
    const float weakened = npc.GetMaximumValues().health;
    auto cached = probe->CaptureState(&npc, host.worldState, testNow);
    check(cached.maximumAvailable && cached.maximumCurrent && cached.maximumHealth == weakened,
      "current cached maximum differs from host calculation");
    cached = probe->CaptureState(&npc, host.worldState, weaknessUntil + 1);
    check(cached.maximumAvailable && cached.maximumHealth == weakened * 2,
      "weakness expiry left cached maximum stale");
    npc.SetPropertyValueDump("skyDeathAidWeakness", "null", false, false);
    check(!probe->CaptureState(&npc, host.worldState).maximumAvailable,
      "changed inputs reused stale maximum");
    (void)npc.GetMaximumValues();
    check(probe->CaptureState(&npc, host.worldState).maximumAvailable,
      "existing read did not refresh maximum cache");
    auto coldProbe = std::make_shared<CombatProbe>();
    check(!coldProbe->CaptureState(&npc, host.worldState).maximumAvailable,
      "cold maximum cache invented a value");
    npc.SetPropertyValueDump("skyDeathAidWeakness", nlohmann::json{{"until", 0}, {"padding", std::string(1200, 'x')}}.dump(), false, false);
    (void)npc.GetMaximumValues();
    check(!probe->CaptureState(&npc, host.worldState).maximumAvailable,
      "oversized maximum context not declared unavailable");
    npc.SetPropertyValueDump("skyDeathAidWeakness", "null", false, false);
    check(h["targetMaximumHealth"].get<float>() > 0, "accepted hit maximum denominator missing");
  }

  aetherius::combat::InstallCombatProbe(nullptr);
  const auto totals = std::make_tuple(probe->Hits().total, probe->Animations().total, probe->Health().total);
  const auto offAgain = scenario();
  check(offAgain == off, "probe OFF after uninstall changed game state");
  const auto equipmentTotal = probe->EquipmentChanges().total;
  check(sendEquipment(enchB, 4) == enchB, "equipment transition with probe off not accepted");
  check(probe->EquipmentChanges().total == equipmentTotal, "uninstalled probe recorded equipment");
  check(std::make_tuple(probe->Hits().total, probe->Animations().total, probe->Health().total) == totals,
        "uninstalled probe kept recording");
  std::cout << "OFF/ON/OFF afterHit=" << std::get<0>(off) << '/' << std::get<0>(on) << '/'
            << std::get<0>(offAgain) << " afterReport=" << std::get<1>(off) << '/'
            << std::get<1>(on) << '/' << std::get<1>(offAgain) << '\n';
  std::cout << "PASS DS-0b combat probe " << count << " native checks; no sockets\n";
}
