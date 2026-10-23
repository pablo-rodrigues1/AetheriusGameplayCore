# AetheriusEnemySystem

> [!IMPORTANT]
> O domínio e as regras de Enemy permanecem válidos, mas ownership, persistência, Host Ports e integração com Leveling devem seguir [a arquitetura canônica](../../docs/architecture/AETHERIUS_GAMEPLAY_CORE_ARCHITECTURE.md). Eventos de morte só se tornam econômicos quando originados do `NativeDeathPort` autorizado.

Sistema server-authoritative de inimigos, encontros e dungeons para servidores Skyrim baseados em SkyMP.

O projeto descobre conteúdo vanilla, DLC, Creation Club e mods diretamente da load order ativa do Mod Organizer 2. Ele não depende de índices fixos: cada registro é persistido como `plugin de origem + FormID local`, e o FormID de runtime é resolvido pelo host somente no momento de uso. Assim, alterar a posição de um plugin não invalida as identidades salvas.

> Estado: camada de domínio e integração em desenvolvimento. Os contratos, a descoberta, o resolvedor de spawn e a integração de categorias com o AetheriusLevelingSystem estão implementados; a conexão com o servidor definitivo e a validação multiplayer serão realizadas no projeto de integração.

## Como o sistema funciona

1. O houseCARL lê a instância ativa do MO2 e fornece os registros vencedores da load order.
2. O catálogo global identifica dungeons por `LCTN`, `CELL`, keywords, encounter zones e evidências adicionais configuráveis para mods que omitem metadados padrão.
3. NPCs são classificados por raça, facção, arquétipo, listas `LVLN` e evidências dos registros vencedores.
4. Cada dungeon recebe uma faixa de dificuldade, níveis de inimigos e contexto recomendado de Character Level.
5. O servidor escolhe spawns de forma determinística por identidade, geração e pesos derivados das listas originais.
6. Reconexões reutilizam a decisão persistida. Um novo sorteio ocorre somente em uma nova geração/reset.
7. Eventos de morte são idempotentes e entregam contexto ao AetheriusLevelingSystem, sem calcular XP dentro deste projeto.

```text
MO2 ativo
   ↓
houseCARL — vencedores reais da load order
   ↓
identidades canônicas + catálogo global de dungeons
   ↓
classificação de inimigos + alcance LVLN
   ↓
resolvedor determinístico por geração
   ↓
adaptadores futuros: SkyMP, Leveling, Loot e persistência
```

## Cobertura de dungeons

A descoberta não contém uma lista fixa de plugins. Ela inclui:

- Skyrim, DLCs e Creation Club;
- dungeons adicionadas por mods ativos;
- localizações com `LocTypeDungeon`;
- locais comprovados por arquétipos como Draugr, vampiros, Dwemer, bandidos, Falmer e Dragon Priests;
- interiores clearable com encounter zones;
- exceções verificadas em `config/dungeon-discovery-overrides.json` para mods sem metadados padrão.

| Tier | Enemy Combat Level | Alvo | Character Level recomendado |
| --- | ---: | ---: | ---: |
| `EASY` | 1–15 | 8 | 1–10 |
| `MEDIUM` | 15–30 | 22 | 10–20 |
| `HARD` | 25–50 | 37 | 20–30 |
| `VERY_HARD` | 40–100 | 70 | 30–40 |

Dragon Priests sempre tornam a dungeon `VERY_HARD`. Dungeons Dwemer são `HARD`; vampiros predominantes são `VERY_HARD`; covis de bandidos ficam entre `EASY` e `MEDIUM`; criptas Draugr variam conforme o conteúdo.

## Independência da load order

O sistema nunca persiste `XX######` nem índices `FE`. Esses valores pertencem apenas à load order atual. A identidade estável usa:

```text
PluginDeOrigem.esp|00ABCD
```

O adaptador do host recebe essa identidade e resolve o FormID de runtime contra a load order ativa. Snapshots de epochs diferentes são recusados para impedir que dados antigos sejam combinados silenciosamente com uma modlist alterada.

## Spawn e persistência

> **Preflight preventivo de posicionamento (23/10/2026):** `src/spawning/location.mjs` valida as referências `ACHR` e converte posição/rotação do catálogo (`{x,y,z}`) em arrays (`[x,y,z]`) exigidos pelo SkyMP. O adapter só encaminha ao hook do host uma localização de registro original após a resolução explícita de `cellOrWorldDesc`; dados ausentes ou inválidos bloqueiam a operação sem fallback para a posição do jogador. O readiness passa a reprovar `DUNGEON_SPAWN_LOCATION_INVALID`. Ver [contrato de integração com o SkyMP](docs/SKYMP_RUNTIME_INTEGRATION.md). **Não equivale a integração ativa nem a validação em jogo.** Testes unitários: `tests/spawn-location.test.mjs`.

