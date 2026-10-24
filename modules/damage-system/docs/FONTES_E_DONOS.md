# Fontes dos modificadores de dano físico e dono de cada família

Ordem DS-0, 22/10/2026 (revisão 2, após o parecer `_work\reviews\DS-0-review-sol-1.md`). Load order: instância `C:\modOrganizer`, perfil AETHERIUS - GRAFICO - QUALIDADE, 426 plugins, epoch houseCARL `e2-771486e30fc46d2a`. Host: `aetherius-server` `6181abf` (release v0.20.0). Plano: `PLANO_DAMAGE_SYSTEM.md` no workspace.

Este documento diz **de onde vem cada número** que a fórmula física usa e **quem é o dono** de cada família de dano. Não descreve código pronto: o estado da implementação continua em [IMPLEMENTATION_STATUS](aetherius-combat/IMPLEMENTATION_STATUS.md). Tudo o que aparece como "proposta" depende de etapa futura ou de decisão do dono (seção 8).

## 1. Linha de base: o que o servidor aplica hoje

O host monta `TES5DamageFormula → DamageMult → SweetPieDamage → SweetPieSpell → DamageMultConditional` (`ScampServer.cpp:382`). É a cadeia padrão do SkyMP. No servidor local as quatro decorações estão sem configuração (`server-settings.json` sem `sweetPie*`/`damageMult*`). A decisão Q5 do dono escolhe essa cadeia sem configuração como linha de base da comparação; a configuração efetivamente instalada no servidor oficial **não foi inspecionada** e fica não determinada até confirmação documentada pelo outro desenvolvedor (sem credenciais). Para o dano físico, ela:

- usa o dano do WEAP equipado, ou o desarmado da raça;
- soma o Armor Rating dos ARMO vestidos e, **de cada ARMO com encantamento no record, os efeitos `DamageResist` do ENCH** (`TES5DamageFormula.cpp:71–99`);
- converte a armadura total pela curva nativa, com os GMSTs `fArmorScalingFactor` e `fMaxArmorRating` (`TES5DamageFormula.cpp:127–140`). Nesta load order, os vencedores são do B&BArmorScaling.esp: 0,15 e 80;
- multiplica por flags do cliente: ataque forte ×2, bloqueado ×0,1 e furtivo ×1,3 (`TES5DamageFormula.cpp:151–160`).

Não lê perks, skills, têmpera, poções, buffs nem efeitos de mods de combate. O DamageSystem precisa **preservar a contribuição de ENCH DamageResist** que já existe, além de acrescentar as novas fontes; trocá-la por nada seria regressão.

## 2. Constantes do jogo (GMSTs vencedores)

Lidas no boot pelo catálogo (DS-2), nunca escritas no código.

| GMST | Vencedor | Valor | Uso na fórmula Aetherius |
|---|---|---|---|
| `fDamagePCSkillMax` | Skyrim.esm | 1,5 | arma: ×(1 + 0,5 × skill/100), +0,5 % por nível |
| `fArmorRatingBase` / `fArmorRatingPCMax` | Skyrim.esm | 1 / 1,4 | Scaling de armadura: ×(1 + 0,4 × skill/100), +0,4 % por nível |
| `fPowerAttackDefaultBonus` | Skyrim.esm | 1 | ataque forte: ×(1 + 1) = ×2 antes das perks |
| `fCombatSneak1HSwordMult`, `1HAxe`, `1HMace`, `1HDagger` | Skyrim.esm | 3 | furtivo com arma de uma mão |
| `fCombatSneak2HSwordMult`, `2HAxe` | Skyrim.esm | 2 | furtivo com arma de duas mãos |
| `fCombatSneakHandMult` | Skyrim.esm | 2 | furtivo desarmado |
| `fDamageSneakAttackMult` | Skyrim.esm | 1 | multiplicador geral do furtivo |
| `fArmorScalingFactor` / `fMaxArmorRating` | B&BArmorScaling.esp | 0,15 / 80 | **usados pela linha de base TES5**; a fórmula Aetherius usa a curva absoluta da decisão Q4 e não os lê |

O multiplicador furtivo de arco e besta não foi localizado no recorte de GMSTs com "Sneak" no nome; isso não prova ausência. A DS-2 resolve a fonte; até lá o furtivo à distância é `UNSUPPORTED`.

## 3. De onde vêm as perks que mudam o dano

