# Fases executáveis de implementação

> [!WARNING]
> **HISTÓRICO — substituído em 07/10/2026.** As fases F0–F12 abaixo não são mais o roteiro. Fonte atual: [docs/architecture/adr/D7-ordem-de-implementacao.md](../../architecture/adr/D7-ordem-de-implementacao.md). Este arquivo é mantido como evidência.

> [!IMPORTANT]
> Atualizado em 05/10/2026 para seguir a [arquitetura canônica](../../architecture/AETHERIUS_GAMEPLAY_CORE_ARCHITECTURE.md). Este arquivo continua sendo o detalhamento de execução; em caso de conflito arquitetural, prevalece o documento canônico.

Todos os caminhos de domínio permanecem relativos ao **AetheriusGameplayCore**. Server/Client podem ser alterados quando a fase exigir uma Host API pública, mínima, versionada e testada. A lógica de gameplay continua no GameplayCore e internals privados não podem virar contrato. Fases com blocker podem concluir artefatos offline/shadow, mas não ativar funcionalidade. Um port escrito não satisfaz acceptance até estar conectado a uma capacidade real comprovada.

## F0 — Congelar baseline, cobertura e expectativas

|Campo|Especificação|
|---|---|
|Objetivo|Produzir release manifest reconciliado e baseline de testes sem alterar regras de gameplay|
|Por que existe|MO2/ZIP/Server divergem; Class tem seis falhas; campos de63 records tiveram expansão limitada|
|Pré-requisitos|Artefatos desta auditoria; acesso ao deploy de homologação quando disponível|
|Dependências|Nenhuma fase anterior|
|Módulos afetados|Todos, somente tools/docs/tests de caracterização|
|Arquivos atuais envolvidos|`MIGRATION_MANIFEST.md`, `modules/class-system/tests`, configs das classes, `modules/damage-system/docs/aetherius-combat/plugin-pins.json`, `modules/enemy-system/src/discovery/housecarl-snapshot.mjs`|
|Novos arquivos propostos|`tools/audit/build-manifest.mjs`, `tools/audit/verify-exports.mjs`, `config/releases/<signature>.json`, `tests/characterization/baseline.test.mjs`|
|Contratos criados/alterados|CatalogManifest.v1 e EvidenceCoverage.v1 com scope/capped/fieldPaths|
|State ownership afetado|Nenhum writer novo; definitions ficam explicitamente pinadas|
|DB/migration|Nenhuma; inventariar versão/owner/backup do banco real sem extrair segredos|
|Events|Nenhum evento de gameplay; relatório BuildManifestCompleted local|
|UI adapters|Nenhum; readiness report em arquivo|
|Feature flag|`gameplay.mode=off`; `catalog.audit=true`|
|Testes|Verificar424 plugins/hashes,33.415trees, codec fixture, schema dos exports; reproduzir seis falhas Class e separar teste obsoleto de bug; expandir63 records por subpaths|
|Observabilidade|Contagens, checksum, campos truncados, lista de divergências e baseline commands|
|Rollback|Descartar novo manifest; preservar release anterior; nenhum dado de jogo mudou|
|Acceptance criteria|Servidor efetivo identificado por getEspmLoadOrder + settings pós-merge + hashes; nenhuma lacuna em record da primeira feature; expectativas Class justificadas em revisão|
|Blockers|B01 produção não comprovada; B07 cobertura limitada; B08 acesso/versão de persistência e scripts runtime|

## F1 — Host Integration API, bootstrap e capability probe

