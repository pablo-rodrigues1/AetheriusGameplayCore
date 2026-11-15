# 6. Classes, skills, progressão, party e NPCs

## Lista de feitiços e tiers — revisão documental

Consulte [Feitiços por classe](../classes/FEITICOS_POR_CLASSE.md) para a relação completa da aba Classes, sincronizada com Classes - Progressão em 14/11/2026. São 164 registros em 12 classes; as outras seis não listam feitiços. O documento distingue esta referência de design dos dados ainda divergentes em `authorizedSpells`/`allSpellsList`; não altera a implementação descrita pelo código.

## 6.1 Dezoito classes sem perder seus estágios

[CLASS_STAGES](CLASS_STAGES.md) documenta todas as 18 classes e 350 ocorrências de perks nos estágios, incluindo nível, texto de skills e attributePoints configurado. Uma ocorrência repetida em duas classes não é uma nova definição de perk. [CLASS_PERK_MAPPING](CLASS_PERK_MAPPING.md) distingue as 162 entradas do resolvedor:156 IDs zero, seis entradas no manifesto histórico,146 nomes com candidatos instalados e dez sem correspondência exata.

Os candidatos por nome incluem normalização do sufixo `(rank)` apenas para pesquisa. Não foram gravados na configuração nem tratados como resolução aprovada. Um record com o mesmo nome pode ser outro rank, uma versão alterada ou uma perk de NPC. Conferir master, local ID, winner, chain, conditions e finalidade antes de aprovar.

## 6.2 Seleção de classe observada

[ClassSystem](../../modules/class-system/server/classSystem.ts) rejeita classe inexistente e mudança direta para uma classe diferente quando já existe uma. Para conjuradores com `requiresWinterholdStudent`, consulta `hasWinterholdKeyword` do estado. A origem autorizada dessa permissão precisa ser garantida; um campo de UI não pode concedê-la.

O caminho atual permite selecionar novamente a **mesma** classe e então reinicializa nível para 1, XP, alocações, perks e estado diário. Isso cria uma lacuna de idempotência: repetir seleção não deveria apagar progresso. Proposta: seleção com a mesma classe é no-op que devolve o snapshot; reset/respec é comando separado, autorizado e transacional.

A seleção atual zera unspentAttributePoints e alocações e concede nomes das perks do estágio inicial; não usa automaticamente `attributePoints` do estágio inicial para entregar pontos. A tabela de configuração não deve ser interpretada como prova de concessão. A revisão funcional deverá reconciliar a intenção dos estágios com a implementação e os testes antes de alterar saldo.

## 6.3 Como “Todas” e patamares de skills funcionam

[skillResolver.ts](../../modules/class-system/shared/skillResolver.ts) identifica skills primárias lendo menções explícitas nos estágios e nomes de perks reconhecidos. Linhas “Todas N” aplicam o patamar às skills primárias detectadas, não necessariamente às 18 skills do jogo. Para estágios até o nível atual, a resolução utiliza o máximo do valor já obtido e do novo patamar; não soma todos os valores dos estágios.

Exemplo: uma skill com 20 no estágio anterior e 30 no próximo resulta 30, não 50. O detector por nomes depende de strings como `One-Handed`, `Destruction` e `Archery`; mudanças de tradução/nome podem alterar o conjunto descoberto. Proposta: migrar para IDs de skill explícitos no catálogo validado, preservando o resultado aprovado de cada classe em golden tests.

Separar patamar desbloqueado, skill base, skill corrente modificada e qualquer progressão nativa. O provider de ActorState precisa declarar qual entra na fórmula. Substituir um AV corrente por patamar de classe pode remover buff ou progressão de outra origem; deve haver composição e ownership claros.

## 6.4 Milestones e grants

O código legado percorre todos os estágios com nível elegível e adiciona nomes ainda não presentes em unlockedPerks. Isso evita duplicação por string naquele array, mas não constitui ledger por origem nem garante aplicação nativa. Resolver um nome e armazená-lo não prova que um FormKey válido foi encontrado.

Contrato proposto: Leveling confirma nível/XP; Class deriva milestones elegíveis do mesmo catálogo e produz grants com `source=class`, classId, milestoneId, perkKey e rank. Um comando que atravessa vários níveis em uma vez concede cada milestone uma vez. A transação grava progressão e grants/outbox correspondentes, evitando “nível salvo, perks perdidas no crash”.

Respec revoga somente grants daquela origem e recomputa os patamares. Perks de quest/raça/equipamento continuam. Redução de máximo de recurso deve seguir política explícita para valor corrente — proposta: limitar ao novo máximo sem curar gratuitamente ao alternar classe. Não usar toggle de classe como recuperação de HP/Magicka/Stamina.

## 6.5 Um único Leveling

Class contém um sistema legado de leveling e o monorepo contém o módulo Leveling dedicado; ambos possuem caminhos para playerClassData. O cutover deve escolher um writer e manter o outro como projeção compatível. Não assinar o mesmo EnemyKilled em dois módulos concedendo XP.

