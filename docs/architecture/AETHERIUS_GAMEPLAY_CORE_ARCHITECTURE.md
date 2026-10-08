# AetheriusGameplayCore — Arquitetura Canônica

Data da decisão: **05/10/2026**  
Status: **fonte normativa de arquitetura e implementação**

Este documento define a arquitetura alvo do AetheriusGameplayCore para os módulos atuais e para os sistemas adicionados no futuro. Quando houver conflito entre este documento e planejamentos, auditorias ou decisões anteriores, **este documento prevalece nas decisões arquiteturais**. Evidências factuais, catálogos, medições e resultados de testes antigos continuam válidos enquanto não forem substituídos por evidência mais recente.

O objetivo não é concentrar todo o gameplay em um módulo monolítico. O objetivo é permitir que todos os sistemas evoluam no mesmo monorepo com **fronteiras claras, ownership único, contratos estáveis e integração autoritativa com o host SkyMP/Aetherius**.

---

## 1. Objetivo arquitetural

O AetheriusGameplayCore é o núcleo de domínio do servidor. Ele deve:

- concentrar regras e estado de gameplay que precisam evoluir de forma coordenada;
- impedir que dois módulos sejam authority do mesmo fato;
- permitir que módulos atuais e futuros compartilhem contratos sem compartilhar implementação interna;
- manter a UI como projeção e entrada de intenção, nunca como authority;
- manter o cliente não confiável para valores finais de gameplay;
- usar PostgreSQL para fatos duráveis, ledgers e comandos econômicos;
- usar memória/snapshots para hot paths de combate;
- integrar-se ao SkyMP por uma camada pública e versionada de Host APIs;
- permitir rollout, rollback e evolução por feature sem ativar todos os sistemas ao mesmo tempo.

A arquitetura deve continuar funcional quando novos domínios forem adicionados, sem obrigar Damage, Class, Enemy ou qualquer outro módulo a conhecer detalhes internos desses novos domínios.

---

## 2. Topologia canônica

```text
 Skyrim / SkyMP / Aetherius runtime
              |
              v
      Aetherius Host API
   (ports públicos versionados)
              |
      +-------+--------+
      |                |
      v                v
 Runtime/Identity   World/Inventory/
 Capability Gate   Combat/Death/Effects
      |                |
      +-------+--------+
              |
              v
        GameplayCore
              |
    +---------+----------+------------------+
    |         |          |                  |
 Record    ActorState   Domain Modules    Persistence
 Catalog   Composer     Class/Enemy/...   PostgreSQL
    |         |          |                  |
    +---------+----------+------------------+
              |
              v
        Read Models / Commands
              |
              v
        AetheriusUI_Core
              |
              v
        Meridian / Client UI
```

O GameplayCore contém a regra. O Host API fornece capacidades do runtime. O UI Core apresenta estado e envia intenções.

---

## 3. Invariantes

Estas regras não devem ser violadas por implementações locais:

1. **Servidor decide.** O cliente pode enviar intenção e evidência não confiável; não envia XP final, skill final, damage final, grant final ou authority.
2. **Um fato, um writer.** Cada estado mutável possui exatamente um owner.
3. **Toda concessão conhece sua origem.** Perks, spells, abilities, powers e efeitos removíveis usam provenance.
4. **Remoção é por origem.** Nunca remover globalmente um efeito porque uma única origem deixou de concedê-lo.
5. **StableFormKey é identidade persistente.** Runtime FormID não é chave persistente.
6. **Winning records e runtime layers importam.** O catálogo usado pela feature precisa corresponder à release.
7. **Hot path não faz I/O.** Hit/effect evaluation não consulta PostgreSQL, arquivo ou rede.
8. **Mutações duráveis são idempotentes.** Retry não duplica XP, consumo, grant ou efeito econômico.
9. **UI não possui gameplay state.** Ela recebe read models revisionados e envia commands.
10. **Capabilities são provadas.** Ausência de capability é `unsupported`, não fallback silencioso.
11. **Rollout é por feature.** `off -> audit -> shadow -> canary -> active`.
12. **Nenhum módulo acessa internals privados de outro módulo ou do host como contrato permanente.**

---

## 4. Aetherius Host API