|Campo|Especificação|
|---|---|
|Objetivo|Estabelecer a fronteira pública entre GameplayCore e runtime e provar transporte/capabilities reais|
|Por que existe|Combat, death, inventory/effects e spell projection não devem depender de internals privados nem permanecer blockers permanentes|
|Pré-requisitos|F0 manifesto para homologação; baselines exatas dos repositórios host|
|Dependências|F0; UI Core pinado|
|Módulos afetados|Runtime/adapters no GameplayCore e, quando necessário, APIs públicas mínimas em aetherius-server/aetherius-client|
|Arquivos atuais envolvidos|`modules/class-system/server/runtime.ts`, integração UI atual, bridges Enemy/Durability e snapshots em `integrations/ui-runtime-changes`|
|Novos arquivos propostos|`runtime/server-entry.cjs`, `runtime/bootstrap.ts`, `runtime/capabilities.ts`, `runtime/lifecycle.ts`, `adapters/host/*`; interfaces públicas correspondentes nos repositórios host quando inexistentes|
|Contratos criados/alterados|CapabilityReport; IdentityPort; UiTransportPort; NativeCombatPort; NativeDeathPort; InventoryTransactionPort; EquipmentPort; ResourcePort; SpellProjectionPort; ActiveEffectsPort; Clock/Rng|
|State ownership afetado|Host continua owner de runtime/inventory/resources; GameplayCore continua owner das regras de domínio|
|DB/migration|Nenhuma obrigatória nesta fase|
|Events|HostReady, SessionBound/Unbound e eventos nativos versionados; nunca fabricar `NativeDeathConfirmed` a partir de string client|
|UI adapters|Handshake bidirecional e readiness; transporte atual é evidência útil, não authority de gameplay|
|Feature flag|`runtime.bootstrap=true`; capabilities individualmente off/probe até prova|
|Testes|Boot/reload/dispose/reconnect; listener único; ABI/API; idempotência do ResourcePort; death generation; inventory prepare/commit/recover; spell reconcile por origem; sem acesso a internals privados|
|Observabilidade|CapabilityReport com build/baseline/proof; listener count; port health; protocol latency|
|Rollback|Reverter a versão da Host API e adapter conjuntamente; manter feature dependente off; nenhum fallback silencioso para internals|
|Acceptance criteria|GameplayCore só importa APIs públicas; baselines/commits host explícitos; capabilities ausentes continuam false; API necessária é reproduzível em build limpo|
|Blockers|Capability ainda não implementada/testada mantém somente a feature dependente em shadow/off; não bloqueia a criação correta da API|

## F2 — Contratos únicos, forms e catálogo normalizado

|Campo|Especificação|
|---|---|
|Objetivo|Eliminar identidade/catálogo divergentes e produzir definitions imutáveis com cobertura|
|Por que existe|Enemy pode colidir por local ID; Damage tem formato próprio; patches/overlay alteram winners|
|Pré-requisitos|F0 válido; F1 para confrontar loader quando disponível|
|Dependências|F0/F1; schema Mutagen; exports Housecarl|
|Módulos afetados|Shared, Enemy, Class mappings e Damage definitions|
|Arquivos atuais envolvidos|`modules/enemy-system/src/records/identity.mjs`, `src/discovery/plugin-scanner.mjs`, `src/discovery/housecarl-snapshot.mjs`; Damage `forms/StableFormKey.h`, `forms/FormResolver.h`, `tools/compile-audited-catalog.cjs`; Class `config/perk-mappings.json`|
|Novos arquivos propostos|`shared/contracts/src/identity.ts`, `shared/contracts/schemas/*.json`, `shared/record-catalog/src/{import,normalize,index,coverage,signature}.ts`, `tools/catalog/build.mjs`|
|Contratos criados/alterados|StableFormKey.v1, CatalogManifest.v1, DefinitionRef.v1; legacy codecs explicitamente delimitados|
|State ownership afetado|RecordCatalog owner único de definitions; sem dados de ator|
|DB/migration|M001a catalog_release e migration_run; manifest/hash, sem copiar binários de mods|
|Events|CatalogBuilt/CatalogRejected; CatalogActivated somente fora do tick e após gate|
|UI adapters|Readiness de catálogo somente|
|Feature flag|`catalog.mode=shadow`|
|Testes|Full/ESL/ESPFE roundtrip, master index, rename/compaction mismatch, dois masters mesmo localID, layer signature, G04–G06/G11|
|Observabilidade|Build time, records/links/unsupported, signature diffs|
|Rollback|Selecionar immutable catalog anterior; bloquear consumers com epochs incompatíveis|
|Acceptance criteria|Um form canônico em todos os módulos;100% de forms exigidos resolvidos; headers auxiliares nunca substituem winners|
|Blockers|B01 lista runtime; B06 overlay equivalência; B07 subfields necessários|

