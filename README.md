# AetheriusGameplayCore

Monorepo dos sistemas de gameplay do **Aetherius Roleplay**.

Este repositório consolida os sistemas que precisam evoluir de forma coordenada para o ambiente SkyMP/Aetherius. A migração inicial preservou as baselines; a integração UI descrita abaixo acrescenta alterações ao ClassSystem.

## Arquitetura canônica

A fonte normativa atual para decisões de arquitetura e implementação é [docs/architecture/AETHERIUS_GAMEPLAY_CORE_ARCHITECTURE.md](docs/architecture/AETHERIUS_GAMEPLAY_CORE_ARCHITECTURE.md).

A política transversal de configuração e balanceamento está em [docs/architecture/AETHERIUS_BALANCE_CONFIGURATION_POLICY.md](docs/architecture/AETHERIUS_BALANCE_CONFIGURATION_POLICY.md). Valores numéricos de gameplay/economia — como estoque e cooldown de minas, duração de ciclos, yields, chances, custos de receitas, conversões de materiais, XP/Vigor e parâmetros de refino — devem ser tratados como **defaults configuráveis**, não como constantes rígidas espalhadas pelo código.

O planejamento holístico de 02/10/2026 permanece como auditoria histórica e pacote de evidências. Quando houver conflito de regra arquitetural, prevalece a arquitetura canônica. Em particular, `aetherius-server` e `aetherius-client` podem receber alterações controladas para expor Host APIs públicas, mínimas e versionadas; a lógica de gameplay permanece no GameplayCore.

## Classes, perks e atributos — estado em 13/10/2026

O fluxo **autoritativo de progressão de classes** evoluiu desde a baseline inicial da UI. O código ativo dessa evolução está em `modules/class-progression-system/`, `runtime/src/classes.ts`, `runtime/src/attribute-system.ts` e na composição/projeção compartilhada do GameplayCore. O `modules/class-system/` preserva a implementação anterior de classes, grupos/raids e apresentação Meridian; **não deve ser confundido com o único writer atual de classe, XP ou atributos**.

### Escolha, níveis e marcos de classe (C3a–C3c)

- Catálogo em [`catalog/classes.json`](catalog/classes.json): **18 classes**, com **9 marcos por classe** (níveis 1, 5, 10, 15, 20, 25, 30, 35 e 40), totalizando **162 marcos e 350 entradas de perks**. [Tabela de perks por classe](docs/classes/PERKS_POR_CLASSE.md), regenerável por `node tools/catalog/perks-per-class.mjs`.
- A escolha é persistida pelo comando idempotente `classes.set` em `gc_character_class`; `LevelingSystem` permanece o **único owner de XP, nível e fadiga**, com progresso em `gc_leveling_progress` e recibos no ledger `gc_commands`. Classe compõe grants de origem `CLASS` para os marcos alcançados, sem conceder ranks extras nem pressupor que as conditions nativas tenham sido satisfeitas.
- A entrada interna `core.awardLevelingXp(input)` pode solicitar a atualização dos perks quando um XP autoritativo muda o nível **após o commit**. **Ainda falta conectar uma fonte confiável de XP por abates**; não se deve aceitar relatos de morte provenientes da interface.
- A varredura **C3b/C3c** de todas as classes e marcos é um mecanismo **exclusivo de desenvolvimento**, dependente de sessão/entrega confirmadas e de opções DEV explicitamente autorizadas. Não se destina ao servidor oficial e recusa personagens com progresso ou pontos gastos que seriam zerados.

### Entrega de perks ao jogador (B5b e correções)

- O servidor compõe as concessões por fonte; a projeção envia ao cliente, por **CustomPacket**, apenas o conjunto necessário e exige ACK associado à sessão e à revisão. O estado durável de autoria/entrega está em `gc_perk_projections` (migration 0008). Perks preexistentes ou atribuídos por outras fontes não devem ser removidos arbitrariamente.
- A fila de `PerkDelivery` limita a **uma entrega em andamento por personagem/ciclo**. Uma revisão posterior aguarda o ACK/COMMIT da anterior; timeout ou envio isolado **não equivalem a confirmação**. Consulte [contrato da fila](runtime/src/projection/DELIVERY.md).
- A varredura foi **revalidada em jogo no servidor local em 12/10/2026**, com 162/162 passos `OK`, restauração `OK` e entrega `CONFIRMED`, conforme o [guia de integração](integrations/INSTALL.md). Isso confirma a **entrega de perks**, não a execução de seus efeitos, fórmulas ou condições pelo motor do jogo.