| Fonte | Exemplos | Alcance comprovado | Proposta |
|---|---|---|---|
| Grant do servidor: classe | 149 perks distintas das 18 classes, 78 efeitos físicos | jogadores, pelo servidor | entra no perfil (DS-4) |
| Grant do servidor: raça e pedra | perks e habilidades dos domínios `races` e `standing-stones` | jogadores, pelo servidor | entra no perfil (DS-4) |
| Lista `Perks` do NPC_ do jogador (`000007:Skyrim.esm`, vencedor AETHERIUS - LEVELED LISTS.esp) | 12 perks, entre elas `AlchemySkillBoosts` (0A725C) e `PerkSkillBoosts` (0CF788) | record; **não determinado** se o ator de jogador do SkyMP herda essa lista no cliente | decisão Q8: as necessárias (SkillBoosts) entram no perfil do jogador com origem `RECORD`, depois da medição DS-0c |
| Lista `Perks` do NPC_ (com template) | perks de cada NPC | record | perfil do NPC (decisão Q2) |
| SPID, linhas sem filtro | `MAG_ControllerGeneralPerk` (ADA501:Update.esm, vencedor Thaumaturgy), os 3 controladores do For Honor Balance Patch, os 2 do Reforged Directional Combat, `_SD_SDPerk` do DynamicBlockHit, e também 0A725C/0CF788 pelos INIs do Thaumaturgy e do Apothecary | **NPCs**: a gramática do SPID exclui o jogador no caminho on-load (`!IsPlayer()`); alcance sobre os atores de jogador do SkyMP **não determinado** | decisão Q8: só as necessárias ao funcionamento dos sistemas entram, pelo registro de distribuições (origem `DISTRIBUTION`), para NPC e jogador, depois da medição DS-0c: `MAG_ControllerGeneralPerk`, 0A725C e 0CF788. **Não entram** (decisão Q7): os controladores do For Honor Balance Patch e do Reforged Directional Combat, inteiros. `_SD_SDPerk` do DynamicBlockHit é proc (ApplyWeaponSwingSpell) e fica no cliente |
| SPID por raça | 3 perks raciais do Aetherius - A Race Overhaul | NPCs da raça; jogador não provado | conferir na DS-4 se o domínio `races` já as concede; nunca conceder duas vezes |
| SPID de religião para NPC | `MAG_CultistSheogorathPerkNPC`, `MAG_CultistMeridiaPerkNPC` (Pilgrim) | NPCs | perfil do NPC |

Regras para qualquer perk no perfil: união por identidade (StableFormKey + rank), provenance de cada origem, e o efeito de uma perk aplicado uma vez, mesmo que ela venha de duas origens.

As perks `SkillBoosts` são o mecanismo do jogo que converte actor values modificadores em dano. Exemplos: `ModAttackDamage × (1 + 0,01 × OneHandedModifier)` e `ModIncomingDamage × (1 − 0,01 × HeavyArmorModifier)`. Ter a perk não basta: o actor value precisa ter fonte (seção 4).

## 4. Actor values modificadores (encantamentos, poções, buffs)

Afetados: `OneHandedModifier`, `TwoHandedModifier`, `MarksmanModifier`, `BlockModifier`, `HeavyArmorModifier`, `LightArmorModifier`, as variantes `*PowerModifier` e os actor values que o Thaumaturgy usa como portadores (`SmithingSkillAdvance`, `AlterationSkillAdvance`, `EnchantingSkillAdvance`, `Fame`, `TwoHandedSkillAdvance`, `SneakingSkillAdvance`). Eles só mudam por efeito mágico ativo.

| Origem do efeito | O servidor conhece hoje? | Proposta |
|---|---|---|
| Encantamento no record da arma ou armadura vestida (ENCH estático) | o record, sim; a linha de base já lê só `DamageResist` | DS-4/DS-5 compila os efeitos constantes do ENCH; actor value sem semântica certificada fica `UNSUPPORTED` |
| Encantamento criado pelo jogador | o item traz `enchantmentId` (`Inventory.h:50–58`), FormID de runtime de record criado em jogo; o host não tem resolvedor | a DS-0b tenta resolver só leitura; sem resultado `SUPPORTED`, fica `UNSUPPORTED` |
| Têmpera de ferraria | sim: `health` no item do inventário do host | `flatItemDamage` e flat de armadura com origem própria (DS-5), uma vez por cálculo |
| Poção e comida consumidas | **não para combate**: `MpActor::ApplyMagicEffect` só trata Health/Magicka/Stamina (restauração), os rates e os rate multipliers (`MpActor.cpp:1926–1990`). Os demais actor values são ignorados, e o mapa guarda uma entrada por actor value, sem composição por origem | `UNSUPPORTED`. Suporte exige capacidade nova no host e integração ao store único de efeitos (fora desta trilha) |
| Habilidade concedida pelo servidor (pedra, raça) | sim, é grant | efeitos constantes entram no perfil se o actor value tiver semântica certificada |
| Feitiço lançado em si mesmo, efeito de outro jogador | não: magia é do cliente | `UNSUPPORTED` até a etapa de magia (D-6) |