## F3 — UnitOfWork PostgreSQL e ledgers

|Campo|Especificação|
|---|---|
|Objetivo|Garantir atomicidade econômica, outbox e recovery antes de qualquer writer novo|
|Por que existe|Maps/claims separados e SQL MySQL não oferecem transação PG|
|Pré-requisitos|Versão PG e identidade character estável definidas; ambiente descartável para testes|
|Dependências|F2 contratos|
|Módulos afetados|Shared persistence, Leveling, Class, Durability|
|Arquivos atuais envolvidos|Leveling `src/persistence/transaction.mjs`, `sky-mp-adapter.mjs`, `in-memory.mjs`, `src/audit/ledger.mjs`; Class `server/storage/playerRepository.ts`; Durability `server/persistence.js`, `database/001_aetherius_durability.sql`|
|Novos arquivos propostos|`shared/persistence/src/{pool,unit-of-work,command-ledger,outbox,inbox}.ts`, `database/migrations/001_core.sql`, `database/migrations/002_progression.sql`, `tests/integration/postgres/*.test.ts`|
|Contratos criados/alterados|Async UnitOfWork, CommandResult, transaction-scoped repos; proibir fake sync transaction|
|State ownership afetado|Ledger/DB passam a custodiar facts; módulos continuam off/shadow até import|
|DB/migration|M001/M002 aditivas conforme seção53; UNIQUE e constraints; role/backup definidos|
|Events|Outbox envelopes pós-commit; inbox dedupe por consumer/event|
|UI adapters|Command result pending/rejected/conflict; não sucesso antes do commit|
|Feature flag|`persistence.mode=shadow`, `economicWrites=false`|
|Testes|Crash antes/depois commit, concorrência, serializable retry, payload conflict, rollback, nenhum saldo negativo, outbox resend|
|Observabilidade|Tx latency/retry, lock wait, outbox age/deadletter, pool saturation|
|Rollback|Código anterior com schema aditivo; restore/replay ensaiado; sem DROP de fatos|
|Acceptance criteria|Um efeito por command/event apesar de retries; DB outage nega mutação; schema validado na versão PG alvo|
|Blockers|B08 banco operacional desconhecido; B05 inventário externo fora dessa transação|

## F4 — Class/ActorState facts, grants e composição

|Campo|Especificação|
|---|---|
|Objetivo|Unificar escolha/alocação/provenance e derivar perfil sem criar combat/effects store novo|
|Por que existe|Class publica antes de persistir; grants sem origem compartilhada; ActorState scaffold|
|Pré-requisitos|F2 definitions + F3 UoW; legacy snapshot de teste|
|Dependências|F1 identity/session; F2/F3|
|Módulos afetados|ActorState, Class e interface Damage|
|Arquivos atuais envolvidos|Class `server/classSystem.ts`, `server/storage/playerRepository.ts`, `shared/skillResolver.ts`, `server/combatProfileAdapter.ts`, `client/clientPerkApplier.ts`; ActorState `README.md`; Damage `state/ActorCombatState.h`|
|Novos arquivos propostos|`modules/actor-state-system/src/{aggregate,grants,reconcile,compose,providers,read-model}.ts`, `adapters/combat/profile-port.ts`, `database/migrations/003_actor_grants.sql`, `tools/migration/import-class-state.mjs`|
|Contratos criados/alterados|Grant/Source enums completos, RevisionVector, CombatProfileProjection, SpellProjection capability|
|State ownership afetado|Class choices/allocation; ActorState grant ledger/composition; Damage mantém estrutura nativa|
|DB/migration|M002/M003 import idempotente; divergência level/classLevel em quarantine; LEGACY_IMPORT auditado|
|Events|ClassSelected, AttributesAllocated, GrantsReconciled, ActorProjectionReady|
|UI adapters|Class/actor snapshots com breakdown de origem e points budget|
|Feature flag|`actor.mode=shadow`, `class.commands=canary` somente após import validado; `spellProjection.strict=false`|
|Testes|Mesmo selectClass repetido não reseta; revogar uma origem preserva demais;18skills; race boosts sem dupla soma; recurso clamp; G12|
|Observabilidade|Compose revisions, grant add/remove by source, unresolved import count|
|Rollback|Desabilitar novo command writer antes de legado; preservar ledger; recompor projeções do release anterior|
|Acceptance criteria|Um writer por fato; grants explicáveis; nenhum third store; perfil determinístico por mesmas inputs|
|Blockers|B02 impede apply nativo, mas shadow conclui; B03 impede strict spell sync; B07 record coverage|

