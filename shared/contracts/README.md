# Contratos compartilhados — A5

Proposta da Fase A, versão `0.1.0`. A aprovação depende da revisão do Opus 5.5 e do gate G-ARQ. Este pacote define DTOs, tipos nominais e schemas; os nove ports são interfaces, sem adapters. O único código executável de produção é o codec puro de `StableFormKey`. Não há persistência, transporte, compositor, cálculo de combate ou bundle nesta ordem.

A fonte desta proposta é a [ordem A5](../../../_work/orders/A5-contratos-compartilhados.md), incluindo a atualização após a A1, o [plano de integração](../../../PLANO_INTEGRACAO_GAMEPLAY.md) e a [auditoria A1](../../../_work/evidence/A1/HOST_AUDIT.md), aprovada na [revisão A1](../../../_work/reviews/A1-review-1.md). Os documentos do Core estão em [arquitetura](../../docs/architecture/AETHERIUS_GAMEPLAY_CORE_ARCHITECTURE.md). As divergências históricas e o mapeamento dos legados estão em [COMPATIBILITY.md](COMPATIBILITY.md).

## Quem produz e quem consome

Os produtores e consumidores abaixo são os previstos pelo plano, não módulos já migrados.

| Contrato | Quem produz | Quem consome |
|---|---|---|
| `ProfileKey`, `CharacterKey`, `ActorRef`, `SessionEpoch`, `SessionBinding` | Host de identidade/sessão, com associação durável autenticada | Runtime, transporte de comandos e ports de projeção/recursos/combate |
| `StableFormKey`, `PluginKind`, `CatalogSignature`, `DefinitionRef`, `CatalogEntry` | Builder/RecordCatalog reconciliado com a load order do host | Providers de raça/pedra/classe/religião, grants, Damage, inventário |
| `RuntimeFormId` | Resolver do host/catalog em memória | Adapters de runtime; nunca identidade persistente |
| `RevisionVector` | Owners de facts, grants, equipment, effects e catalog, reunidos em snapshot coerente | ActorState, projeção, comandos e Damage |
| `GrantSourceKind`, `GrantSource` | Owner do fato que origina a concessão | ActorState e reconciliação por origem |
| `Grant`, suas cinco variantes, `GrantSet` | ActorState a partir dos providers e acquisitions | GrantProjectionPort, read models e futura projeção de combate |
| `EffectOwner` | Tabela de ownership/certificação da família | Providers, projeção e caminho de aplicação de resultado |
| `GrantProjection`, `ProjectionReceipt` | ActorState/runtime; host confirma enfileiramento | Host/cliente de grants; runtime acompanha entrega |
| `GrantProjectionAck` | Cliente; host autentica emissor e binding | Runtime/projeção, sem promover ACK a prova de resultado |
| `CommandEnvelope` | Transporte autenticado a partir de intenção validada | Router e único owner do fato |
| `CommandResult` | Owner do comando | Transporte, UI e recovery |
| `EventEnvelope` | Owner durável, via outbox após commit | Handlers/inbox idempotentes |
| `Capability`, `CapabilityStatus`, `FeatureMode`, `PortResult` | Host probes/runtime/configuração versionada | Gate de feature e consumidores dos ports |
| `ConditionResult` | Avaliador certificado de condições | Damage e famílias de efeitos certificadas |
| `ResourceValue`, `ResourceSnapshot`, `ResourceMutation`, `ResourceMutationReceipt` | Snapshot/recibo: host; pedido: Core autorizado | ResourcePort e owners autorizados de resultados |
| `ClientHitEvidence` | Cliente, com binding autenticado pelo transporte | NativeCombatPort para validação |
| `ServerHitFacts`, `CombatApplication`, `CombatReceipt` | Facts/recibo: host; resultado calculado: owner certificado do servidor | Damage/NativeCombatPort |
| `DeathParticipant`, `NativeDeathFact` | Evento aceito pelo host, enriquecido com geração e identidade | Enemy/Leveling, com deduplicação durável downstream |
| `InventoryItemChange`, `InventoryTransaction`, `InventoryReservation` | Pedido: domínio autorizado; reserva: transaction-service existente | InventoryTransactionPort/owner único de inventário e ouro |
| `ClockReading`, `RngRequest` | Clock do host; solicitação RNG pelo Core | Runtime e cálculo em memória |