### Pontos de atributo (C3d)

- Ganho de **15 pontos por nível após o primeiro**: `15 × (nível − 1)`, até **585 no nível 40**. Distribuição em **vida, magia e vigor**, por incrementos inteiros não negativos, **múltiplos de 5** e soma positiva; cada ponto acrescenta **1** ao máximo correspondente.
- O comando `attributes.allocate` persiste os gastos em `gc_attribute_allocation` (migration 0009); o saldo é derivado do nível, nunca confiado ao cliente. A escrita é idempotente, serializada por personagem e rejeita gastos inválidos ou acima do disponível.
- **Troca efetiva de classe zera XP, nível e distribuição de pontos na mesma transação**; escolher novamente a mesma classe não zera. Fadiga, ciclo e limite diário são preservados. Esta regra **substitui** a descrição histórica C3a que preservava o progresso ao trocar de classe.
- O bônus normal de máximos usa a propriedade nativa `aetheriusAttributeBonuses` do host (records + pontos gastos), com reidratação em reconexão/prontidão. Sem suporte do host, a capacidade responde `UNSUPPORTED` em vez de simular máximos. A tela utiliza os contratos `core.attributeState(binding)` e `core.allocateAttributes(...)`; **a tela e os três máximos ainda carecem de homologação no servidor oficial**. Consulte o [contrato C3d](docs/classes/ATRIBUTOS_C3d.md).

### Integração e estado de implantação

O pacote instalável atual é descrito em [`integrations/INSTALL.md`](integrations/INSTALL.md), com [patch/fontes do host](integrations/host/LEIA-ME.md), [integração do cliente](integrations/client/LEIA-ME.md) e [ativação, migrations e configuração](docs/operations/ATIVACAO_DOS_SISTEMAS.md). A integração de ponta a ponta **não foi executada no servidor oficial**; não confundir implementação, testes e validação local com implantação de produção.

A integração Meridian/CEF da UI de **CLASSE/GRUPO** verificada em 04/10/2026 foi inicialmente de **consulta**, com mutações bloqueadas pelas capabilities então ausentes. Esse é um **registro histórico** em [estado da integração UI](docs/ui-integration/CURRENT_STATE.md) e [pendências dessa etapa](docs/ui-integration/REMAINING_IMPLEMENTATION.md), não a fotografia das APIs C3a–C3d. O resultado de 49/55 testes refere-se àquela baseline anterior e **não deve ser apresentado como resultado atual de toda a suíte**. As alterações externas de UI permanecem em [`integrations/ui-runtime-changes`](integrations/ui-runtime-changes/README.md); o [guia de compilação das DLLs e UI](docs/ui-integration/BUILD_AND_DLLS.md) documenta essa integração.

## Módulos

O [guia completo de compilação das DLLs e integração UI](docs/ui-integration/BUILD_AND_DLLS.md) documenta o bridge CommonLibSSE-NG, Meridian/CEF, addon nativo do servidor, ClassSystem, empacotamento e validação. A mesma referência está preservada no UI Core; os caches locais e a reprodução em máquina limpa estão explicitamente diferenciados.

- `modules/class-system/` — baseline anterior de classes, grupos/raids e integração de UI Meridian; mantida como referência de migração.
- `modules/class-progression-system/` — escolha de classe e perks por marco, com persistência durável e distribuição autoritativa de pontos C3d.
- `modules/damage-system/` — combate autoritativo, dano físico/mágico, perks, efeitos e estado de combate.
- `modules/actor-state-system/` — composição autoritativa de facts/grants por origem, integrada à projeção; não cria um segundo combat/effects store.
- `modules/enemy-system/` — descoberta/classificação de inimigos, dungeons, encounter data e integrações.
- `modules/leveling-system/` — XP, progressão global, fadiga, party XP e integração com inimigos.
- `modules/durability-system/` — manutenção/durabilidade, materiais, persistência e integração SkyMP.
- `modules/profession-system/` — governador das profissões: profissão escolhida, XP profissional, rank, Vigor, gates, progressão e integração funcional com o Aetherius UI Core.
- `modules/gathering-system/` — execução das profissões de coleta: Minerador, Herbalista, Caçador e Fazendeiro; recursos globais, cooldowns, concorrência, carcaças, fazendas, CEF e integração com o governador.
- `modules/crafting-system/` — execução server-authoritative do artesanato, autorização de workstations, catálogo dinâmico de receitas/itens, CEF, transações e workflows de Ferreiro/Curtidor e demais artesãos.
- `modules/refinement-system/` — definição conceitual do refino por instância de equipamento, tiers I/II/III, risco, regressão e integração futura com Ferreiro/Curtidor e DamageSystem.
- `modules/enchantment-system/` — placeholder documental para encantamento; sistema ainda não definido/desenvolvido e **fora do escopo da release Alpha**.