## F5 — Enemy definitions, templates e spawn seguro

|Campo|Especificação|
|---|---|
|Objetivo|Resolver NPC/leveled/encounter uma vez com segurança e persistência por generation|
|Por que existe|Heurísticas duplicadas e exceção boss antes de quest safety podem promover conteúdo errado|
|Pré-requisitos|F2 catálogo de NPC/LVLN/CELL/LCTN/QUST/ECZN completo para subset|
|Dependências|F1 world snapshot/spawn capability; F3 spawn persistence; F4 NPC grant projection|
|Módulos afetados|Enemy e NPC provider ActorState|
|Arquivos atuais envolvidos|Enemy `src/enemies/registry.mjs`, `src/quest-safety/classifier.mjs`, `src/spawning/resolver.mjs`, `src/leveled-lists/analyzer.mjs`, `src/encounters/profiles.mjs`, `src/dungeons/classification.mjs`, `src/persistence/spawn-state.mjs`|
|Novos arquivos propostos|`modules/enemy-system/src/catalog/template-resolver.ts`, `src/catalog/classification-evidence.ts`, `adapters/skymp/spawn-port.ts`, `modules/actor-state-system/src/providers/npc.ts`, `database/migrations/004_spawn.sql`|
|Contratos criados/alterados|EnemyDescriptor.v2, SpawnResolution.v1, QuestSafetyDecision.v1|
|State ownership afetado|Enemy classification/spawn/generation; ActorState só compõe NPC profile|
|DB/migration|M004 spawn_resolution, catalog signature na key lógica/cache e conteúdo|
|Events|EnemySpawnResolved/Rejected, NpcProfileComposed|
|UI adapters|Bestiary/readiness com classificação do mesmo registry|
|Feature flag|`enemy.mode=shadow`, `enemy.substitution=false` até spawn port/safety prova|
|Testes|Templates parciais/ciclo, leveled nesting/chance-none, fixed/dynamic level, unique+quest, deterministic retry, G08|
|Observabilidade|Unknown classification, quest gate reasons, pool empty, generation duplicate|
|Rollback|Preservar spawn original; não despawnar quest actors indiscriminadamente; novas generations usam release anterior|
|Acceptance criteria|Sem regex duplicada no consumidor; NPC player-independent profile; mesmos seed/inputs resolvem igual; quest uncertain preservado|
|Blockers|B07 aliases/VMAD/conditions completos; B01 catálogo runtime; falta de spawn port mantém shadow|

## F6 — Conditions e cobertura de efeitos