A antiga regra de manter `aetherius-server` e `aetherius-client` absolutamente intocados **não é mais um invariante**.

Alterações nesses repositórios são permitidas e esperadas quando forem necessárias para expor capacidades fundamentais ao GameplayCore, desde que:

- criem ou ampliem uma **API pública, mínima e versionada**;
- mantenham a lógica de gameplay no GameplayCore;
- façam o host expor fatos/capacidades do runtime e aplicar resultados autorizados;
- não usem monkey patch, singleton privado, emitter privado ou ABI informal como contrato de produção;
- possuam baseline/commit explícito, testes de integração e capability report;
- façam o adapter do GameplayCore depender apenas da API publicada;
- não transformem o cliente em authority.

### 4.1 Ports fundamentais

| Port | Responsabilidade |
|---|---|
| `IdentityPort` | personagem autenticado, sessão, actor binding e epoch |
| `WorldSnapshotPort` | posição/célula/location e contexto autorizado |
| `NativeCombatPort` | eventos de hit autorizados, contexto de ataque e aplicação única do resultado |
| `NativeDeathPort` | morte, killer/credit, spawn generation e sequência autorizadas |
| `InventoryTransactionPort` | item instance, prepare/commit/recover/cancel idempotentes |
| `EquipmentPort` | snapshot de equipamento pertencente ao ator |
| `ResourcePort` | health/magicka/stamina com mutation idempotente |
| `SpellProjectionPort` | reconciliação source-aware de learned spells/abilities/powers |
| `ActiveEffectsPort` | integração exclusiva com o store de efeitos escolhido |
| `ClockPort` | tempo monotônico/servidor |
| `RngPort` | RNG server-side reproduzível onde necessário |
| `UiTransportPort` | transporte autenticado de intenção/read models |

A disponibilidade de cada port é registrada em `CapabilityReport`. Uma feature não se torna active apenas porque existe um método com nome parecido: a semântica precisa ser demonstrada.

---

## 5. Shared Kernel do GameplayCore

O núcleo compartilhado deve permanecer pequeno.

### 5.1 `shared/contracts`

Contém apenas contratos necessários entre domínios: StableFormKey, ActorRef/ActorKey, revision vectors, command/event envelopes, ports, DTOs de projection e capabilities. Nenhum domínio publica seus objetos mutáveis internos.

### 5.2 `shared/record-catalog`

É a autoridade de definitions provenientes da load order:

```text
plugins + masters + hashes + runtime layers
                  |
                  v
           RecordCatalog
                  |
      +-----------+-----------+
      |           |           |
    forms      winners    conditions/effects
      |           |           |
      +-----------+-----------+
                  |
                  v
       immutable definitions
```

Housecarl e outras ferramentas são adapters de authoring/auditoria; o servidor não depende delas por hit.

### 5.3 `shared/persistence`

Fornece pool PostgreSQL, UnitOfWork, repositories transacionais, command ledger, outbox/inbox, migrations, locks/constraints/retry. Não é um ORM global que permite qualquer módulo escrever em qualquer tabela.

### 5.4 `runtime`

Responsável por bootstrap, capability negotiation, session/epoch, lifecycle/dispose, feature flags, readiness e binding dos Host Ports.

---

## 6. Ownership dos domínios atuais

| Estado / responsabilidade | Owner |
|---|---|
| escolha de classe, alocação e milestones de classe | Class |
| XP total, character level, fatigue e reward policy | Leveling |
| composição de skills/grants/atributos efetivos | ActorState |
| definitions de records | RecordCatalog |
| ActorCombatState / cálculo de combate | Damage |
| active effects após cutover | store único integrado ao Damage |
| classificação, templates, spawn e generation de NPC | Enemy |
| manutenção, cargas, cobertura e material policy | Durability |
| inventário e item instances | Host Inventory |
| health/magicka/stamina runtime | Host Resource, salvo delegação explícita |
| party/raid atual | Class Party Service como owner transitório, exposto por port |
| read models e revisions de UI | Gameplay UI Projection |
| transporte/UI shell | AetheriusUI_Core + Host UI transport |

Party/raid não deve virar dependência interna de Class para consumidores. Enquanto permanecer fisicamente no ClassSystem, deve ser consumido por contrato/port para permitir futura extração.

