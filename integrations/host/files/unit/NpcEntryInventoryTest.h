#pragma once
// DS-0k-fix1: no sockets. Real binary plugins, Loader, PartOne and wire JSON.
// Fixture serialization helpers/layouts are shared with the DS-0k regression.
#include "NpcEquipmentTest.h"
#include "CreateActorMessage.h"

inline void RunNpcEntryInventoryTests(const std::filesystem::path& manifestPath)
{
  using namespace ds0k;
  std::cout << std::unitbuf;
  size_t checks = 0;
  auto check = [&](bool ok, const char* why) {
    ++checks;
    if (!ok) throw std::runtime_error(std::string("entry inventory: ") + why);
  };
  for (bool shifted : {false, true}) for (bool nested : {false, true})
    for (bool overrideProvider : {false, true}) {
      Files files(nested, true);
      // Winning provider override has a DIFFERENT master table: Skyrim,
      // Filler, Provider. It points both to a Provider item and its own item.
      const auto target = Local(2, nested ? 0x810 : 0x801);
      if (overrideProvider) {
        auto winner = Npc(Local(2, 0x800), target, Local(2, 0x804), Local(2, 0x805));
        // Add a second CNTO to the same record, rather than a second NPC.
        auto fields = winner.substr(24) + Field("CNTO", Bin(Local(3, 0x820)) + Bin(uint32_t{1}));
        winner = Record("NPC_", Local(2, 0x800), fields) + Weapon(Local(3, 0x820), 50);
        files.Save("Winner.esp", Header({"Skyrim.esm", "Filler.esp", "Provider.esp"}) + winner);
      }
      std::vector<std::filesystem::path> paths{manifestPath.parent_path() / "Skyrim.esm"};
      if (shifted) paths.push_back(files.dir / "Filler.esp");
      paths.push_back(files.dir / "Provider.esp");
      paths.push_back(files.dir / "Root.esp");
      if (!shifted) paths.push_back(files.dir / "Filler.esp");
      if (overrideProvider) paths.push_back(files.dir / "Winner.esp");
      espm::Loader loader(paths);
      PartOne host;
      host.AttachEspm(&loader);
      auto resolve = [&](const char* key) {
        return FormDesc::FromString(key).ToFormId(host.worldState.pluginIndexMapping);
      };
      const auto root = resolve("800:Root.esp");
      const auto provider = loader.GetBrowser().LookupById(resolve("800:Provider.esp"));
      check(loader.GetBrowser().GetSourceMetadata(provider.sourceId)->fileName ==
        (overrideProvider ? "Winner.esp" : "Provider.esp"), "provider is not load-order winner");
      const auto playerId = host.worldState.GenerateFormId();
      const auto npcId = host.worldState.GenerateFormId();
      host.CreateActor(playerId, {0,0,0}, 0, resolve("3c:Skyrim.esm"));
      host.worldState.AddForm(std::make_unique<MpActor>(
        LocationalData{{0,0,0},{0,0,0},FormDesc::Tamriel()}, host.CreateFormCallbacks(), root), npcId);
      auto& player = host.worldState.GetFormAt<MpActor>(playerId);
      auto& npc = host.worldState.GetFormAt<MpActor>(npcId);
      host.serverState.Connect(0, "DS-0k-fix1-entry");
      host.SetUserActor(0, playerId);
      host.Messages().clear();
      host.worldState.hosters[npcId] = playerId;
      MpObjectReference::Subscribe(&npc, &player);
      const char* bestKey = overrideProvider ? "820:Winner.esp" : "801:Provider.esp";
      auto verify = [&](const Inventory& inventory, const char* channel) {
        for (const auto& entry : inventory.entries) {
          const auto record = loader.GetBrowser().LookupById(entry.baseId);
          check(record.rec != nullptr, "unresolvable item published");
          const auto key = FormDesc::FromFormId(entry.baseId, host.worldState.pluginIndexMapping).ToString();
          check(key == "801:Provider.esp" || key == "820:Winner.esp" || key == "12e46:Skyrim.esm",
            "published item has wrong StableFormKey");
          check(resolve(key.c_str()) == entry.baseId, "stable identity roundtrip changed item");
          check(record.ToGlobalId(record.rec->GetId()) == entry.baseId, "published id differs from winning record identity");
          std::cout << "WIRE shifted=" << shifted << " nested=" << nested
            << " override=" << overrideProvider << " channel=" << channel
            << " key=" << key << " runtime=" << entry.baseId
            << " winner=" << loader.GetBrowser().GetSourceMetadata(record.sourceId)->fileName << '\n';
        }
      };
      size_t creates = 0;
      for (const auto& msg : host.Messages()) {
        if (msg.j.value("t", -1) != static_cast<int>(MsgType::CreateActor) || msg.j.value("idx", 0u) != npc.GetIdx()) continue;
        ++creates;
        check(msg.reliable && msg.userId == 0, "CreateActor publication routing");
        const auto eq = Equipment::FromJson(msg.j.at("equipment"));
        verify(eq.inv, "CreateActor.equipment");
        check(eq.inv.HasItem(resolve(bestKey)), "CreateActor did not equip winning CNTO weapon");
      }
      check(creates == 1, "initial CreateActor missing or duplicated");
      CreateActorMessage properties;
      npc.VisitProperties(properties, VisitPropertiesMode::All);
      check(properties.props.inventory.has_value(), "CreateActor inventory properties missing");
      verify(*properties.props.inventory, "CreateActor.props.inventory");
      check(properties.props.inventory->HasItem(resolve("801:Provider.esp")), "host inventory lost provider weapon");
      npc.SetSpawnPoint(LocationalData{{0,0,0},{0,0,0},FormDesc::Tamriel()});
      auto eq = npc.GetEquipment(); eq.numChanges = 37; npc.SetEquipment(eq);
      npc.SetRespawnTime(0); npc.SetIsDead(true); host.Messages().clear();
      npc.RespawnWithDelay(false); host.Tick();
      size_t updates = 0;
      for (const auto& msg : host.Messages()) {
        if (msg.j.value("t", -1) != static_cast<int>(MsgType::UpdateEquipment)) continue;
        ++updates;
        check(msg.reliable && msg.j.at("idx") == npc.GetIdx(), "UpdateEquipment routing");
        const auto published = Equipment::FromJson(msg.j.at("data"));
        verify(published.inv, "UpdateEquipment");
        check(published.inv.HasItem(resolve(bestKey)) && published.numChanges == 38,
          "respawn winning weapon/counter lost");
      }
      check(updates == 1, "respawn equipment publication missing or duplicated");
      verify(npc.GetInventory(), "respawn.inventory");
    }
  std::cout << "PASS entry inventory " << checks
    << " checks; DS-0k invalid outgoing form hypothesis NOT REPRODUCED in eight fixture cases\n";
}