## Identidade e wire format

`ProfileKey` e `CharacterKey` são strings opacas com brands distintos. Prefixos dos exemplos não são requisitos do schema. D1 permanece `PROPOSED`: o pacote não escolhe tabela, UUID ou cardinalidade de personagens por perfil. `ActorRef` contém um `RuntimeFormId` numérico e só vale dentro do binding e de seu `epoch`. O host deve gerar epochs que não sejam reutilizados após reconnect, troca de personagem ou restart. Não persistir actorId/userId como identidade de personagem.

`StableFormKey` usa o **plugin de definição**, em minúsculas, seguido de `|` e seis dígitos hexadecimais locais em maiúsculas: `skyrim.esm|012EB7`. O plugin vencedor do override fica em `CatalogEntry.winnerPlugin`; não muda a identidade do record.

`createStableFormKey(plugin, localFormId, pluginKind)`, `parseStableFormKey(text, pluginKind)`, `formatStableFormKey(key, pluginKind)` e `stableFormKeyParts(key, pluginKind)` validam sem mascarar/truncar FormIDs. O parser aceita caixa não canônica e devolve a forma canônica; o schema de transporte aceita apenas a forma canônica.

| Metadata do plugin de definição | Faixa local, inclusive | Exemplo |
|---|---|---|
| `FULL` (ESM/ESP) | `000001`–`FFFFFF` (24 bits) | `mundus.esp|ABC123` |
| `LIGHT` (ESL/ESPFE/ESM com flag leve) | `000001`–`000FFF` (12 bits úteis) | `lightflagged.esp|000801` |

Zero representa referência nula e é rejeitado. `PluginKind` deve vir do metadata confiável do catálogo: a extensão `.esp`/`.esm` não revela o flag leve. `.esl` exige `LIGHT`. Um FormID runtime como `FE001801` não é aceito pelo codec como id local. Um id runtime do índice completo zero é numericamente indistinguível de um id local; sua origem precisa ser verificada pelo resolver. Brands impedem atribuir número/string crus ou `RuntimeFormId` a `StableFormKey`, mas não substituem validação nem tornam um cast TypeScript seguro.

## Revisões, grants e resultados

Cada componente de `RevisionVector` é um inteiro seguro não negativo; zero é inicial. A política proposta compara vetores componente a componente: vetor menor/igual em todos os componentes e menor em algum é antigo; um maior em algum e menor em outro é incomparável. Publish recusa ambos. Vetor igual exige conjunto igual; vetor posterior exige snapshot coerente. Não somar componentes nem traduzir uma revisão escalar antiga para todos eles.

`GrantSet` contém a composição completa para `characterKey`. A identidade de cada concessão é `(kind, definition, source.kind, source.key)`, com revisão e rank como estado. Outra origem pode conceder a mesma definição. Revogar uma origem conserva as outras e os grants nativos. `perk` exige `PERK` e rank `1..255`; `spell`, `ability` e `power` referenciam `SPEL`; `modifier` referencia um record e declara `owner`, cuja semântica precisa de certificação. O schema não distingue subtipos SPEL: isso depende do catálogo.

Publish envia binding + conjunto completo por revisão; o cliente reconcilia diferenças. Conjunto vazio revoga somente as concessões gerenciadas pelo port. Não há operação remove-all. `ProjectionReceipt` confirma a publicação, e `GrantProjectionAck` confirma apenas entrega reportada pelo cliente para o binding/revisão exatos. Nenhum deles confirma commit de fatos duráveis nem resultado de gameplay.

`accepted` é sucesso durável após commit; `pending` declara resolução ainda pendente; `conflict` inclui a revisão atual; `rejected` inclui motivo. Eventos duráveis só saem da outbox após commit. IDs e razões não podem ser vazios. Payloads genéricos de comandos/eventos são JSON e profundamente readonly; o domínio deve validar seu schema específico e impedir resultados finais vindos do cliente.

## Garantias dos ports

Cada método declara em [src/ports.ts](src/ports.ts) a garantia exigida do host e seus limites.