---

## 7. ActorState

ActorState é **compositor**, não um segundo engine de combate.

```text
Class
Race / Standing Stone
Learned acquisitions
Quest grants
Equipment
Enemy/NPC definitions
Temporary providers
        |
        v
   ActorState.compose()
        |
        +--> ActorReadModel
        |
        +--> CombatProfileProjection
                  |
                  v
           ActorCombatState
```

`compose()` deve ser puro: sem DB, sem UI e sem I/O.

A projeção para C++ deve ser imutável e publicada atomicamente. Um hit usa uma única revisão coerente de facts, grants, equipment, effects, providers e catalog; não mistura revisões parciais.

---

## 8. Grants e provenance

O modelo canônico diferencia **fatos persistentes** de **grants reconstruíveis**.

### Persistir como fatos

- classe escolhida;
- race/stone escolhidas;
- spell realmente aprendida;
- quest acquisition;
- grant administrativo;
- progressão/XP;
- alocação;
- transformação/doença quando o domínio exigir histórico durável.

### Reconstruir a partir de definitions

- grants automáticos de CLASS;
- grants automáticos de RACE;
- standing stone;
- equipment;
- NPC definition.

Esses grants podem ter checkpoint/ledger de auditoria, mas não devem depender de uma cópia stale no banco para existir.

A união é sempre por origem. Remover `CLASS:X` não remove `QUEST:X`.

---

## 9. Commands, events e persistência

### Commands

Toda mutação externa deve possuir actor autenticado pelo transporte, `requestId`, payload validado, `expectedRevision` quando aplicável, idempotência e resultado `accepted/rejected/conflict/pending`.

### Events

Eventos internos representam fatos já aceitos:

```text
command
  |
  v
UnitOfWork
  +-- state mutation
  +-- ledger
  +-- outbox
  |
 COMMIT
  |
  v
domain event
```

Handlers são idempotentes. Event bus não substitui owner nem banco.

### Economia

XP, consumo, crafting, trade, kits, compras e qualquer valor econômico precisam de ledger/transaction ou de protocolo prepare/commit/recover com o owner externo.

---

## 10. Compatibilidade

Existem três assinaturas globais: `definitionSignature`, `hostCapabilitySignature` e `presentationSignature`.

Além delas, cada feature deve possuir uma **FeatureCompatibilitySignature** calculada sobre suas dependências transitivas relevantes.

Uma mudança cosmética não deve desligar combate. Uma mudança em PERK/MGEF/WEAP relevante pode bloquear somente as features afetadas. O manifesto global continua existindo para auditoria da release.

---

## 11. UI

A UI pode ser implementada incrementalmente antes do domínio estar active.

Estados permitidos:

- read-only;
- preview;
- command enabled;
- unavailable com reason.

A existência de botão não habilita capability.

```text
UI intent
   |
UiTransport
   |
Command Router
   |
Domain owner
   |
commit
   |
Read Model revision
   |
UI
```

Frontend nunca escreve diretamente XP, atributos, perks, inventory state ou damage.

---

## 12. Regra para qualquer sistema futuro

Todo novo sistema deve preencher este contrato antes de ser integrado:

| Pergunta | Obrigatório |
|---|---|
| Qual problema/domínio resolve? | sim |
| Qual fato ele possui como único writer? | sim |
| Quais facts apenas consome? | sim |
| Quais Host Ports exige? | sim |
| Quais contratos compartilha? | sim |
| O que é Persisted / Derived / Runtime / Definition? | sim |
| Quais commands recebe? | sim |
| Quais events publica/consome? | sim |
| Quais tabelas/migrations possui? | quando durável |
| Qual read model/UI expõe? | quando houver UI |
| Qual FeatureCompatibilitySignature usa? | sim |
| Quais blockers/capabilities existem? | sim |
| Como funciona shadow/canary/rollback? | sim |
| Quais unit/golden/integration/E2E tests provam a feature? | sim |

Se um módulo precisa escrever um fato que já possui owner, ele deve enviar command ao owner ou propor formalmente uma transferência de ownership. Não criar segundo writer.