Fonte matemática atual: [combat-xp.mjs](../../modules/leveling-system/src/math/combat-xp.mjs). Para perfil não FIXED, `XP = baseXp × enemyLevelFactor × contentMultiplier × partyModifier`, passando pelo arredondamento do módulo. FIXED usa fixedXp e ignora esses modificadores na conta. Bypass de fadiga é uma decisão adicional no serviço/transação, não consequência automática de simplesmente usar a fórmula fixa em qualquer lugar.

Um nome de categoria “boss” não autoriza fixedXp ou bypass por si só. Classificação, relevância, fórmula, recipients e motivo do bypass devem constar no trace/ledger. Não confiar em `xpReward`, `finalXp` ou multiplicadores enviados pelo cliente.

## 6.6 Party XP configurado

Fonte: [party-xp.json](../../modules/leveling-system/config/party-xp.json). Grupo normal aceita 1 a 8; multiplicadores por tamanho:1→1,2→0.9,3→0.85,4→0.8,5→0.75,6→0.7,7→0.65,8→0.6. Raid aceita 8 a 20:8→0.6,9→0.583,10→0.567,11→0.55,12→0.533,13→0.517,14→0.5,15→0.483,16→0.467,17→0.45,18→0.433,19→0.417,20→0.4. São fatores da fórmula por beneficiário elegível; não presumir divisão adicional por N.

A política pede snapshot com `source=SERVER`, online, mesma cell e distância máxima 5000 da posição central; não exige participação em dano. Membros são deduplicados por ID. Isso permite XP a um membro elegível sem hit próprio conforme a configuração atual; não introduzir participação obrigatória silenciosamente durante integração.

Lacuna observada em [party.mjs](../../modules/leveling-system/src/policies/party.mjs): `member.pos` é verificado como array, mas a função local não valida três componentes finitos antes da distância. Um NaN pode fazer a comparação `distance > maxDistance` resultar false e não excluir o membro. O contrato externo precisa validar posições e o teste deve demonstrar rejeição; `source=SERVER` em uma string também não substitui a construção do snapshot por provider confiável.

O snapshot deve ser capturado no instante de elegibilidade definido pela política de morte. Entrada/saída de party durante o processamento não pode gerar dois conjuntos de recipients. Mundo/instância deve complementar o conceito de cell para não premiar jogadores em cópias diferentes da mesma dungeon.

## 6.7 Fadiga e dia de jogo

Fonte: [fatigue.json](../../modules/leveling-system/config/fatigue.json). Ativa a partir do nível 15, inativa até 14; limite diário corresponde a 20% do XP exigido para o nível atual, com floor; reset às 06:00 em America/Sao_Paulo. A aplicação precisa usar relógio servidor e chave de ciclo determinística, inclusive quando o servidor reinicia ou o jogador fica offline.

Exemplo matemático: requisito de próximo nível 1000 gera cap 200. Com 150 já concedidos e solicitação 80, o contrato de limitação deve conceder 50 e registrar 30 não concedidos, conforme política de aplicação. A transição de nível pode alterar o cap e precisa seguir o comportamento aprovado do módulo, com fixture de fronteira. Não prometer que esse exemplo sintético representa todos os casos de level-up dentro de uma transação.

UI mostra saldo, cap, quantidade concedida e próximo reset. Reenvio de uma morte não pode preencher novamente o cap; reset de classe não pode virar bypass involuntário. Testar níveis 14/15, cap exato, múltiplos níveis e horário imediatamente antes/depois das 06:00.

## 6.8 NPCs, encontros e dungeons

Separar NPC base, spawn/actor instance, leveled list, encounter zone e regras do módulo Enemy. Um único local ID não identifica NPC entre plugins. Para leveled NPCs, o resultado do spawn depende de LVLN/ECZN/contexto; o índice de um record não é o level final do ator em jogo.

Fixture concreta: `02025A:Skyrim.esm`, EncDragonPriestFire, winner AETHERIUSINIMIGOS, nível 70 e campos de HP1690/MP645 na amostra, versus predecessor 50/1490/545. Esses são campos do record, não prova do máximo final após raça, AVs, effects e runtime. Uma política estática de dragon priest em 100 não deve substituir esse dado sem regra de balanceamento explícita.

Classificação de inimigo alimenta XP e UI; não deve alterar silenciosamente stats nativos. Unique/boss e quests precisam de proteção: bypass genérico por “boss” pode interferir em encontros roteirizados. DeathPort exige identidade do spawn, generation, causalidade e morte confirmada; respawn do mesmo NPC base é uma nova vida e não pode reutilizar a dedupe key anterior.

## 6.9 Durabilidade e manutenção

O módulo atual representa um ciclo de manutenção por materiais; não prova desgaste por instância de cada arma/armadura. A interface deve usar o nome e o estado reais. Providers de penalidade entregam snapshot versionado ao Damage e aplicam o fator ao componente previsto uma vez.

Consumo de kit exige autorização, material/estado elegível, reserva de inventário, débito e recovery. A baseline contém lacunas de autorização permissiva e SQL MySQL incompatível com a migração PostgreSQL pretendida. Não manter consulta DB por hit. B05 bloqueia consumo econômico enquanto não houver port atômico recuperável. O botão da UI deve explicar indisponibilidade, em vez de consumir visualmente e tentar compensar depois.