inline void AuditInstalledNpcContainerIds(const std::filesystem::path& manifestPath)
{
  std::cout << std::unitbuf;
  std::ifstream input(manifestPath); nlohmann::json manifest; input >> manifest;
  std::vector<std::filesystem::path> paths;
  for (const auto& row : manifest.at("plugins")) paths.push_back(manifestPath.parent_path() / row.at("filename").get<std::string>());
  espm::Loader loader(paths); PartOne host; host.AttachEspm(&loader);
  const auto& browser = loader.GetBrowser();
  // Browser's type enumeration does not index NPC_. Enumerate only NPC_
  // record identities from 24-byte on-disk headers; fields and winners are
  // still read exclusively through the real Loader/CombineBrowser.
  std::set<uint32_t> npcIds;
  for (const auto& path : paths) {
    const auto source = browser.FindSourceByFilename(path.filename().string().c_str());
    if (!source) throw std::runtime_error("audit plugin missing from Loader");
    std::ifstream file(path, std::ios::binary);
    std::array<char, 24> header;
    while (file.read(header.data(), header.size())) {
      if (!std::memcmp(header.data(), "GRUP", 4)) continue;
      uint32_t size = 0, rawId = 0;
      std::memcpy(&size, header.data() + 4, 4);
      std::memcpy(&rawId, header.data() + 12, 4);
      if (!std::memcmp(header.data(), "NPC_", 4)) npcIds.insert(browser.ResolveRecordFormId(*source, rawId));
      file.seekg(size, std::ios::cur);
    }
    if (!file.eof()) throw std::runtime_error("NPC header enumeration failed");
  }
  size_t npcs = 0, cnto = 0, changed = 0, missing = 0, errors = 0, mismatched = 0;
  for (const auto id : npcIds) {
    const auto winner = browser.LookupById(id);
    const auto key = FormDesc::FromFormId(id, host.worldState.pluginIndexMapping).ToString();
    ++npcs;
    try {
      const auto raw = espm::Convert<espm::NPC_>(winner.rec)->GetData(host.worldState.GetEspmCache()).objects;
      // Call the production callback on non-inheriting providers; raw links
      // on inheriting providers are audited directly, without changing flags
      // or making any creature selection.
      const auto data = espm::Convert<espm::NPC_>(winner.rec)->GetData(host.worldState.GetEspmCache());
      const bool own = !data.baseTemplate || !(data.templateDataFlags & espm::NPC_::UseInventory);
      std::vector<espm::CONT::ContainerObject> actual;
      if (own) actual = GetInventoryObjects(&host.worldState, {FormDesc::FromString(key)}, winner);
      for (size_t i = 0; i < raw.size(); ++i) {
        ++cnto;
        const auto resolved = browser.ResolveReferencedFormId(winner.sourceId, raw[i].formId);
        if (resolved != raw[i].formId) ++changed;
        if (own && (actual.at(i).formId != resolved || actual.at(i).count != raw[i].count)) ++mismatched;
        const auto target = browser.LookupById(resolved);
        if (!target.rec) {
          ++missing;
          std::cout << "MISSING provider=" << key << " winner=" << browser.GetSourceMetadata(winner.sourceId)->fileName
            << " raw=" << raw[i].formId << " resolved=" << resolved << '\n';
        } else if (resolved != raw[i].formId) {
          std::cout << "RESOLVED provider=" << key << " winner=" << browser.GetSourceMetadata(winner.sourceId)->fileName
            << " item=" << FormDesc::FromFormId(resolved, host.worldState.pluginIndexMapping).ToString()
            << " type=" << target.rec->GetType().ToString() << '\n';
        }
      }
    } catch (const std::exception& e) {
      ++errors; std::cout << "AUDIT_ERROR provider=" << key << " reason=" << e.what() << '\n';
    }
  }
  std::cout << "AUDIT npcs=" << npcs << " cnto=" << cnto << " changedByDS0k=" << changed
    << " missing=" << missing << " errors=" << errors << " callbackMismatches=" << mismatched << '\n';
  if (missing || errors || mismatched) throw std::runtime_error("installed CNTO audit has unresolved findings; inspect log");
  std::cout << "PASS installed CNTO audit; no invalid target reproduced\n";
}

