# Compatibilidade proposta na A5

Data: 07/10/2026. Baseline do Core: `f6225187cd7eee5fcd5eea658726d646f8833dc5`. Sem migração de módulos ou adapters nesta ordem. Os formatos abaixo continuam ativos onde já eram usados; A5 propõe a fronteira que os próximos trabalhos deverão adotar.

## Identidade de record: enemy e damage

| Fonte legada no Core | Mapeamento para A5 | Informação ausente / incompatibilidade |
|---|---|---|
| `modules/enemy-system/src/records/identity.mjs`: `stableRecordIdentity(plugin, localFormId)` → `plugin\|XXXXXX` | Revalidar pelo codec com plugin de definição e `PluginKind` do catálogo. Ex.: `Skyrim.esm\|012EB7` → `skyrim.esm\|012EB7`. | A factory não normaliza o plugin, aceita zero e não limita 24/12 bits; o parser apenas exige seis hex. Entradas antes aceitas podem ser rejeitadas; não truncar nem mascarar. |
| Enemy: `normalizePluginName` | Usar nome de arquivo já estabelecido pelo catálogo e então canonicalizar. | A função extrai basename de caminho; o codec novo rejeita caminhos. Não usar basename para disfarçar identidade ambígua. |
| Enemy: `stableSpawnIdentity` → record/ref + sufixos de célula/sourcePath | Manter como identidade de spawn do domínio; só uma identidade de record separada e provada vira `StableFormKey`. | Sufixos não são parte da identidade do record; descartá-los perde distinção entre spawns. `refId` pode não ser id local persistível. |
| Damage: `forms/StableFormKey.h`: `{plugin, localId}`, texto `plugin:XXXXXX` | Adapter futuro troca delimitador, preserva plugin de definição/id, valida metadata e usa codec: `skyrim.esm:012EB7` → `skyrim.esm\|012EB7`. | Parser C++ lowercases, exige seis hex e recusa zero, mas não verifica limite LIGHT. Objeto C++ construído diretamente/`ToString()` não garante a validação do parser. |
| Damage: `forms/FormResolver.h`: `Stable(runtimeId, browser)`/`Resolve(key, browser)` | Resolver de runtime fica no host/RecordCatalog; expõe `RuntimeFormId` transitório, lookup retorna `DefinitionRef`/`CatalogEntry`. | Exige metadata confiável e catálogo reconciliado; não converter runtime sem fonte/local provados. Resolução legada não adiciona assinatura/tipo ou prova de winner/capability. |

Os caminhos de Damage da tabela são relativos a `modules/damage-system/server/server/cpp/server_guest_lib/aetherius_combat/`.

A5 escolhe `plugin|XXXXXX` para manter a representação textual do Enemy e separar filename de local id de forma inequívoca. O C++ usa `:` e precisa de adapter explícito. Para valores canônicos válidos, trocar o delimitador não perde identidade. Não existe uma incompatibilidade demonstrada de *bits* entre os dois parsers: ambos leem seis hex, mas nenhum aplica o limite LIGHT. A5 fecha essa lacuna exigindo metadata `FULL | LIGHT` e rejeitando valores fora da faixa.

Plugin completo: local `1..0xFFFFFF`. Plugin leve: local `1..0xFFF` representado nos mesmos seis dígitos. A extensão `.esp` não permite inferir ESPFE; `.esm` também pode ser leve. O codec nunca descarta índice runtime. Runtime do índice completo zero não pode ser diferenciado por valor numérico sozinho: o futuro resolver deve provar a origem. Plugins/records ausentes ou catálogo divergente permanecem `UNSUPPORTED`.

`winningOverridePlugin` de Enemy e `CatalogEntry.winnerPlugin` descrevem o override vencedor; a chave sempre pertence ao plugin de definição. O `WinningOverrideResolver` legado pode comparar localId/tipo entre candidatos e já declara que ownership deve ser verificado pelo adapter. Igualdade de localId entre plugins diferentes não prova que são overrides do mesmo record. O novo port exige winner reconciliado, sem aceitar esse ranking isoladamente como prova.

## Damage: grants, revisão e efeitos

| Legado | Mapeamento | O que não pode ser reconstruído por cast |
|---|---|---|
| `state/ActorCombatState.h`: `PerkGrant { key, rank }`; JSON de `CombatProfile` exige `source: "CLASS"` | Perk → `PerkGrant` com definição PERK, rank e origem CLASS **após** comprovar classId/sourceKey, assinatura e revisão. | JSON não guarda sourceKey; struct interna nem guarda source. Não inventar a classe de origem. Múltiplas origens da mesma definição são perdidas pela deduplicação legada por key. |
| `CombatProfile.revision` escalar e `CombatRevision { profile, equipment, effects, providers }` | Projetar snapshot do futuro ActorState para o **mesmo** ActorCombatState de Damage. | Não equivalem a `{facts, grants, equipment, effects, catalog}`. Não copiar profile para facts/grants ou providers para catalog; falta autoridade de revisão do catálogo. |
| `CombatProfile.skills`/`baseAttributes` | Continuam no domínio/projeção de combate futura; A5 não cria outro combat state. | `GrantSet` não é profile de skills/atributos e não transporta esses campos. Conversão para apenas grants os perderia. |
| `effects/ActiveEffectStore.h`: `effectKey`, `sourceForm`, `provenance`, `sourceActorId` e tempos persistidos | Chaves de record podem ser revalidadas; a integração futura deve conservar o store único e definir provenance/identidade duráveis. | String provenance não é automaticamente `GrantSource`; actorId não é CharacterKey. Save persiste sourceActorId: isso contradiz a identidade durável exigida para uma origem de personagem. A5 não corrige nem cria store alternativo. |