A regra vale igualmente para sistemas futuros como profissões, crafting/refino, alquimia, encantamento, comércio, economia, propriedade, necessidades, reputação ou novos sistemas de combate.

---

## 13. Ordem de implementação

> [!IMPORTANT]
> **Substituída em 07/10/2026.** A ordem vigente está em [adr/D7-ordem-de-implementacao.md](adr/D7-ordem-de-implementacao.md), e as demais decisões em [adr/README.md](adr/README.md). O escopo foi reduzido ao suporte dos efeitos de raças, pedras guardiãs, classes, religião, perks, feitiços e dano; inventário, economia, painel e os serviços legados do gamemode ficaram fora. Onde este documento fala em `ActorKey`, `SpellProjectionPort`, `InventoryTransactionPort` ou em `shared/persistence` fornecer o pool, valem `CharacterKey`, `GrantProjectionPort`, ausência de port de inventário e o pool já existente do gamemode. O diagrama abaixo é histórico.

```text
F0  Baseline + manifest + characterization
 |
F1  Host Integration API + capability probes
 |
F2  Shared contracts + RecordCatalog
 |
F3  PostgreSQL kernel + UnitOfWork/ledger/outbox
 |
F4  ActorState + Class facts/grants/composition
 |
 +-------> F5 Enemy
 |          |
 +-------> F6 Conditions
            |
            +----+
                 |
F7  Leveling / authoritative death pipeline
F8  Durability / inventory transaction pipeline
F9  Physical Damage cutover
F10 Magic subsets / enchantment / alchemy as capabilities allow
F12 Homologation / load / cutover / rollback
```

UI não é uma etapa final linear. Ela evolui em paralelo:

- após F1: transporte/readiness;
- após F4: Class/Actor;
- após F5: Enemy/Bestiary;
- após F7: Progression;
- após F8: Maintenance;
- após F10: Spells/effects.

---

## 14. Reinterpretação dos blockers históricos

| Blocker histórico | Tratamento canônico |
|---|---|
| B01 load order | reconciliar manifest/runtime e manter gate |
| B02 combat/effects | implementar/validar Host Combat/Effects API |
| B03 remove-all spells | substituir por SpellProjection source-aware |
| B04 death authority | implementar NativeDeathPort |
| B05 inventory atomicity | implementar InventoryTransactionPort |
| B06 runtime overlays | política de equivalência + signatures por feature |
| B07 coverage | concluir records alcançáveis pela feature |
| B08 E2E/runtime/DB | homologação obrigatória |

"Host API necessária" não é autorização para inserir lógica de gameplay no host. É autorização para criar a extensão pública mínima que o Core precisa.

---

## 15. Estado conhecido em 05/10/2026

A integração de UI já provou transporte e projeções read-only para partes do ClassSystem e expôs alterações controladas de runtime em baselines explícitas de server/client/Meridian.

Isso **não** significa que a arquitetura completa esteja ativa. ActorState ainda precisa ser concluído; Damage/Durability não estão em cutover autoritativo; Leveling não deve coexistir com writer legado; mutações de Class/Party/Inventory continuam dependentes das capabilities correspondentes.

O trabalho futuro deve avançar pela ordem de dependências acima, sem ativar seis módulos simultaneamente.

---

## 16. Precedência documental

Use esta ordem ao consultar o repositório:

1. **Este documento** — decisões arquiteturais atuais.
2. `docs/audit/2026-10-02/IMPLEMENTATION_PHASES.md` — fases detalhadas, ajustadas à política canônica.
3. `docs/ui-integration/CURRENT_STATE.md` e `REMAINING_IMPLEMENTATION.md` — estado real da integração UI.
4. `docs/mechanics/**` — mecânicas, cobertura e evidências.
5. `AETHERIUS_GAMEPLAY_CORE_PLANEJAMENTO_HOLISTICO.md` — auditoria histórica e evidências de 02/10; não prevalece quando uma regra arquitetural foi superada aqui.
6. `docs/audit/2026-10-02/**` — snapshots e evidências históricas.

Ao atualizar uma decisão arquitetural no futuro, alterar primeiro este documento e depois adicionar notas de supersessão nos documentos afetados. Não apagar evidência histórica para fazê-la parecer atual.