|Campo|Especificação|
|---|---|
|Objetivo|Compilar AST e executar subconjunto auditado sem unknown-as-true|
|Por que existe|178 funções reais excedem factory base; ADXP modifica gates e entrypoints|
|Pré-requisitos|F2 facts completos dos records candidatos; F4/F5 state context|
|Dependências|F1 context capability report|
|Módulos afetados|Damage condition/perk engine e shared catalog|
|Arquivos atuais envolvidos|Damage `perks/PerkRegistry.h`, `context/DamageContext.h`, `tools/compile-audited-catalog.cjs`; fixture before/after ADXP|
|Novos arquivos propostos|`shared/record-catalog/src/conditions/{ast,compile,coverage}.ts`, `modules/damage-system/.../conditions/{Context,Evaluator,Result}.h`, `tests/golden/conditions/*`|
|Contratos criados/alterados|ConditionAst.v1, ConditionContext.v1, tri-state plus Invalid, capability requirements|
|State ownership afetado|Nenhum fato novo; evaluator só consulta snapshots owners|
|DB/migration|Nenhuma; definitions/coverage pinadas em catalog_release|
|Events|CoverageReportBuilt; unsupported metric, sem evento por tick inundando outbox|
|UI adapters|Reason de feature indisponível e diagnostics admin|
|Feature flag|`conditions.mode=shadow` e allowlist por record hash|
|Testes|Todas funções observadas têm teste de suporte ou rejeição; OR grouping, globals, aliases, tabs, random scope; G01–G03/G09/G10|
|Observabilidade|Unsupported por função/reason, eval latency, branches trace amostrado|
|Rollback|Selecionar AST/coverage anterior; gates impedem ligar perks dependentes|
|Acceptance criteria|Nenhum record ativado contém condition não certificada; sem DB no Evaluate; resultado reproduzível|
|Blockers|B02 native context para combat; B07 extrações; scripts/quest hosts indisponíveis|

## F7 — XP global única, party e milestones

|Campo|Especificação|
|---|---|
|Objetivo|Morte→Enemy→Leveling→Class uma vez com ledger/party snapshot|
|Por que existe|Class e Leveling disputam propriedade; TTL e client deaths não são prova|
|Pré-requisitos|F3 atomicidade; F4 choices; F5 classification; NativeDeathPort real para ativação|
|Dependências|F1/F2/F3/F4/F5|
|Módulos afetados|Leveling, Class leveling/party/raid, Enemy bridge|
|Arquivos atuais envolvidos|Class `server/levelingSystem.ts`, `server/index.ts`, `server/partySystem.ts`, `server/raidSystem.ts`, `client/combatEvents.ts`; Leveling `src/integration/experience-authority.mjs`, `enemy-consumer.mjs`, `class-progression.mjs`, `src/policies/party.mjs`, `src/domain/progression.mjs`; Enemy `src/leveling-integration/bridge.mjs`|
|Novos arquivos propostos|`modules/leveling-system/src/services/award-command.ts`, `src/persistence/postgres.ts`, `adapters/skymp/death-port.ts`, `shared/contracts/src/enemy.ts`, `tests/integration/xp-crash-recovery.test.ts`|
|Contratos criados/alterados|EnemyDefeated.v2, RewardPlan, PartyRewardSnapshot, CharacterLevelChanged|
|State ownership afetado|Leveling único writer XP/nível; Class milestones/allocation; Party membership único|
|DB/migration|M002 progression/xp_ledger/fatigue/outbox; import mantém curva1..40; sem dois saldos XP|
|Events|NativeDeathConfirmed→EnemyDefeated→XpAwarded/CharacterLevelChanged→GrantsReconciled|
|UI adapters|Progress bar/breakdown e party statuses; sem award action|
|Feature flag|`xp.mode=shadow`, depois canary; legacy Class award OFF antes de active|
|Testes|Death replay/newgeneration, concurrent party tx, NaN/distância, cap/multilevel, six Class failures resolvidos com intenção documentada; G13/G14|
|Observabilidade|Award denied reason, ledger duplicate, XP drift, progression revision lag|
|Rollback|Freeze awards, drenar outbox, preservar XP confirmado; replay/conversão antes de reativar legado|
|Acceptance criteria|Nenhuma XP a partir de client-only evidence; party inteira consistente; Leveling única authority; Class reage sem reaward|
|Blockers|B04 morte autoritativa ausente; B01 catálogo; B08 PG operacional|

## F8 — Manutenção PostgreSQL e provider em RAM