| Port | Garantia exigida / limite |
|---|---|
| `IdentityPort` | Lookup autenticado ou `UNSUPPORTED`; `isCurrent` verifica binding inteiro, sem reservar sessão. Revalidar após await. |
| `RecordCatalogPort` | Winner e assinatura reconciliados, lookup/resolução em memória; FF/dinâmicos ou divergências são `UNSUPPORTED`. Existência não certifica semântica. |
| `GrantProjectionPort` | Conjunto completo por origem/revisão, reconciliação por diferença e ACK autenticado. Retry/timeout ficam com runtime. |
| `ResourcePort` | Snapshot absoluto coerente e aplicação síncrona/idempotente na sessão pelo único owner runtime. Percentual cliente não certifica authority; não é commit de banco. |
| `NativeCombatPort` | Valida evidência, avalia condições e aplica uma vez por hit/pedido, em memória e sem I/O. Flags cliente não viram facts. Shadow não aplica. |
| `NativeDeathPort` | Evento de origem host com eventId estável, geração e sequência; killer null é sem crédito. Não concede XP nem garante commit/exactly-once. |
| `InventoryTransactionPort` | Delega prepare/commit/recover/cancel ao transaction-service e seu pool/ledger. Entrega nativa deve ser recuperável; falha não vira sucesso. |
| `ClockPort` | Leitura em memória; monotônico apenas na geração, wall clock pode saltar. |
| `RngPort` | Valor em `[0,1)`, reproduzível por seed/versão do servidor + stream + draw index, ou `UNSUPPORTED`. |

`ConditionResult` é `TRUE | FALSE | UNSUPPORTED | INVALID`. O avaliador atual do host, que aceita função desconhecida como verdadeira, não satisfaz o port. `ClientHitEvidence` contém ocorrência, referências runtime e quatro flags; não aceita dano/cura/XP/duração finais. `ServerHitFacts` afirma somente os cinco checks explicitados, sem afirmar verdade das flags, alcance real ou semântica de DLL.

## Schemas e validação

Os 50 schemas públicos em `schemas/*.schema.json` usam JSON Schema Draft-07. Os `$id` sob `https://aetherius.invalid/contracts/v1/` são identificadores locais, não endpoints. `grant-set.schema.json` contém as definições comuns; os demais referenciam esse documento. Registre todos no validador antes de resolver `$ref` (exemplo executável em [tests/schemas.test.mjs](tests/schemas.test.mjs)). Não é necessária rede.

DTOs fechados rejeitam propriedades extras; objetos JSON genéricos de payload/data/extraData permanecem abertos. `PortResult` é genérico: seu schema valida o envelope com um valor JSON; o consumidor precisa especializar/validar `value`. `CatalogEntry` aplica o limite LIGHT com metadata; `StableFormKey` isolado não detecta ESPFE pelo nome.

Schemas não provam autenticação, provenance verdadeira, commit, metadata instalado, ACK correspondente ao publish, igualdade entre characterKey do binding/set, unicidade de grants pela chave composta quando seus outros campos diferem, revisão coerente, `current <= maximum` ou intervalo da resposta RNG. `uniqueItems` em grants rejeita duplicatas JSON exatas. Essas invariantes exigem validação semântica no futuro adapter/owner; A5 não implementa esses ports. Também não transforma marca `SERVER_VALIDATED` enviada por um cliente em fato confiável.

## Executar os checks

Dependências de desenvolvimento: TypeScript `5.9.3` e Ajv `8.20.0`, com lockfile dentro deste pacote. Para instalar sem alterar configuração ou lockfile da raiz:

```powershell
cd AetheriusGameplayCore/shared/contracts
npm ci --workspaces=false --ignore-scripts --no-audit --no-fund
cd ../..
npm run typecheck
cd shared/contracts
npm test
```

O typecheck inclui [tests/types.test.ts](tests/types.test.ts), com `@ts-expect-error` para identidades incompatíveis e mutação de DTOs. `npm test` compila para `.test-build/` e executa somente os testes `.mjs`: os testes de tipo não são executados como JavaScript. As fixtures cobrem cada schema com um exemplo válido e outro inválido, além das variantes, limites e separação de autoridade. `.test-build/`, `node_modules/` e `.npm-cache/` são ignorados dentro do pacote. Nenhum módulo existente integra o workspace `shared/*`.