## Novas inserções — Profissões, coleta e economia

O repositório passou a incluir a base documental dos sistemas econômicos/profissionais do Aetherius. Esses módulos foram separados para preservar ownership claro: o `profession-system` governa a carreira; `gathering-system`, `crafting-system`, `refinement-system` e sistemas futuros executam as mecânicas especializadas.

### ProfessionSystem

O [ProfessionSystem](modules/profession-system/README.md) é o governador canônico das profissões.

Responsabilidades principais:

- profissão especializada selecionada;
- XP profissional e rank;
- Vigor Profissional;
- gates globais;
- autorização/liquidação de atividades;
- integração da área de Profissões com o Aetherius UI Core.

Todos os personagens continuam podendo realizar coleta em nível **Novato** quando atendem aos requisitos, mas apenas a profissão selecionada ganha XP e progride além desse nível.

### GatheringSystem

O [GatheringSystem](modules/gathering-system/README.md) documenta a execução de:

- Minerador;
- Herbalista;
- Caçador;
- Fazendeiro.

Entre as regras atuais de balanceamento:

- minas usam, por padrão, estoque global de 500 unidades;
- cooldown padrão após esgotamento: 72 horas;
- até 2 mineradores simultâneos por mina;
- ciclo-base de coleta: 60 segundos;
- carcaças são processadas uma única vez;
- fazendas usam pools regionais/fixas/rotativas.

Esses valores são **configuráveis** e podem ser rebalanceados sem alteração da lógica do domínio.

### CraftingSystem

O [CraftingSystem](modules/crafting-system/README.md) concentra o artesanato server-authoritative.

A documentação atual cobre:

- autorização de workstations por profissão;
- filtragem server-side de receitas;
- catálogo de itens/receitas construído dinamicamente a partir da load order;
- Housecarl + RecordCatalog + winning records;
- integração com InventoryTransactionPort;
- XP/Vigor via ProfessionSystem;
- workflows de Ferreiro e Curtidor;
- interfaces CEF;
- regras de UI alinhadas ao AetheriusUI_Core.

Uma mesma workstation pode ser usada por profissões diferentes sem compartilhar catálogo. Exemplo:

```text
Forge:
  Ferreiro -> somente receitas de Ferreiro
  Artífice -> somente receitas de Artífice

Curtume:
  Curtidor -> somente receitas de Curtidor
  Artífice -> somente receitas de Artífice
```

O catálogo não deve depender de posição fixa de plugin. Housecarl é usado para descobrir/auditar COBJ, outputs, ingredientes, workstations, keywords, conditions, materials e winning records, enquanto o runtime trabalha com definitions estáveis.

A documentação de balanceamento de materiais está em [MATERIAL_CONVERSION_AND_RECIPE_BALANCE.md](modules/crafting-system/docs/MATERIAL_CONVERSION_AND_RECIPE_BALANCE.md). Defaults atuais:

```text
3 minério -> 1 ingot
3 peles -> 1 couro

set metálico completo -> 30 ingots
set de Couro completo -> 30 couros
set de pele pura -> 15 couros + 5 peles
```

Todos esses valores devem permanecer facilmente configuráveis.

As referências de interface de Ferreiro e Curtidor estão documentadas em [CRAFTING_UI_VISUAL_GUIDELINES.md](modules/crafting-system/docs/CRAFTING_UI_VISUAL_GUIDELINES.md). Elas definem a direção de layout/UX, enquanto a implementação final deve utilizar cores/tokens do AetheriusUI_Core e elementos gráficos desenhados à mão. Não existem Guilda dos Ferreiros nem Guilda dos Curtidores; a interface definitiva não deve sugerir essas organizações.