|Campo|Especificação|
|---|---|
|Objetivo|Integrar kits/coverage/ciclos sem SQL por hit nem fórmula paralela|
|Por que existe|Dialeto MySQL e inventário externo quebram atomicidade; handler atual aguarda persistência|
|Pré-requisitos|F3 UoW; InventoryTransactionPort com recovery comprovado; equipment snapshot confiável|
|Dependências|F1/F2/F3/F4|
|Módulos afetados|Durability, Damage provider, inventory UI adapter|
|Arquivos atuais envolvidos|Durability `server/maintenance-service.js`, `server/persistence.js`, `server/material-catalog.js`, `server/sky-mp-bridge.js`, `server/protocol.js`, `config/maintenance-config.json`; Damage `providers/CombatProviderRegistry.h`|
|Novos arquivos propostos|`modules/durability-system/server/postgres-persistence.ts`, `server/coverage-reservations.ts`, `server/combat-provider.ts`, `adapters/skymp/inventory-transaction-port.ts`, `database/migrations/005_maintenance.sql`|
|Contratos criados/alterados|MaintenanceSnapshot, InventoryReservationToken, ItemCombatModifier; auth obrigatório|
|State ownership afetado|Durability balances/cycles; host mantém inventário; Damage cálculo final|
|DB/migration|M004/M005 import e reservas idempotentes; request key por personagem/tipo/hash|
|Events|KitActivationCommitted, MaintenanceReserved/CycleStarted/CoverageChanged|
|UI adapters|Inventory maintenance route; available/reserved claramente separados|
|Feature flag|`maintenance.mode=shadow`, `kitCommands=false` até B05 resolvido|
|Testes|Concurrent activation, saldo100/cap64, timeout30s/inactivity10s, reconnect, unknown material exclusion, crash reserve/consume; G15|
|Observabilidade|Reservation age, exhausted coverage, classification unknown, debit recovery|
|Rollback|Parar novas reservas, reconciliar não usadas com prova, preservar consumos; provider neutral só por transição explícita|
|Acceptance criteria|Uma carga/material/ciclo, sem duplicar débito ou .7; nenhuma IO no provider de dano; recovery ensaiado|
|Blockers|B05 inventário sem primitive; B02 aplicação de provider ao native damage; B06 keywords pós-overlay|

## F9 — Combate físico e NPC profiles, somente com host capaz

|Campo|Especificação|
|---|---|
|Objetivo|Aplicar pipeline físico existente em subset validado com uma authority|
|Por que existe|Helpers testados não provam ligação ao addon nem input autorizado|
|Pré-requisitos|B02 resolvido por capacidade pública disponível, F4 profiles, F5 NPCs, F6 conditions, F8 provider se habilitado|
|Dependências|F1–F6; F8 opcional condicionado à feature|
|Módulos afetados|Damage/ActorState/Enemy|
|Arquivos atuais envolvidos|Damage `AetheriusDamageFormula.cpp`, `physical/PhysicalDamagePipeline.h`, `physical/ArmorCurve.h`, `stats/EquipmentCombatStats.h`, `stats/CombatStatsCache.h`, `state/ActorCombatState.h`, `integration-tests/LegacyDamageGoldenTest.cpp`|
|Novos arquivos propostos|`adapters/combat/native-capability.ts`, `modules/damage-system/.../adapters/AuthorizedContext.h`, `tests/host/physical-cutover.test.*`|
|Contratos criados/alterados|AuthorizedHitContext, equipment instance identity, atomic profile publication|
|State ownership afetado|Damage única execução do subset; Host resource port aplica resultado uma vez|
|DB/migration|Sem SQL em hit; somente facts/revisions/outbox fora do callback|
|Events|AuthorizedHitResolved e resource/effect facts com eventId; UI recebe projeção amostrada|
|UI adapters|HUD health/damage explanation admin; não aceitar damage command|
|Feature flag|`combat.physical=shadow/canary/active`; autoridade legado mutuamente exclusiva|
|Testes|Player↔NPC/NPC↔NPC, weapon instance/AMMO/block/critical, enchanted armor rejection, packet power spoof, cap; carga warm cache|
|Observabilidade|p99damage, cache invalidation, rejected context, dual-owner assertion|
|Rollback|Fencer de combat mode em maintenance window, drain de hits, reidratar epoch; não fallback por hit|
|Acceptance criteria|NativeCombatPort/ResourcePort públicos e versionados passam contract/host tests; perfil de ambos atores; nenhuma dupla aplicação; budget medido|
|Blockers|B02 mantém o combate off/shadow até a Host API necessária ser implementada e validada; patches históricos não substituem uma API pública/versionada|