## Class

Fonte: `modules/class-system/shared/types.ts` e auditoria A1.

| Campo/formato | Mapeamento previsto | Perda/lacuna |
|---|---|---|
| `PlayerClassState.playerId: number`, ids de party/killer | Resolver actor runtime para `SessionBinding`, então usar `CharacterKey` para fato durável; party/spawn continuam no domínio. | O tipo number não diz se é actor, perfil ou personagem. Não converter `String(playerId)` em CharacterKey sem vínculo autenticado. |
| `PerkMapping { name, localId, candidatePlugins, editorIdAliases }` | Resolver para definição vencedora comprovada e guardar `StableFormKey` + tipo + assinatura. | Nome/alias/lista de candidatos não provam plugin de definição. localId nulo/zerado e `FALLBACK_MOCK` não viram grant suportado. Apresentação/aliases continuam fora da identidade. |
| `ResolvedPerk.resolvedFormId`, `hexFormId`, `pluginFound`, `strategyUsed` | Runtime só no adapter; definição estável sai do catálogo reconciliado. | Hex runtime/nome não são id local. Mesmo `isResolved` não certifica origem, winner ou semântica. Estratégias por nome/mock não satisfazem o contrato novo. |
| `StageProgression.perks: string[]`, `unlockedPerks`, `authorizedSpells` por nomes/tiers | Providers geram grants com source CLASS e chave da classe/marco determinada pelo owner; spell entitlement é validado no servidor. | Não há definição estável, provenance/revision suficientes nesses nomes. Preservar textos como apresentação, não usá-los como identidade. |
| `combatRevision?`, `level/currentXp/totalXpAccumulated`, fadiga, alocações | Revisão é reemitida pelos owners; Class mantém escolha/marcos/alocação, Leveling mantém XP/nível/fadiga e ActorState compõe. | Revisão opcional escalar não permite reconstruir vetor. A5 não transfere writer nem resolve a duplicação atual; futura migração não pode ativar dois writers de XP. |
| `CombatKillEvent` com `victimBaseXp`, flags de categoria e ids numéricos | Ocorrência cliente só pode motivar evidência; morte/recompensa precisa de NativeDeathFact e contexto autorizado. | Campos de recompensa/reportes cliente não viram fatos de morte nem XP final por envelopamento. |

DTOs antigos são mutáveis; o boundary futuro deve produzir cópias readonly desacopladas. Não entregar referências internas e apenas adicionar `as`.

## Enemy e Leveling: eventos

Fontes: `modules/enemy-system/src/contracts/{types,factories}.mjs` e `modules/leveling-system/src/contracts/{enemy-killed,events,reasons}.mjs`.

| Formato legado | Mapeamento previsto | Perda/lacuna |
|---|---|---|
| Enemy killed v1: eventId, occurredAt, victimId/killerId, enemy descriptor e progressionContext | Preservar contexto do domínio no payload JSON de um EventEnvelope; envelope acrescenta producer/version/type. Só publicar fato durável após commit; origem host de morte usa NativeDeathFact. | Não descartar combatLevel, xpCategory, provenance/contexto: envelope genérico não os substitui. Faltam geração/sequence/binding e vínculo durável dos participantes. Killer 0 vira null **apenas** como sem crédito, sem inferir causa. |
| `createXpAwardedEvent`, `createLevelChangedEvent`, `createXpRejectedEvent`: `contractVersion`, `type`, `eventId`, `playerId`, configVersion/ledgerId e campos de progressão | Envelope recebe eventId, type, `version = contractVersion` compatível e producer explícito; payload conserva os demais dados necessários. Identidade de player passa a CharacterKey após resolução autenticada. | A factory não garante commit/outbox. Não emitir rejection como fato de mutação durável nem reutilizar o eventId de entrada como evento diferente sem namespace/policy do owner. |
| ReasonCodes e validadores v1 | Razão pode ser usada em `CommandResult.reason`; códigos de domínio continuam no payload/owner. | `CommandResult` precisa requestId e status/revision conforme variante, ausentes no evento legado. Não colapsar toda rejeição de domínio em `UNSUPPORTED`. |

Os validadores de Enemy/Leveling já proíbem valores calculados de XP no kill event. Preserve essa fronteira: Enemy fornece classificação/contexto, Leveling calcula recompensa. Level/Class levels legados não são prova da futura separação dos owners. A5 não muda contratos de domínio nem os duplica no shared kernel.

## Atualização após a A1: identidade e D1