### RefinementSystem

O [RefinementSystem](modules/refinement-system/README.md) possui, por enquanto, apenas definição conceitual.

A proposta atual inclui:

- tier de refino persistido por instância;
- Tier I / II / III;
- baseline atual de +25% / +50% / +75% sobre o valor-base;
- progressão sequencial;
- moldes;
- minigame por ciclos;
- risco de falha e regressão de tier;
- integração futura com DamageSystem, com o bônus aplicado em **todo golpe ou defesa física pertinente enquanto a instância mantiver seu tier**, sem consumo ou regressão em combate.

**Tier não é carga de uso:** somente uma tentativa de refino (sucesso ou falha total ao buscar o próximo tier) altera seu estado; "aplicar uma vez" significa evitar duplicação do bônus dentro de cada cálculo. A integração com o DamageSystem ainda é futura.

Os valores numéricos de refino também são considerados parâmetros de balanceamento configuráveis.

### EnchantmentSystem

O [EnchantmentSystem](modules/enchantment-system/README.md) ainda não possui design técnico/conceitual suficiente para implementação.

Ele permanece como placeholder documental e **não fará parte da release Alpha**. Nenhum outro módulo deve inventar comportamento de encantamento ou usar enchanting vanilla como fallback para contornar a ausência do sistema autoritativo.

### Política de balanceamento

A regra geral para os novos sistemas é:

> números de gameplay/economia são defaults configuráveis, salvo quando um documento declarar explicitamente que determinado valor é uma invariável estrutural.

Isso inclui, entre outros:

- XP e thresholds;
- Vigor;
- estoque/cooldown de recursos;
- duração de atividades;
- concorrência;
- yields;
- chances;
- conversões;
- custos de recipes;
- budgets de sets;
- parâmetros de refino.

A referência canônica é [AETHERIUS_BALANCE_CONFIGURATION_POLICY.md](docs/architecture/AETHERIUS_BALANCE_CONFIGURATION_POLICY.md).


## Estado da migração

A importação inicial é **lossless**: os cinco repositórios existentes foram copiados para módulos próprios com conteúdo e modos Git idênticos aos snapshots de origem. Nenhuma deduplicação ou refatoração funcional foi feita durante o transporte.

Na migração inicial, o `ActorStateSystem` ainda não possuía repositório próprio e entrou como scaffold; sua composição/projeção foi implementada em etapas posteriores (B4/B5b).

Consulte `MIGRATION_MANIFEST.md` para os commits de origem e a prova de integridade.

## Planejamento integrado

O [planejamento holístico de 02/10/2026](AETHERIUS_GAMEPLAY_CORE_PLANEJAMENTO_HOLISTICO.md) audita os seis módulos, a instância MO2 `D:\modOrganizer`, os 424 plugins e as baselines Server/Client. Ele permanece como evidência histórica. O plano normativo corrente é a [arquitetura canônica](docs/architecture/AETHERIUS_GAMEPLAY_CORE_ARCHITECTURE.md).

O [pacote de evidências](docs/audit/2026-10-02/README.md) contém inventários, winning records, overrides, pesquisa documental e resultados de testes. É uma entrega de planejamento: os blockers de runtime estão explícitos e nenhuma funcionalidade nova foi ativada.

O [manual detalhado de mecânicas e multiplayer](docs/mechanics/README.md) complementa o plano com funcionamento de perks, conditions, fórmulas, efeitos, classes, persistência e cenários de validação. Inclui fichas das 1.493 perks instaladas, 1.540 records mágicos ligados a elas e todos os estágios das 18 classes, distinguindo dados observados, propostas e suporte ainda pendente.

## Princípio arquitetural

A existência no mesmo monorepo não elimina fronteiras de responsabilidade. Os módulos devem continuar com autoridades claras e contratos explícitos. Refatorações compartilhadas, deduplicação de contratos e integração com `aetherius-server` / `aetherius-client` serão realizadas em commits posteriores, após planejamento e testes.

## Repositórios de origem

Os repositórios originais permanecem intactos como referência histórica durante a transição. O `AetheriusGameplayCore` passa a ser o destino da evolução integrada desses sistemas após a validação da migração.