inline void AuditNpcEntryArea(const std::filesystem::path& manifestPath)
{
  std::cout << std::unitbuf;
  std::ifstream input(manifestPath); nlohmann::json manifest; input >> manifest;
  std::vector<std::filesystem::path> paths;
  for (const auto& row : manifest.at("plugins")) paths.push_back(manifestPath.parent_path() / row.at("filename").get<std::string>());
  espm::Loader loader(paths); PartOne host; host.AttachEspm(&loader);
  auto resolve = [&](const char* key) { return FormDesc::FromString(key).ToFormId(host.worldState.pluginIndexMapping); };
  const auto world = resolve("3c:Skyrim.esm");
  const auto playerId = host.worldState.GenerateFormId();
  host.CreateActor(playerId, {0,0,0}, 0, world);
  auto& player = host.worldState.GetFormAt<MpActor>(playerId);
  host.serverState.Connect(0, "DS-0k-fix1-area"); host.SetUserActor(0, playerId);
  const auto& browser = loader.GetBrowser();
  std::set<uint32_t> placedIds;
  // A/B evidence position (-66464,93704): five by five exterior cells around
  // floor(position/4096). Test coordinates only; no runtime setting changed.
  for (int x=-19; x<=-15; ++x) for (int y=20; y<=24; ++y) {
    const auto sources = browser.GetRecordsAtPos(world, x, y);
    for (size_t source=0; source<sources.size(); ++source) for (const auto rec : *sources[source])
      if (rec->GetType() == espm::ACHR::kType) placedIds.insert(browser.ResolveRecordFormId(static_cast<espm::SourceId>(source), rec->GetId()));
  }
  size_t actors=0, creates=0, entries=0;
  auto verify = [&](const Inventory& inventory, const std::string& placed, const char* channel) {
    for (const auto& entry : inventory.entries) {
      const auto record = browser.LookupById(entry.baseId);
      if (!record.rec || !espm::utils::IsItem(record.rec->GetType()))
        throw std::runtime_error("area invalid inventory target: placed=" + placed + " channel=" + channel + " id=" + std::to_string(entry.baseId));
      const auto key = FormDesc::FromFormId(entry.baseId, host.worldState.pluginIndexMapping).ToString();
      if (resolve(key.c_str()) != entry.baseId || record.ToGlobalId(record.rec->GetId()) != entry.baseId)
        throw std::runtime_error("area outgoing id differs from winning StableFormKey");
      ++entries;
      std::cout << "AREA placed=" << placed << " channel=" << channel << " item=" << key
        << " winner=" << browser.GetSourceMetadata(record.sourceId)->fileName << " count=" << entry.count << '\n';
    }
  };
  for (const auto id : placedIds) {
    const auto placed = browser.LookupById(id);
    if (!placed.rec || placed.rec->GetType() != espm::ACHR::kType) throw std::runtime_error("area winning ACHR missing");
    const auto data = espm::Convert<espm::ACHR>(placed.rec)->GetData(host.worldState.GetEspmCache());
    const auto baseId = placed.ToGlobalId(data.baseId);
    const auto key = FormDesc::FromFormId(id, host.worldState.pluginIndexMapping).ToString();
    // Initialize the same base through real MpActor::Init, isolated at origin
    // so WorldState does not recursively load unrelated exterior chunks. The
    // unchanged native template evaluator handles any LVLN in this test.
    const auto npcId = host.worldState.GenerateFormId();
    host.worldState.AddForm(std::make_unique<MpActor>(LocationalData{{0,0,0},{0,0,0},FormDesc::Tamriel()}, host.CreateFormCallbacks(), baseId), npcId);
    auto& npc = host.worldState.GetFormAt<MpActor>(npcId);
    host.Messages().clear(); MpObjectReference::Subscribe(&npc, &player);
    size_t actorCreates=0;
    for (const auto& msg : host.Messages()) {
      if (msg.j.value("t", -1) != static_cast<int>(MsgType::CreateActor) || msg.j.value("idx", 0u) != npc.GetIdx()) continue;
      ++actorCreates; ++creates;
      verify(Equipment::FromJson(msg.j.at("equipment")).inv, key, "CreateActor.equipment");
    }
    if (actorCreates != 1) throw std::runtime_error("area CreateActor missing/duplicate");
    CreateActorMessage props; npc.VisitProperties(props, VisitPropertiesMode::All);
    if (props.props.inventory) verify(*props.props.inventory, key, "CreateActor.props.inventory");
    ++actors;
  }
  std::cout << "AREA actors=" << actors << " creates=" << creates << " checkedEntries=" << entries << '\n';
  if (!actors) throw std::runtime_error("no installed ACHR covered near A/B position");
  std::cout << "PASS installed entry area; no invalid outgoing form reproduced (one native template roll per base)\n";
}
