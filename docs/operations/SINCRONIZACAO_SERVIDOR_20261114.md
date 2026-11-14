# Sincronização com o servidor oficial — 14/11/2026

Segunda volta do código de `server/gameplay/core` do `aetherius-server` para este repositório (a primeira está em
`SINCRONIZACAO_SERVIDOR_20261102.md`). Base: espelho local do `AetheriusRP/aetherius-server` de 13/11/2026
(entrega v0.37.0; o espelho não traz o hash do commit), comparado arquivo a arquivo com `efe7e4c`.

## O que voltou para o Core

| Arquivos aqui | O que é |
|---|---|
| `runtime/src/class-skills.ts` (novo), `modules/class-progression-system/src/skills.ts` (novo), `tools/catalog/classes.ts`, `runtime/src/index.ts`, `runtime/tests/class-skills-delivery.test.mjs` (novo) | skills de classe entregues ao cliente pelo `ClientDelivery`, sob o mesmo modo/canário de `classes`; `CLASS_SKILL_NAMES` passa a morar no módulo de progressão |
| `runtime/src/summon-capacity.ts` (novo), `runtime/src/index.ts`, `runtime/tests/summon-capacity.test.mjs` (novo) | projeção de capacidade de invocação a partir de classe, raça e pedra |
| `modules/class-progression-system/src/index.ts`, `modules/leveling-system/src/persistence/durable.ts`, `runtime/src/classes.ts` | comando `class.level` do painel da staff: fixa o nível com XP coerente com a curva e zera os atributos se o novo nível der menos pontos que os gastos |
| `modules/class-system/config/classes-config.json`, `ui/data/classes-config.json`, `ui/js/embedded-data.js`, `runtime/tests/classes.unit.test.mjs` | Anti-Mago recebe a Maestria em Conjuração no nível 1 (pré-requisito do Mystic Binding no nível 10) |
| `shared/persistence/src/transaction.ts`, `src/index.ts`, `tests/unit.test.mjs`, `runtime/src/index.ts` (`professionPersistence`) | chaves `character:<uuid>` aceitas, com lock em namespace próprio; os locks `profile:N` não mudam |
| `database/migrations/0013_gc_professions_uuid_v2.sql`, `0014_gc_profession_world.sql` | tabelas `gc_profession_*` do sistema de profissões do servidor, trazidas para manter a numeração alinhada |
| `runtime/tests/combat.test.mjs` | `Item.Count` do NPC comparado ao export atual em vez de exigir a lacuna do export antigo; vale para os dois catálogos |

## Adaptações em relação ao servidor

- `runtime/src/index.ts`: **sem** `export * as professionApi from '../../../professions/src/index.ts'`. O módulo de
  profissões vive fora do Core (`server/gameplay/professions`); o import quebraria o build deste repositório isolado.
  O host do servidor continua com a linha.
- `runtime/tests/class-skills-delivery.test.mjs`: o caminho do cliente usa a convenção dos outros testes daqui
  (`new URL('../../../', import.meta.url)`, cliente irmão do Core) em vez do layout `server/gameplay/core` do servidor.
- `0013_gc_professions_uuid_v2.sql` está em CRLF no servidor e entra aqui em LF (`.gitattributes`). O hash gravado
  em `gc_schema_migrations` é dos bytes crus: um banco migrado pelo servidor e depois apontado para este repositório
  acusa divergência nessa migration até que os dois lados usem o mesmo fim de linha.

## O que ficou de fora, e por quê

- **Catálogos (`catalog/*.json`, release v0.37.0)**: continuam assinados para os masters da máquina de desenvolvimento,
  por decisão do dono (14/11). O teste novo do Anti-Mago em `classes.unit.test.mjs` confere a perk no catálogo de
  classes; com o catálogo daqui ele ainda não foi exercitado (o arquivo inteiro falha nesta máquina por falta dos
  exports, antes e depois da sincronização).
- **Arquivos em que o servidor está atrás do Core** (a cópia do servidor ainda é anterior ao SYNC-1102):
  `ds5a/Host.h` e `aetherius_combat/README.md` (sem a DS-7 `hitSeq`), `combat-profile-projection.test.mjs` e
  `leveling-system/tests/config-and-catalog.test.mjs` (sem a correção `41e8334`). Ficam as versões daqui.
- **`.gitattributes` (`* -text`) e `PROVENANCE.md`** da cópia: próprios do repositório do servidor.

## Testes nesta máquina

`npm run typecheck`: 6 erros em `runtime/src/combat-profile.ts`, os mesmos antes e depois (arquivo não alterado).

`npm test`, com `modules/damage-system/compiler` compilado antes e `GAMEPLAY_CORE_TEST_EXPORTS`/`GAMEPLAY_CORE_TEST_DATA_DIR`
apontando para pastas vazias (exports do houseCARL e `dist` do servidor não existem nesta máquina), cliente e servidor
oficiais como irmãos do Core:

| Árvore | Testes | Passam | Falham |
|---|---:|---:|---:|
| `efe7e4c` limpo | 365 | 334 | 26 |
| depois da sincronização | 381 | 350 | 26 |

As 26 falhas são as mesmas nas duas árvores (todas por falta dos exports/dados acima). Os 16 testes novos passam.
