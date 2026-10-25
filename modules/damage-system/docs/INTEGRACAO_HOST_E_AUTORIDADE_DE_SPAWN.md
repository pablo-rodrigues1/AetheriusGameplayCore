# DamageSystem: o que foi feito no host e no cliente, e autoridade de spawn

> **Leia antes de integrar o DamageSystem ou o EnemySystem.** Este documento é dirigido a quem integrar este módulo no
> `aetherius-server` e no `aetherius-client`, seja uma pessoa ou uma IA. Ele resume as mudanças feitas fora deste
> repositório durante o desenvolvimento local (ordens DS-0b a DS-0g-fix3, outubro de 2026), as decisões do dono do
> projeto que as limitam e o que ainda falta.

> [!IMPORTANT]
> **Encantamentos e poções:** o DamageSystem assume que a magnitude real de cada encantamento/poção fica guardada no próprio item pelo servidor (cenário ideal, decisão do dono). A implementação dos encantamentos deverá ser construída para funcionar assim: ver [REQUISITO_ENCANTAMENTOS_E_POCOES.md](REQUISITO_ENCANTAMENTOS_E_POCOES.md).

## 1. Regra principal: a autoridade de spawn é do EnemySystem

Decisão do dono do projeto (Q13, 24/10/2026):

- **Qual inimigo aparece** (sorteio de listas niveladas `LVLN`, geração, respawn, substituição ou remoção de NPC) é
  responsabilidade exclusiva do **EnemySystem**.
- O **DamageSystem não define qual inimigo spawna.** Ele não sorteia, não troca a base de um NPC, não cria, não remove,
  não desativa e não substitui atores. Nenhuma ordem, patch ou IA deve acrescentar isso ao DamageSystem.
- O que o DamageSystem faz com NPCs de lista nivelada é **observar** a criatura que o motor do jogo já mostrou, para que
  vida, dano e nível usados no combate sejam os da criatura que o jogador está vendo. É leitura do resultado, não decisão.
- A observação vale só para NPCs **não gerenciados** pelo EnemySystem. Quando o EnemySystem passar a marcar seus atores
  gerenciados, a observação do DamageSystem deve ignorá-los (pendente: depende do marcador que o EnemySystem definir).
- Para inimigos gerenciados, o EnemySystem deve criar o ator a partir de um registro `NPC_` concreto, não de um NPC com
  template `LVLN`; assim o jogo não sorteia nada e não existe divergência a observar.

Um fato mutável tem um único dono (`AGENTS.md`, invariante 2). Se o EnemySystem e o DamageSystem precisarem escrever a
cadeia de templates do mesmo ator, isso é conflito e deve ser resolvido a favor do EnemySystem.

### Resíduo conhecido para o EnemySystem

O host do SkyMP (upstream) sorteia uma criatura provisória ao carregar um NPC de lista nivelada
(`MpActor::EnsureTemplateChainEvaluated`, sem filtro de nível: `pcLevel = 0`). Esse sorteio não é do DamageSystem, mas
a correção DS-0g-fix1 o reaproveita ao descartar uma escolha salva inválida. Quando o EnemySystem assumir o spawn, esse
ponto passa a ser dele.

## 2. O problema encontrado