Actor value sem fonte comprovada vale `UNSUPPORTED` no trace. Nunca é tratado como zero "suportado".

## 5. Mods de combate do cliente

| Mod | Efeito em records | Condições | Situação |
|---|---|---|---|
| For Honor Balance Patch: `ReforgedParryController`, `ReforgedFollowupController`, `ReforgedDirectionalAttackController` (SPID sem filtro) | ModAttackDamage, ModIncomingDamage, ModArmorRating, ModPercentBlocked, crítico, stagger, procs | quase tudo com `HasMagicEffect` (estados de aparar, continuação e direção criados no cliente). Uma entrada sem condição: `ReforgedFollowupController` Effects[4], ModAttackDamage ×0,9 | não aplicados pela linha de base; fora do servidor por inteiro, inclusive a entrada sem condição (decisão Q7) |
| Reforged Directional Combat: `Passives` (dano feito ×1,05/×1,25, recebido ×0,95/×0,75), `Actives` (procs) | ModAttackDamage, ModIncomingDamage, ApplyCombatHitSpell | `HasMagicEffect` | não aplicados; `UNSUPPORTED` (Q7); procs ficam no cliente |
| SCSI-ACTbfco: `bfco_baseperk001_bfcoSTYLE1` (0008CD:SCSI-ACTbfco-Main.esp) | **ModAttackDamage ×1,5** em duas entradas; dois ApplyCombatHitSpell; Activate | `GetGraphVariableInt` e IsAttacking/IsSprinting/IsPowerAttacking | não aplicados. Condição por graph variable: `UNSUPPORTED`. Concessão da perk não determinada |
| BFCO (DLL), For Honor Power Attack (DLL, `bDirectionalPowerAttack=false`) | animações e eventos de ataque | DLL | **risco para a Q3**: os nomes dos eventos de ataque forte podem diferir de `attackPowerStart*`. A DS-0b registra os nomes reais |
| SekiroCombat_II | MGEF Script `_SKII_BlockHitScript` e propriedades de faíscas | script não decompilado | **semântica não determinada** (pode haver regra de timed block, stagger ou dano). Classificar depois de decompilar o PEX e de observar na sessão |
| DynamicBlockHit (`_SD_SDPerk`, SPID sem filtro) | ApplyWeaponSwingSpell | IsBlocking, IsPowerAttacking | proc; continua no cliente |
| Dual Wield Parrying, Modern Stagger Lock, Precision, TK Dodge, Comprehensive Attack Rate Patch, Core Impact Framework (DLLs) | colisão, esquiva, aparar com duas armas, stagger, ritmo de ataque | DLL | semântica em DLL, não observável. Precision decide o contato e gera o hit, que o servidor trata como evidência |

## 6. O que o host oferece como evidência