- Seleção determinística no servidor.
- Pesos preservados das quantidades e caminhos originais das `LVLN`.
- Listas aninhadas, `Chance None`, thresholds, multiplicidade e ciclos são analisados.
- Um inimigo sem peso comprovado não recebe probabilidade uniforme inventada.
- A resolução permanece estável durante a mesma geração e após reconexões.
- NPCs únicos podem ser tratados por políticas explícitas de boss.

## Integrações

O projeto fornece portas neutras, sem importar símbolos privados de uma implementação específica do SkyMP:

- resolução de FormIDs canônicos;
- spawn e morte no servidor;
- persistência e reconexão;
- início de geração e reset de dungeon;
- eventos para o AetheriusLevelingSystem;
- delegação para o futuro AetheriusLootSystem.

Até o sistema de loot dedicado existir, a composição original é restaurada somente em uma nova geração/reset da dungeon. Não há restauração adicional dentro da mesma geração.

O Leveling fornece ao `EnemyScanner` um contrato gerado de seus perfis JSON ativos. Assim, as categorias aprovadas e famílias adicionadas por mods entram sem alterar uma enumeração no código. O Enemy System valida apenas a chave exata em `snake_case`; o Leveling continua sendo a única autoridade dos valores de XP. Ice Wraith e Thalmor são categorias MEDIUM aprovadas e possuem evidências semânticas verificadas na load order real.

## Estrutura

```text
src/adapters/             portas para o host SkyMP
src/dungeons/             descoberta, classificação e perfis
src/enemies/              registro e elegibilidade de inimigos
src/leveled-lists/        análise e resolução de LVLN
src/spawning/             seleção determinística por geração
src/persistence/          fronteira de persistência
src/events/               eventos idempotentes de morte
src/loot-integration/     contrato do futuro sistema de loot
src/leveling-integration/ contrato do futuro sistema de leveling
scripts/                  importação, geração e validação
config/                   regras autorais e overrides verificáveis
tests/                    testes unitários e de regressão
```

## Requisitos

- Node.js 22 ou mais recente;
- uma instância do Mod Organizer 2 para gerar evidências reais;
- houseCARL MCP para leitura dos vencedores da load order.

O núcleo não possui dependências npm de runtime.

## Validação local

```bash
npm run build
npm test
npm run verify:boundary
```

Fluxo de geração com snapshots houseCARL disponíveis:

```bash
npm run prepare:dungeon-seeds
npm run import:dungeons
npm run import:housecarl
npm run reports
npm run readiness
```

`prepare:dungeon-seeds` aplica a mesma política do importador e gera `all-dungeon-cells-winners.jsonl` e `all-dungeon-locations-winners.jsonl`. O enriquecimento global usa, no mesmo epoch desses arquivos:

- `all-dungeon-placed-npcs-winners.jsonl`: todos os `ACHR` cujas células ou localizações pertencem ao catálogo global;
- `all-dungeon-placed-base-closure-winners.jsonl`: fechamento transitivo das bases `NPC_` e `LVLN` referenciadas por esses `ACHR`.

`import:dungeons` cria o catálogo canônico de toda a load order. `import:housecarl` preserva esse mesmo catálogo e o enriquece com atores colocados, NPCs-base, listas aninhadas, níveis e famílias. Os epochs devem coincidir; dados globais ausentes ou um catálogo restrito são recusados. `scan:dungeons` é apenas diagnóstico e grava `dungeon-candidates.generated.json`, nunca o catálogo canônico.

`npm run readiness` é deliberadamente fail-closed: retorna erro enquanto existirem snapshots desatualizados, referências não resolvidas, divergências entre perfis ou validação multiplayer pendente.

## Limites de responsabilidade

O AetheriusEnemySystem não calcula XP final, progressão de classe, modificadores de grupo, fadiga ou recompensas de loot. Ele fornece identidades, classificação, contexto de encontro e eventos para que sistemas especializados façam esses cálculos.

Snapshots de uma modlist real ficam em `config/generated/` e não fazem parte do repositório. Eles devem ser regenerados no ambiente de destino.

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md)
- [Integração com o sistema de classes/leveling](docs/INTEGRATION_CLASS_SYSTEM.md)
- [Integração com o sistema de loot](docs/INTEGRATION_LOOT_SYSTEM.md)
- [Integração de spawn, morte e ciclo das dungeons com o SkyMP](docs/SKYMP_RUNTIME_INTEGRATION.md)
- [Política dos perfis MO2](docs/MO2_PROFILE_POLICY.md)
- [Patches futuros do host](docs/PATCHES_REQUIRED.md)

## Licença

Distribuído sob a licença [GNU Affero General Public License v3.0](LICENSE).