Sessões em jogo de 23 e 24/10/2026 (registros em `_work\evidence\H\` do workspace de integração):

- Para NPCs colocados com template de lista nivelada (exemplo: `LvlAnimalForestPredator`, `01E7A0:Skyrim.esm`), o
  servidor e o jogo sorteiam **cada um por conta própria**. O jogador via um lobo ou um skeever; o servidor tinha um urso
  das cavernas (`EncBearCave`, 250 de vida, mordida 60). O dano e a vida aplicados vinham da criatura do servidor.
- O host não faz o auto-cálculo de stats de NPCs com `AutoCalcStats`: `EncWolf` ficava com 12 de vida.
- A fórmula de dano atual do host (`TES5DamageFormula` do SkyMP) usa só o dano base da arma (ou o desarmado da raça), a
  armadura (`AR × 0,15%`, teto 80%), ×2 no ataque forte e ×0,1 bloqueado. **Não lê skills, perks nem atributos.** É a
  lacuna que as próximas etapas do DamageSystem (DS-1/DS-2) fecham.
- `DamageMultFormula` do SkyMP multiplica por 2 todo dano de NPC em jogador quando `damageMultFormulaSettings` falta no
  `server-settings.json`. Decisão Q10: multiplicador 1.

## 3. Decisões do dono que limitam o desenho

| # | Decisão |
|---|---|
| Q10 | Sem multiplicador extra de NPC em jogador. No `server-settings.json`: `"damageMultFormulaSettings": {"multiplier": 1}`. **O servidor oficial precisa dessa linha.** |
| Q11 (revista) | Para NPC de lista nivelada, o cliente que hospeda o NPC informa a criatura e o nível que o motor sorteou; o servidor valida contra os registros vencedores da load order e adota. Fazer o jogo obedecer ao servidor exigiria corrigir o Skyrim Platform nativo (DLL nova para todos). Riscos aceitos: um cliente modificado poderia informar a criatura válida mais fraca; quem não hospeda o NPC pode ver outra criatura. |
| Q12 | Velocidade de ataque (limitador `CanHit` do host): medir antes de mudar. Com BFCO o dono considerou irrelevante. |
| Q13 | Seção 1 deste documento. |

## 4. O que foi feito

### 4.1 No `aetherius-server` (C++ do host). Nada foi commitado lá; ver seção 6.

- **Sonda de combate, só de desenvolvimento** (`aetheriusCombat.probe` no `server-settings.json`; DS-0b, DS-0d): anéis em
  memória com golpes aceitos e recusados, animações, vida, equipamento e estado do ator; o gamemode grava em JSONL fora do
  caminho do hit. **Nunca ligar no servidor oficial.** Arquivo: `aetherius_combat/CombatProbe.h`.
- **Correção de posição de NPC hospedado** (DS-0i, entrega para revisão; convergência em jogo pendente):
  - Movimento autorizado que muda mundo/célula ou chega a distância **>=4096** da posição atual continua recusado;
    teleportFlag também continua forçando recusa. O host envia ao hoster vigente uma **TeleportMessage com idx do NPC**,
    confiável, com posição, rotação e mundo/célula atuais do próprio host. TeleportMessage2 continua exclusivo do jogador.
  - Primeira correção imediata; novas correções no máximo uma por segundo por NPC/hoster (relógio monotônico).
    Aceite limpa a cadência; OnHostAttempt limpa na troca efetiva de hoster; o evento BeforeDestroy limpa o estado mesmo
    com shared_ptr externo. Referências fracas e checagem de identidade/idx/hoster antes do envio evitam reutilização.
    Não há timer de reenvio, segundo ActorCombatState, persistência ou decisão de spawn/respawn/geração/criatura (Q13).
  - Com a sonda DEV, contadores npcMovementRejections (DISTANCE, WORLD_OR_CELL, TELEPORT_FLAG), npcCorrectionsSent e
    npcCorrectionsSuppressed, além de lastNpcCorrection nos snapshots de ator. São cópias em memória, sem I/O no hit.
    O relatório da sonda mostra a última correção na seção 9.1; envio não comprova aplicação no motor.
  - No cliente, remoteServer.ts registra indexedTeleport: RECEIVED, RESOLVED, RAGDOLL_PENDING e APPLIED, ou o motivo
    explícito da falha. O callback confere novamente modelo, mapeamento e referência local antes de aplicar. APPLIED
    significa retorno da chamada nativa; RAGDOLL_PENDING sem APPLIED continua sendo investigação, sem timeout novo.
    ragdollService, CanHit, fórmulas, filtro do golpe, limite e respawn nativo permanecem intocados.
  - Recomendações fora da DS-0i: encaminhar movimento a vizinhos só após validação; tratar limite de velocidade por pacote.
- **Arma após respawn nativo (DS-0k, entrega para revisão; sessão em jogo pendente):**
  - No ramo nativo que recompõe inventário/outfit, o host chama o mesmo EquipBestWeapon da inicialização, lendo
    exclusivamente o inventário interno e os WEAP vencedores. Publica UpdateEquipmentMessage confiável pelo canal
    existente, com o idx do NPC; numChanges avança a partir do equipamento anterior à reconstrução, mesmo que o
    outfit recém-criado tenha zerado o contador. O ramo que conserva o inventário não é alterado.
  - O CNTO do provider de UseInventory é convertido uma vez pelo próprio lookup do provider, antes de resolver
    item direto ou LVLI aninhada. O teste nativo demonstrou o erro anterior movendo o plugin; não muda contagem,
    conteúdo, posse ou serviços de economia. CONT permanece fora deste ajuste.
  - Com a sonda DEV, counters.npcEquipment contém total, overwritten e até 64 samples de equipamento e
    armas no inventário. Cada amostra guarda ator, geração, hoster, fase, contador, slots mágicos, StableFormKeys,
    contagens e mão. Até 32 entradas de cada conjunto; excedentes são declarados em equipmentOmitted e
    inventoryWeaponsOmitted; chave sem resolução é nula (UNSUPPORTED). Nenhum inventário paralelo de gameplay.
  - Fases: BEFORE_DEATH antes da mudança de morte; RESPAWN_REBUILT imediatamente após recompor/reequipar, ainda na
    geração anterior; AFTER_RESPAWN após o retorno nativo, com a geração que o ciclo de observação já mantém
    (incrementada só para NPCs observáveis; base fixa conserva a geração). Em cada recusa WEAPON_NOT_EQUIPPED
    de NPC, a sonda copia o equipamento corrente e a recusa referencia sua npcEquipmentSequence. O anel é comum;
    se a sequência já não estiver retida, o diagnóstico está indisponível, não deve ser reconstruído por suposição.
  - As cópias usam arrays fixos, getters da changeform e o índice ESPM já em memória: sem I/O, cálculo de máximos,
    parsing de campos de records ou JSON no hit. Serialização apenas na leitura da sonda. O gravador já preserva
    os contadores completos, sem mudança em runtime/src; relatório §7.1 deduplica snapshots entre polls, separa
    resets e declara lacunas próprias do anel. Hoster/ator runtime são apenas contexto da evidência.
  - HitService registra via logTrace a entrada do evento hit que Skyrim Platform entrega a partir do TESHitEvent
    e cada descarte/envio: source ID/tipo, agressor/alvo locais e remotos, presença em hosted, horário e motivo.
    Motivos: TES_HIT_EVENT, AGGRESSOR_NOT_LOCAL_NPC_OR_PLAYER, AGGRESSOR_NOT_HOSTED, TARGET_STATIC,
    SOURCE_NOT_WEAPON_SPELL_OR_SCROLL, MAGIC_DUPLICATE e SEND_RELIABLE. Falha da leitura diagnóstica fica UNAVAILABLE.
    A entrada nativa anterior à entrega em TypeScript permanece sem captura nesta ordem (arquivo fora dos caminhos).
  - Sem novos pacotes diagnósticos, alteração do payload, conversão de 803/C5F2 em desarmado, HUD, notificação,
    mensagem ou som ao jogador. logTrace usa o log de console técnico existente. OnHit mantém a exigência de
    equipamento do host; CanHit, fórmulas e distância permanecem intactos. Não decide quando renascer nem a criatura (Q13).
- **Observação da criatura** (DS-0g):
  - `ActionListener::OnCustomPacket` intercepta o canal `aetherius.npc.observation` e valida tamanho, formato exato,
    sessão, NPC, hoster atual, vivo, chave estável `plugin:ID` (nunca FormID de runtime) e geração.
  - `MpActor::AdoptNpcObservation` valida a criatura pela cadeia de records (`LeveledListUtils::ValidateObservation`),
    compatibilidade de nível e stats suportados, e persiste no changeform existente: `templateChain` mais o campo
    dinâmico privado `private.aetheriusNpcObservation` (`{base, level, generation}`). Sem segundo ledger.
  - Conflito com criatura já confirmada é recusado (não troca no meio da luta). Respawn incrementa a geração.
  - Auto-cálculo de vida/magia/vigor e skills pelos winners de CLAS/RACE/GMST (`GetBaseActorValues`).
  - O host manda ao cliente o marcador `aetheriusNpcObservation` (`{generation}`) nos NPCs que exigem observação.
- **Restauração tolerante** (DS-0g-fix1): escolha salva inválida não impede carregar o ator; ele volta a "não confirmado"
  com geração nova e o motivo vai para log e sonda.
- **Canal de motivo** (DS-0g-fix2): `aetherius.npc.observation.unavailable` v1 (`{channel, v, actor, generation, reason}`,
  lista fechada de motivos). Só diagnóstico; nunca altera o ator.
- **Base temporária** (DS-0g-fix3, em revisão): o motor devolve um `TESNPC` temporário `0xFF......` em
  `getLeveledActorBase()` para atores de lista nivelada (provado em jogo, motivo `RESOLVED_BASE_HAS_NO_STABLE_KEY`). O
  informe v2 leva a raiz do template, a raça efetiva e o nível; o host aceita só se exatamente uma cadeia dos winners
  casar com os três. Ambiguidade é recusada, nunca desempatada.

### 4.2 No `aetherius-client` (TypeScript). Nada foi commitado lá; ver seção 6.

- `client/src/services/services/npcObservationService.ts` (novo, registrado em `client/src/index.ts`): para cada NPC
  hospedado com marcador, lê a criatura e o nível do motor e envia o informe uma vez por combinação; envia o motivo quando
  não consegue. Sem clone, sem troca de base, sem escrita de actor values.
- Atenção na instalação: no MO2 local, dois mods trazem `Platform/Plugins/skymp5-client.js` e vence
  `AETHERIUS - UI CORE`. Um cliente de teste instalado só no outro mod nunca roda.

### 4.3 Neste repositório (`AetheriusGameplayCore`, branch `work/gameplay`)

Commits `d238145`, `22a0519`, `425d300`, `1050794`: captura da sonda no runtime (`runtime/src/combat-probe.ts`),
relatório (`runtime/tools/combat-probe-report.mjs`), testes, e a documentação deste módulo:
`docs/FONTES_E_DONOS.md` (§6, canais e limites), `docs/DIAGNOSTICO_SESSAO_DS-0.md` e
`docs/operations/ATIVACAO_DOS_SISTEMAS.md` (como ligar e desligar cada peça).

## 5. O que o EnemySystem já faz e não é afetado

A integração atual do EnemySystem no gamemode (`gameplay-core-bridge.js`: XP por abate e nível na barra de vida) identifica
o inimigo por `mp.get(id, 'baseDesc')`, a base do NPC colocado. O DamageSystem não altera esse campo. Mais tarde o
EnemySystem pode ler a criatura adotada (`private.aetheriusNpcObservation`) se quiser saber, por exemplo, se o abate foi de
um lobo ou de um urso.

## 6. Onde estão as mudanças fora deste repositório

As mudanças no host e no cliente vivem só na árvore de trabalho local e em patches datados no workspace de integração
(`_snapshots\aetherius-server\` e `_snapshots\aetherius-client\`, o mais recente com sufixo `DS-0g-fix3` ou posterior).
Os patches são cumulativos sobre os HEADs `6181abf` (host, release v0.20.0) e `31566e8` (cliente, v0.21.0). **Antes do
upload deste módulo, esses patches devem ser copiados para `modules/damage-system/integration/`** com a lista de arquivos,
para que quem integrar não dependa do workspace local.

## 7. Pendências

1. Revisão e teste em jogo da DS-0g-fix3 (base temporária).
2. Observação ignorar atores gerenciados pelo EnemySystem, assim que ele definir o marcador.
3. DS-1/DS-2: skills, perks e atributos na fórmula do host; armadura das criaturas.
4. Confirmar com o servidor oficial a linha `damageMultFormulaSettings` (Q10).
5. Copiar os patches do host e do cliente para `integration/` (seção 6).