- **Hit:** fonte, alvo, projétil e flags power, sneak, bash e blocked enviados pelo cliente. O servidor valida emissor, hoster, célula, alcance (4096, exceto arco e besta), equipamento e cooldown (`ActionListener.cpp`).
- **Animação:** `OnUpdateAnimation` repassa o evento aos vizinhos. Para o personagem do próprio jogador, guarda o nome do último evento (`SetLastAnimEvent`, `ActionListener.cpp:256–257`) e chama `AnimationSystem::Process`. Os callbacks de ataque (`attackStart*`, `attackPowerStart*`, com cobrança de vigor) **só são registrados se `SweetPie.esp` estiver na load order** (`AnimationSystem.cpp:43`, `:230–233`), e ele não está nesta instalação. Portanto, hoje o host **recebe e guarda o nome** do evento do jogador, mas não executa callback de ataque nem cobra vigor por ele. A animação de NPC hospedado não é guardada. O nome recebido é evidência do cliente, a validar; não é prova independente.
- **Furtividade:** `IsSneaking` vem do pacote de movimento do cliente (`ActionListener.cpp:216–217`). O host não tem dado de detecção do alvo. **Agachado não é ataque furtivo:** sem um critério certificado de "não detectado", o bônus furtivo fica `UNSUPPORTED` (seção 7 e Q9).
- **Bloqueio:** `blockStart`/`blockStop` marcam o estado. O hit infere bloqueio por ângulo e equipamento, mas não desmarca `blocked=true` vindo do cliente (A1 §3).
- **Vida informada pelo cliente:** `OnChangeValues` recebe o percentual absoluto e aceita qualquer queda; só a subida por regeneração é cortada (`ActionListener.cpp:861–936`). O cliente envia com cadência de até 2000 ms, por canal não confiável (`aetherius-client` `sendInputsService.ts:163–194`). Se o motor do cliente também aplicar o dano recebido e relatar a queda, o dano pode ser contado duas vezes. A DS-0b mede isso com janela de 3000 ms e rotula o resultado como suspeita; a prova causal exige golpe isolado em caso controlado.

### Achados DS-0d da sessão de 23/10/2026

O [diagnóstico com fontes e classificação PROVADO/HIPÓTESE](DIAGNOSTICO_SESSAO_DS-0.md) é a referência atual para D1–D4 e corrige o resumo inicial da sessão. **D1:** 80 recusas por distância; 66 envolvem 85541, sendo 62 no par com o jogador. Movimento autorizado de NPC também é recusado por salto ≥4096 ou troca de pai; só o jogador recebe teleporte corretivo. O mecanismo de posição parada está demonstrado no código, sua ocorrência específica ainda exige a captura nova.

**D2:** a base do ref é um NPC intermediário cuja cadeia pode selecionar um NPC por LVLN com pcLevel=0 (sem filtro). O host soma RACE.startingHealth + NPC.healthOffset, sem auto-calc de nível. Winner não garante a mesma vida/seleção do cliente. Há leitura de HareRace para LvlAmbientCreatures no log; a atribuição a cada ref continua hipótese. O primeiro golpe do jogador em 107CF6 foi 44, não 22. A sonda DS-0d copia a cadeia existente e o máximo usado, sem sortear novamente.

**D3:** o DamageMult padrão é 2 para NPC→base de jogador; existe exemplo documental versionado de multiplier=1, não configuração de deployment encontrada. A conta 60×0,8365×2×2=200,76 confere com o golpe 16. Armadura: 69 + ENCH DamageResist 40; GMSTs 0,15/80. A raça histórica que forneceu 60 não foi registrada: WolfRace instalada tem 12, enquanto candidatos BearBlackRace/TrollRace têm 60. Não atribuir o 60 ao lobo mostrado sem conferir a cadeia. HealthCandidate=0 e healthAfter≈0,01 não permitem deduzir máximo≈203. Nada disso determina a configuração do servidor oficial.

**Supersessão da observação de animação acima:** com a sonda de desenvolvimento ligada, os eventos aceitos de NPC hospedado também são copiados, independentemente do AnimationSystem. A extensão DS-0d acrescenta recusas, posição corrente/último movimento/tentativa, hoster e máximos com estado de disponibilidade; fora da sonda o comportamento nativo continua o descrito. Skills ainda não são projetadas pelo Core; deltas de máximos C3d já são projetados (ver D4 do diagnóstico).


### DS-0g — criatura informada e auto-cálculo (24/10/2026)

Esta seção supersede o comportamento de D2 descrito acima para o código DS-0g. O host publica a propriedade de leitura aetheriusNpcObservation={generation} só para NPCs cuja cadeia contém LVLN ou cujo provedor UseStats tem PCLevelMult. O cliente hospedeiro lê getLeveledActorBase/getLevel e envia evidência pelo customPacket aetherius.npc.observation v1. ActionListener autentica o emissor pela mesma associação hosters do movimento. Não há roteamento pelo Core/gamemode nem DLL nova de Skyrim Platform.