Fontes atuais: [HOST_AUDIT.md](../../../_work/evidence/A1/HOST_AUDIT.md) e [A1-review-1.md](../../../_work/reviews/A1-review-1.md). A1 auditou server `4c47aa92c2467522a3ae1eb1c2ecb25b02d7d64f` e client `ae4171d98ad33487031037cae3696351e8b0c66b`.

O login retorna `users.profile_id`, não id de personagem. A whitelist MySQL resolve o personagem aprovado por conta; o spawn nativo escolhe um ator do perfil. O autowhitelist local fabrica character.id igual ao perfil e não demonstra o vínculo de produção. A5 mantém ProfileKey/CharacterKey distintos, mesmo quando os valores textuais coincidirem.

D1 continua **PROPOSED**. Alternativas a decidir, sem escolha implícita no codec:

| Opção de D1 | O que exige do host e da persistência |
|---|---|
| CharacterKey representa id durável da tabela de personagens | Port da tabela/vínculo para PostgreSQL, seleção autorizada de personagem, ligação account/profile → character → actor e epoch no spawn/reconnect/troca. Sem mapping disponível, IdentityPort retorna UNSUPPORTED. |
| CharacterKey é chave própria opaca, ligada ao personagem existente | Mapping durável único com o id legado, migração/backfill e validação da conta proprietária; o host precisa devolver essa associação e renovar epoch. Não criar personagem pelo mero relato do cliente. |
| Um personagem por perfil como política explícita | Restrição de cardinalidade decidida e aplicada duravelmente, mapping perfil → personagem e política de migração se futuramente houver vários. Mesmo nessa opção, ProfileKey e CharacterKey continuam tipos distintos; igualdade numérica do modo local não prova a política. |

Nenhuma opção permite persistir actorId/userId. Epoch precisa sobreviver como distinção de gerações, não como id de conexão reutilizável. `isCurrent` deve ser repetido após operações assíncronas; um lookup não reserva o binding.

## Atualização após a A1: ports e ownership

| Achado aprovado na A1 | Exigência do contrato A5 / trabalho posterior |
|---|---|
| Sem estado de perk no servidor; learnedSpells serializa runtime FormID; cliente remove-all no spawn | GrantProjectionPort publica conjunto completo por origem/revisão e autentica ACK; adapter futuro resolve chaves pelo catálogo e reconcilia diferenças. Não reutilizar o sync legado como implementação do contrato. |
| ConditionsEvaluator desconhecido → true | `ConditionResult` tem TRUE/FALSE/UNSUPPORTED/INVALID. Booleano legado não distingue ausência/malformed; adapter direto é incompatível. |
| Cliente reporta ocorrência/atores/fonte/projétil/quatro flags; host valida só parte e usa flags no dano | ClientHitEvidence e ServerHitFacts têm discriminantes e estruturas distintos. Host não certifica flags/alcance/mods por renomeação. CombatApplication vem exclusivamente do owner certificado, com aplicação única. |
| Recursos replicados como percentuais; custo de cast não debitado autoritativamente | ResourcePort exige valores absolutos e owner único; ausência dessas garantias é UNSUPPORTED, não reconstrução simulada a partir de percentual. |
| onDeath fornece actorId/killerId, mas não geração/seq/eventId | NativeDeathPort exige enriquecimento host, política de IDs e deduplicação downstream. Não concede XP a partir de relato cliente/polling sem prova. |
| Inventário runtime nativo e ledger do gamemode divergem; AddItem numérico é suspeito na análise estática | InventoryTransactionPort delega ao transaction-service existente, exige instância/extraData e entrega recuperável. Port PostgreSQL sozinho não certifica atomicidade. Não criar inventário/pool/ledger paralelo. |
| Há pool do gamemode e pool próprio do login TS | Core usa somente pool/ledger do gamemode. Pool do login continua propriedade do host, fora do shared kernel. |

Concessão é decisão do servidor para todos os records; resultado só passa a AETHERIUS_SERVER por família certificada. NATIVE_SERVER/NATIVE_CLIENT/DISABLED permanecem owners explícitos. Um ACK, schema válido ou método implementado não muda owner nem prova capability.

## Divergências documentais e limites desta entrega

O documento canônico de 05/10 ainda contém ActorKey, SpellProjectionPort, kernel que fornece pool próprio e a sequência F0–F12. Para A5, a ordem atual usa CharacterKey, GrantProjectionPort (inclui perks/spells) e o pool existente do gamemode; o plano de 06/10 organiza Fases A/B/C e trilhas P/D. Esta nota registra a supersessão aplicável à proposta A5; a atualização do documento canônico e as decisões D1/D3–D8 pertencem à A4. A5 não escreve em `docs/architecture/`.

Não há compatibilidade automática: nenhum formato legado foi alterado e nenhum adapter foi implementado. Definições, assinaturas, origins, epochs e revisões ausentes devem ser obtidos do owner competente; quando não forem obtidos, declarar UNSUPPORTED. Testes de contracts demonstram forma/brands/codecs, sem certificar host, records instalados, persistência ou sessão em jogo. Para garantias semânticas que schemas isolados não expressam, veja [README.md](README.md#schemas-e-validação).
