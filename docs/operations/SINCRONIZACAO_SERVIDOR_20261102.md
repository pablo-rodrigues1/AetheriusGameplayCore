# Sincronização com o servidor e o cliente oficiais — 02/11/2026

Desde a entrega de 25/10 (`1a7f017`), o Core passou a viver também dentro do `aetherius-server`, em
`server/gameplay/core` (cópia de `1a7f017`, ver o `PROVENANCE.md` de lá), e o mantenedor do servidor
mudou essa cópia e o host. Esta nota registra o que voltou para este repositório e o que ficou de fora.

Bases conferidas: `AetheriusRP/aetherius-server` `8b5d299` (29/10) e `AetheriusRP/aetherius-client`
`16e5a35` (29/10).

## O que voltou para o Core

| Origem no servidor | Arquivos aqui | O que é |
|---|---|---|
| `a40dc1a` DS-5c | `runtime/src/combat-profile.ts`, `runtime/src/index.ts`, `runtime/src/npc-autocalc.ts` (novo), `runtime/tests/npc-autocalc.test.mjs` (novo), `runtime/tools/npc-autocalc-golden.mjs` (novo), `modules/damage-system/compiler/src/compiler.ts`, `modules/damage-system/docs/FONTES_E_DONOS.md`, `modules/damage-system/server/.../ds5a/Rules.h` | motivos da sombra por lado; skills de NPC por AutoCalcStats (travadas até os casos dourados); perks do NPC_ com origem `NPC_RECORD` |
| `5cc788d` DS-7 | `modules/damage-system/server/.../ds5a/Host.h` (só as linhas da DS-7), `.../aetherius_combat/README.md`, `runtime/tests/ds5a-host.mjs` | identidade de golpe: o cliente numera cada golpe (`hitSeq`), o host descarta repetido ou velho antes do cálculo; o trace passa a `HOST_DEDUPED_CLIENT_HIT_SEQ`. `active` continua bloqueado até certificar aplicação com dois clientes |
| PROVENANCE do servidor | `modules/leveling-system/config/enemy-base-xp.json` | perfis `mundo.*` (XP de NPC morto fora de masmorra) |
| PROVENANCE do servidor | `modules/durability-system/config/maintenance-config.json` | `formId` dos 30 kits (`AetheriusManutencao.esp` 000800–00081D) |
| cópia do servidor | `.gitignore` | ignora `dist/` e `runtime/.packages/` |

## O que ficou de fora, e por quê

- **Catálogos (`catalog/*.json`)**: no servidor eles foram reassinados para os masters do servidor oficial
  (`Skyrim.esm` 249.752.131 bytes, `Update.esm` 19.121.864). Aqui continuam assinados para os da máquina de
  desenvolvimento (249.753.412 e 18.874.041). Escolher para qual instalação o repositório assina é decisão
  do dono do projeto; a ferramenta de reassinatura está no servidor (`server/gameplay/core-host/resign-catalog.mts`).
- **Refino de equipamento** no `Host.h` do servidor (`aetherius_combat/Refinement.h`, tier conferido no
  inventário): é crafting, fora do escopo do Core. Aqui o `Host.h` mantém o `NeutralRefinement`.
- **`.gitattributes` e `PROVENANCE.md`** da cópia: são próprios do repositório do servidor.
- **Pacotes `integrations/host` e `integrations/client`**: são a entrega de 25/10 e continuam como estavam
  (hashes do manifesto inalterados). O servidor aplicou o pacote do host em `b84ce03` (26/10) e o do cliente
  em `9a8cdf8` (29/10); desde então o código vivo do host e do cliente é o dos repositórios `AetheriusRP`.
  A parte de cliente da DS-7 (`hitSeq`, `194b6b2` no cliente) e a política de spawn por cidade
  (`server/gameplay/core-host/enemy-catalog/town-exclusions.mjs`, `e5d8ebe`) estão só lá.
- **`AetheriusDamageFormula.*`** em `modules/damage-system/server`: é o protótipo original do módulo, não a
  fórmula em uso; o servidor usa a do pacote DS-5a/5b. Sem mudança.

## Testes nesta máquina

Saídas completas em `_work/evidence/SYNC-1102/` do workspace.

| Árvore | Testes do runtime | Pacotes com falha |
|---|---|---|
| `1a7f017` limpo | 166 / 180 | 2 (`class-system` e o runtime) |
| depois da sincronização | 174 / 189 | 3 (os mesmos + `leveling-system`) |

As 14 falhas da linha de base já existiam antes da sincronização (ambiente desta máquina: bundle ausente no
`dist`, exports e masters locais). A sincronização trouxe **duas falhas novas**, as duas de testes que não
acompanharam uma mudança intencional do servidor:

1. `runtime/tests/combat-profile-projection.test.mjs:375` (“NPC perks distinguish an explicit null list from
   rows that resolve to no perks”): com a DS-5c, uma perk de NPC que não resolve vira uma linha `UNSUPPORTED`
   (`PERK_WINNER_UNAVAILABLE`, origem `NPC_RECORD`); o teste ainda espera lista vazia.
2. `modules/leveling-system` (“entire authorized XP snapshot is represented without silent legacy values”):
   espera 51 perfis; com os perfis `mundo.*` são 100.

Typecheck: sem falhas.

**Corrigido em `41e8334` (SYNC-1102-fix1, Luna 6, revisado pelo Opus 5.5):** os dois testes passaram a afirmar o comportamento novo de forma exata. Depois disso: 175 / 189 no runtime e 2 pacotes com falha, exatamente as mesmas falhas da linha de base `1a7f017` nesta máquina.