O C++ percorre deterministicamente NPC_/TPLT/LVLN vencedores: entrada com nível ≤ informado; sem CalculateFromAllLevels, só o maior nível elegível. Confere nível fixo ou limites min/max de PCLevelMult no provedor UseStats. Grafo ausente/cíclico, ambiguidade, UseAll e LVLG sem semântica certificada são recusados explicitamente. Limites: 4096 visitas, 64 elos. Base por plugin de definição e ID local; o host converte para a load order corrente. Informe aceito trava cadeia e nível até respawn; outro hoster só confirma a mesma escolha. Persistência usa templateChain e dynamicFields['private.aetheriusNpcObservation'] do changeform existente; respawn incrementa geração, remove confirmação e publica o marcador. Antes do informe válido, o nivelado conserva a cadeia e a conta anteriores. PCLevelMult sem informe conserva a conta anterior; NPC fixo não nivelado usa seu nível do record.

GetBaseActorValues aplica auto-cálculo somente quando o provedor UseStats tem AutoCalcStats e o nível está disponível. Máximos = RACE.Starting + offsets ACBS + distribuição de (nível−1)×iAVDhmsLevelUp pelos pesos CLAS (Health/Magicka/Stamina); Health soma ainda (nível−1)×fNPCHealthLevelBonus. Regeneração continua racial. Skills = iAVDSkillStart + bônus RACE, mais distribuição de (nível−1)×iAVDSkillsLevelUp por CLAS. Distribuição: parte inteira por peso, excesso redistribuído entre valores não saturados e resto por peso decrescente/desempate AV decrescente; teto de skill 100 no domínio certificado. Não se usa DNAM como cache calculado de auto-calc. RACE.DATA identifica o bônus por ActorValue 6..23 (por exemplo, Sneak=15); a saída e CLAS/DNAM usam índices 0..17. Skills manuais somam valores e offsets DNAM. GetNpcSkills expõe leitura opcional; nada consome skills no dano nesta ordem. Máximos continuam base → C3d/DEV → fraqueza.

| Termo | Fonte vencedora nesta load order | Identidade |
|---|---|---|
| pontos de atributos por nível | iAVDhmsLevelUp = 10, Skyrim.esm | 021A73:Skyrim.esm |
| pontos de skill por nível | iAVDSkillsLevelUp = 8, Skyrim.esm | 0C790F:Skyrim.esm |
| skill inicial | iAVDSkillStart = 10, Aetherius.esp | 000803:Aetherius.esp |
| bônus de vida por nível | fNPCHealthLevelBonus = 5, Skyrim.esm | 023BB9:Skyrim.esm |
| pesos de predador/urso | CLAS 3:0:3; skills OneHanded=2, Archery=2, Block=3, Sneak=3 | 0131E6 e 106AED:Skyrim.esm |
| raça/offsets/nível/AutoCalcStats | RACE e NPC_ no provedor por família, nunca o terminal por convenção | resolvidos na cadeia adotada |

Leitura tipada de EDID/DATA no header NpcObservation.h: o leitor GMST público do libespm só interpreta float, inclusive em GMST inteiro. Não foi necessário alterar libespm. Identidades acima são resolvidas dinamicamente; ausência, tipo/nome inválido ou entrada fora do domínio produz UNSUPPORTED, sem default vanilla silencioso. Pontos por nível aceitos 0..255, início 0..100; incremento de skill >255 é UNSUPPORTED (não simula overflow de byte). Outros ajustes de executável/DLL no auto-cálculo não estão certificados.