## F10 — Magia, enchantments e alchemy por subset

|Campo|Especificação|
|---|---|
|Objetivo|Executar efeitos reais em store existente com provenance e custos corretos|
|Por que existe|Magic runtime atual lança;39 archetypes não equivalem a soma de dano Health|
|Pré-requisitos|F6 coverage e F9/native effect/resource capability; B03/B05 resolvidos para features dependentes|
|Dependências|F2/F4/F5/F6/F8/F9 conforme subset|
|Módulos afetados|Damage effects/magic, ActorState grants/choices, Enemy summon, inventory ports|
|Arquivos atuais envolvidos|Damage `effects/ActiveEffectStore.h`, `magic/MagicDamagePipeline.h`, `AetheriusDamageFormula.cpp`; Class client grant projection; definitions SPEL/MGEF/ENCH/ALCH/INGR/SCRL|
|Novos arquivos propostos|`modules/damage-system/.../magic/{CastSession,EffectCompiler,ArchetypeRegistry}.h`, `modules/actor-state-system/src/{spell-acquisition,transformations}.ts`, `database/migrations/006_durable_effects.sql`|
|Contratos criados/alterados|CastIntent/AuthorizedCast/EffectInstance checkpoint, learned acquisition, transformation transition|
|State ownership afetado|ActiveEffectStore existente; sem terceiro store; ActorState choice/provenance; Inventory owner mantém consumíveis|
|DB/migration|M005/M006 efeitos duráveis com sourceActorKey; concentration nunca reidratada; spell acquisitions únicas|
|Events|CastAuthorized/Cancelled, EffectStarted/Expired/Dispelled, PotionConsumed, TransformationChanged|
|UI adapters|Spells/abilities/powers separados, active effect sources e cooldown authoritative|
|Feature flag|`magic.subsets.<id>=shadow`, depois canary por definition hashes; `enchantments/Alchemy` separadas|
|Testes|F10a AV subset; F10b resist/ward/cure/area/stack/concentration; F10c summons/AI/scripts/transforms somente com golden específico; G09/G10/G12|
|Observabilidade|Unsupported, effects cap/tick lag, cost/debit mismatch, source reconciliation|
|Rollback|Parar casts novos, terminar/cancelar instâncias por policy, preservar ledger e remover só source habilitada|
|Acceptance criteria|Cada record habilitado totalmente coberto; nenhuma dupla aplicação com ActiveMagicEffectsMap; no remove-all; custos/replay seguros|
|Blockers|B02/B03/B05/B06/B07 conforme record; Script genérico não recebe implementação fictícia|

## F11 — UI integrada, resync e publicação controlada

> A UI é uma trilha paralela, não uma dependência linear final. Read-only/readiness pode avançar desde F1; commands só são liberados quando o owner e as capabilities da feature estiverem prontos.