Fontes da semântica: [reconstrução original de DistributeAutoCalcPoints](https://gist.github.com/dado3212/1929ddc3f778c36da0fbc8b4abc31a87) (LE 1.9.32, algoritmo e ordem; não é fonte Bethesda) e [investigação original do autor](https://blog.alexbeals.com/posts/how-skyrims-npc-skill-leveling-works); [implementação e auditoria de conversão de NPCs](https://github.com/bryantmh/tes4skyrim/blob/master/docs/reference/record_mapping.md) documenta a separação ACBS/RACE/GMST de DNAM. Schema binário: [TES5Edit](https://github.com/TES5Edit/TES5Edit/blob/dev-4.1.5/Core/wbDefinitionsTES5.pas), ACBS/CNAM/DNAM, CLAS.DATA e RACE.DATA; schema de campos: referência Mutagen. Winners e contas manuais em _work/evidence/DS-0g. Essa prova de código/records não substitui comparação com o motor SE em jogo.

Riscos de Q11 revista permanecem: hoster alterado pode declarar a opção mais fraca permitida; clientes que não hospedam podem ver outro sorteio. A validação limita os candidatos e o nível, sem atestar qual renderização cada cliente vê. A sonda identifica explicitamente confirmação, nível, geração, provedores UseTraits/UseStats, cadeia e máximo. Informes recebidos/aceitos/duplicados/recusados têm contadores por motivo e anel de 256 amostras. Cadência mede tentativas anteriores por agressor (inclui recusadas), último golpe aceito, WEAP.speed, limite de CanHit e duas animações; não altera CanHit nem SPLASH. A leitura/serialização da sonda continua fora do hit.

### DS-0g-fix2 — diagnóstico e limite da base temporária

Supersessão do diagnóstico apenas no console: o cliente envia customPacket aetherius.npc.observation.unavailable v1, objeto exato {channel,v,actor,generation,reason}, reliable, uma vez por ator/geração/motivo enquanto mantida hospedagem/conexão. Motivos fechados: ACTOR_NOT_LOADED, RESOLVED_BASE_ABSENT, RESOLVED_BASE_HAS_NO_STABLE_KEY, INVALID_ENGINE_LEVEL e ENGINE_READ_FAILED (sem texto de exceção). Falha não gera informe de criatura. O host verifica tamanho ≤1024 bytes, formato/tipos/chaves, sessão, NPC sem dono usuário, hoster atual, vivo, elegibilidade e geração; não altera escolha, cadeia, nível, changeform ou vida. Anel npcUnavailable (256), contadores npcUnavailable/npcUnavailableReasons (somente aceitos) e npcUnavailableResults (validação) separados de npcReports e npcRestoreFailures. Core grava npc-unavailable fora do hit; relatório §§1/11 mostra pares, amostras e recusas do diagnóstico. Sem sonda, o host valida/descarta sem mudar a criatura. Antes do marcador/geração elegível não há diagnóstico autenticável por este contrato.

**Item 2 parado:** [SKSE GetTemplate](https://github.com/ianpatt/skse64/blob/master/skse64/PapyrusActorBase.cpp#L222) chama [GetRootTemplate](https://github.com/ianpatt/skse64/blob/master/skse64/GameObjects.cpp#L54), que percorre até o último nextTemplate, não o elo imediato. A Platform 2.8.0 declara esse getter e o encaminha à função Papyrus nativa. O host aceita NPC alcançável somente quando determina cadeia única. Duas entradas que compartilham template terminal perdem a identidade da escolha com esse getter; o teste nativo caracteriza AMBIGUOUS_TEMPLATE_CHAIN também após reordenação. Não foi comprovada API declarada que preserve a entrada escolhida; não se usa getTemplate em produção. Base temporária continua UNSUPPORTED, agora com motivo no host. Evidência: _work/evidence/DS-0g/fix2/base-temporaria-investigacao.md. Não se afirma correção da divergência visual nem causa comprovada da sessão 4.

## 7. Dono de cada família

A coluna Owner usa só os quatro valores do AGENTS §4: `AETHERIUS_SERVER`, `NATIVE_SERVER`, `NATIVE_CLIENT` e `DISABLED`. Pela regra do plano de integração (§2), o que não é calculado pelo servidor fica `NATIVE_CLIENT`: o motor do cliente calcula, e o servidor não finge que validou. No dano físico, isso significa que o efeito **não muda o dano aplicado pelo servidor**. Capacidade, pendência e trava de promoção ficam na coluna Capacidade e condição.

| Família | Owner hoje | Owner proposto ao fim da DS-7 | Capacidade e condição |
|---|---|---|---|
| Dano físico corpo a corpo, arco, besta e desarmado | NATIVE_SERVER | AETHERIUS_SERVER, por família | `active` só com prova de aplicação única (DS-0b e DS-7); `off` mantém a cadeia TES5 |
| Armadura: rating, ENCH `DamageResist` do record e curva | NATIVE_SERVER | AETHERIUS_SERVER | curva absoluta Q4; preserva ENCH DamageResist |
| Perks de classe, raça e pedra com condição certificada | NATIVE_CLIENT | AETHERIUS_SERVER | hoje projetadas ao cliente sem efeito no dano do servidor; DS-3/DS-4 |
| Perks com condição de estado do cliente (`HasMagicEffect` de parry e direção, graph variable, distância, ângulo, correndo) | NATIVE_CLIENT | NATIVE_CLIENT | `UNSUPPORTED` no servidor e listadas na cobertura; promoção bloqueada (Q7) |
| Perks globais necessárias (record do jogador e SPID: SkillBoosts, controlador do Thaumaturgy) | NATIVE_CLIENT | AETHERIUS_SERVER pelo registro de distribuições (Q8) | promoção só depois da medição DS-0c; filtro não avaliável `UNSUPPORTED` |
| Perks dos mods de combate (For Honor, Reforged, SCSI) | NATIVE_CLIENT | NATIVE_CLIENT | fora do servidor (Q7); golpe direcional calculado como convencional |
| Ataque forte | NATIVE_SERVER (flag do cliente) | AETHERIUS_SERVER | confirmação pelo nome do evento (Q3); jogador: nome já guardado; NPC: mudança no host (DS-5) |
| Ataque furtivo | NATIVE_SERVER (flag do cliente, ×1,3) | DISABLED | decisão Q9 do dono: desligado |
| Bloqueio | NATIVE_SERVER (×0,1 com flag) | AETHERIUS_SERVER | bloqueio confirmado pelo estado nativo |
| Têmpera de ferraria | NATIVE_CLIENT | AETHERIUS_SERVER | `health` do item do host |
| Encantamento estático: efeitos além de DamageResist | NATIVE_CLIENT | AETHERIUS_SERVER por actor value certificado | demais actor values `UNSUPPORTED` |
| Encantamento criado pelo jogador | NATIVE_CLIENT | NATIVE_CLIENT | promoção bloqueada até resolução comprovada (DS-0b) |
| Poção, comida e buff como modificador de combate | NATIVE_CLIENT | NATIVE_CLIENT | o host não guarda esses actor values; `UNSUPPORTED` |
| Refino | DISABLED | AETHERIUS_SERVER pelo adaptador | provider neutro (tier 0) até existir identidade de item |
| Dano mágico de feitiço: magnitudes hostis de Health de SPEL | NATIVE_SERVER (`TES5DamageFormula.cpp:198–229`) | NATIVE_SERVER | sem mudança até a D-6 |
| Encantamento ofensivo de arma | NATIVE_CLIENT | NATIVE_CLIENT | caminho no servidor não demonstrado; classificar na D-6; promoção bloqueada |
| Cura | NATIVE_CLIENT | NATIVE_CLIENT | fora da fórmula: o host encaminha ao SkySocial (`ActionListener.cpp:1301–1313`, `:1383–1389`); serviço fora do escopo, não alterado |
| Veneno em arma | DISABLED | DISABLED | suspenso; opt-in desligado (`ScampServer.cpp:395–396`) |
| Procs (`ApplyCombatHitSpell`, `ApplyWeaponSwingSpell`), stagger | NATIVE_CLIENT | NATIVE_CLIENT | — |
| Vida relatada pelo cliente (`OnChangeValues`) | NATIVE_CLIENT | NATIVE_CLIENT | se a DS-0b/DS-7 provar segunda origem de dano físico, propor bloqueio em ordem própria; até lá, nenhuma família física vai a `active` sem essa prova |
| Durabilidade | DISABLED | DISABLED | — |

## 8. Decisões do dono sobre as perguntas da DS-0 (23/10/2026)

- **Q7 — fora.** Os efeitos dos mods de combate condicionados a estado do cliente não entram no cálculo do servidor; os controladores do For Honor Balance Patch e do Reforged Directional Combat ficam inteiros fora (inclusive `ReforgedFollowupController` Effects[4], ×0,9 sem condição). Ataques direcionais e quaisquer golpes aceitos pelo host contam como ataques convencionais: a animação nunca zera nem reduz o dano; só a falta de confirmação de ataque forte deixa de dar esse bônus.
- **Q8 — sim, quando necessárias.** As perks globais necessárias ao funcionamento dos sistemas entram no perfil por um registro de distribuições no servidor (grants de origem `DISTRIBUTION` derivados das linhas dos `_DISTR.ini` do catálogo, com filtro avaliado no servidor; filtro não avaliável fica `UNSUPPORTED`). Necessárias nesta load order: `PerkSkillBoosts` (0CF788), `AlchemySkillBoosts` (0A725C) e `MAG_ControllerGeneralPerk` (ADA501). A medição DS-0c confirma o que o cliente aplica de fato ao jogador e aos NPCs, inclusive pela lista `Perks` do record do jogador.
- **Q9 — desligado.** Sem bônus de ataque furtivo por enquanto.