|Campo|Especificação|
|---|---|
|Objetivo|Entregar read models/actions dos seis domínios no UI Core e readiness legível|
|Por que existe|Class vende cópia de protocolo, manutenção usa canal próprio, falta resync integrado|
|Pré-requisitos|F1 transporte comprovado; contratos/projections das fases correspondentes|
|Dependências|F4/F5/F7/F8/F10 para features, mas áreas read-only podem sair antes|
|Módulos afetados|Gameplay adapters UI e projections; UI Core é dependência pinada|
|Arquivos atuais envolvidos|Class `server/uiModule.ts`, vendor UI core protocol/router/revisionStore e client controller; Durability `ui/maintenance-panel.*`, `server/protocol.js`|
|Novos arquivos propostos|`adapters/ui-core/{register,actions,revision-session}.ts`, `adapters/ui-core/modules/{class,actor,spells,party,progression,maintenance,enemy}.ts`, `tests/ui/resync-contract.test.ts`|
|Contratos criados/alterados|Read models seção59; protocol V1 preservado; snapshots epoch/revision|
|State ownership afetado|UI projection somente; comandos delegam owners|
|DB/migration|Nenhuma tabela de UI como gameplay authority; command ledger já existente|
|Events|Domain events→ProjectionPublished; requestSnapshot e resync, sem XP client|
|UI adapters|Slots existentes class/spells/party/inventory; maintenance subroute; lifecycle AbortSignal/dispose|
|Feature flag|`ui.modules.<id>=enabled` somente se capability correspondente ou read-only definido|
|Testes|Duplicate in-flight, stale patch/full snapshot, logout troca personagem, oversized/proto payload, keyboard/controller/focus in-game; G16/G17|
|Observabilidade|Resync rate, command reject reason, pending duration, protocol compatibility|
|Rollback|Desregistrar módulo/voltar read-only; não revogar grants nem desfazer domínio por falha visual|
|Acceptance criteria|UI não calcula authority; reconnect converge; qualquer mudança host necessária ocorre via API pública/versionada e não por internals privados|
|Blockers|F1 transporte; feature blockers herdados; DLL Meridian não testada in-game nesta auditoria|

## F12 — Homologação, carga, cutover e rollback ensaiado

|Campo|Especificação|
|---|---|
|Objetivo|Promover apenas features com evidência end-to-end e operadores de rollback preparados|
|Por que existe|Tests unitários não cobrem ABI, deploy, economia e múltiplos clientes|
|Pré-requisitos|Fases da feature concluídas, manifesto de produção, backup/replay verificados|
|Dependências|F0–F11 conforme feature; nenhum blocker herdado ignorado|
|Módulos afetados|Todos; config/deploy do GameplayCore|
|Arquivos atuais envolvidos|Suites dos módulos e artifacts de readiness, sem base patches|
|Novos arquivos propostos|`tools/release/{preflight,canary,rollback}.mjs`, `tests/e2e/scenarios.json`, `config/releases/<signature>.json`, `docs/runbooks/cutover.md`|
|Contratos criados/alterados|ReleaseAcceptance.v1 com proof hashes, load profile, approvals operacionais aplicáveis|
|State ownership afetado|Transição única de writer/owner por feature, fencing de epochs|
|DB/migration|Backups/migration journal/replay; migrations destrutivas proibidas no rollback|
|Events|FeatureModeChanged, ReleaseActivated/RolledBack auditados|
|UI adapters|Indicação de maintenance/read-only e full resync no epoch change|
|Feature flag|Canary explicitamente listado, depois active por feature; kill switches testados|
|Testes|Carga e budgets seção60,2+clientes, NPCs, reconnect/restart/crash, DB outage, adversarial payload, rollback com XP/kit já commitados|
|Observabilidade|Dashboard completo, alertas de invariantes, memória/filas sob duração suficiente|
|Rollback|Executar runbook da seção65 em homologação e guardar evidência; falha bloqueia promoção|
|Acceptance criteria|Checklist71 completo; zero owner duplicates/unsupported aplicado/XP sem ledger; budgets medidos; baselines e mudanças de Host API reproduzíveis e rastreadas, sem modificação privada/não versionada|
|Blockers|Qualquer B01–B08 aplicável e qualquer regression gate; “planejamento concluído” não equivale a release pronta|

## Dependências e entrega incremental

F0→F1→F2→F3→F4. F5 deriva de catálogo/identidade/persistência; F6 pode ser desenvolvido offline após F2. F7 depende do NativeDeathPort, F8 do InventoryTransactionPort e F9 do NativeCombatPort; quando esses ports não existirem, F1 inclui a criação da Host API mínima correspondente. F10 depende de seus subsets/contextos. F11 é paralela e pode começar read-only após F1. F12 promove somente capacidades comprovadas.
