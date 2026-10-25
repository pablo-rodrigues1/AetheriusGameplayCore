# Fontes dos modificadores de dano físico e dono de cada família

> Atualização DS-2d: a §12 é a fonte vigente da herança Q15a e dos efeitos Q15/Q16; as previsões anteriores correspondentes são históricas.

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

### DS-0g-fix3 — semântica de raiz não comprovada (24/10/2026)

**Parada exigida pelo Pedido 2.** A inferência da fix2 de que o terminal de TPLT/LVLN corresponde ao retorno de getTemplate está supersedida por esta ressalva; o histórico e os testes anteriores permanecem. [GetRootTemplate do SKSE](https://github.com/ianpatt/skse64/blob/master/skse64/GameObjects.cpp#L53) percorre nextTemplate em memória, no offset 0x1F0; o [CommonLib identifica esse membro como faceNPC](https://github.com/alandtse/CommonLibSSE-NG/blob/ng/include/RE/T/TESNPC.h#L264). O [campo TPLT é baseTemplateForm, distinto](https://github.com/alandtse/CommonLibSSE-NG/blob/ng/include/RE/T/TESActorBaseData.h#L126). O host percorre TPLT e resolve LVLN; não foi comprovado como o motor preenche nextTemplate nessa composição. Parar quando nextTemplate é nulo não prova parar quando TPLT é ausente. GetRootTemplate não contém resolução de LVLN.

Assim, root = último NPC da cadeia TPLT seria suposição. V2 não foi implementado; não há motivos novos, adoção por raiz/raça ou novos contadores. V1 e o diagnóstico fix2 continuam vigentes, com base temporária UNSUPPORTED. O fato da sessão 5 confirma a ausência de chave estável; não estabelece o retorno de getTemplate. Fontes, fatos e lacuna em _work/evidence/DS-0g/fix3/raiz-semantica-investigacao.md; entrega em _work/orders/DS-0g-fix3-raiz-e-raca.result.md. Falta prova da correspondência do ponteiro do motor com os winners antes de retomar essa resolução.

### DS-0g-fix4 — observação por raça efetiva e nível (24/10/2026)

Supersede apenas o bloqueio de base temporária das fix2/fix3: a raiz continua fora do contrato. Na Platform 2.8.0, Actor.getRace() e Actor.getLevel() são leituras declaradas. Sem chave estável da base resolvida, o cliente envia aetherius.npc.observation v2, objeto exato {channel,v,actor,race,level,generation}; race é ID local:plugin de definição. V1 permanece com base estável. Raça ausente ou sem chave estável gera RACE_ABSENT ou RACE_HAS_NO_STABLE_KEY no canal de motivo v1; os motivos anteriores permanecem aceitos. Nenhum getTemplate, clone, troca de base ou escrita de actor values.

O host valida os dois formatos, tamanho ≤1024, chaves e tipos exatos (sem duplicadas), sessão, NPC sem dono usuário, hoster atual, vivo, elegibilidade e geração. V2 enumera todas as cadeias estruturais NPC_/TPLT/LVLN, sem pcLevel e sem sorteio: nível da criatura não é nível do jogador e não filtra limiares da lista. Usa a mesma regra de EvaluateTemplate para achar os provedores UseTraits e UseStats. Compara raça efetiva e nível fixo ou faixa min/max do provedor; ausência de semântica mantém UNSUPPORTED_TEMPLATE_GRAPH. Caminhos repetidos com a mesma sequência de NPCs contam como uma cadeia, sem usar peso/ordem para escolher. Zero candidatos = NO_MATCHING_OBSERVATION; mais de um = AMBIGUOUS_OBSERVATION, sem adoção. Limites de 4096 visitas/64 elos e recusas de UseAll/LVLG/ChanceNone garantido permanecem.

A cadeia única passa pelo caminho comum de adoção, stats suportados e persistência no changeform existente. V2 acrescenta v=2 e race estável a private.aetheriusNpcObservation; o base terminal é apenas diagnóstico. Restauração v2 revalida raça+nível contra os winners e não tenta inferir a entrada pelo terminal compartilhado; falha conserva a recuperação da fix1 com geração nova. Duplicata exige mesma cadeia e nível; conflito não substitui a criatura confirmada. Nenhum I/O é acrescentado ao hit. Q13 permanece: observa apenas; spawn pertence ao EnemySystem. A exclusão de atores gerenciados aguarda o marcador a ser definido pelo EnemySystem, conforme INTEGRACAO_HOST_E_AUTORIDADE_DE_SPAWN.md.

Sonda: cada npcReports contém v/race/candidates (null quando a busca não ocorreu); npcReportVersions.v1/v2 mantém recebidos e motivos em contadores limitados, separados de diagnóstico e restauração. Versão indeterminada em pacote inválido não é atribuída a v1/v2. A §11 do relatório mostra totais por versão, motivos, raça e número de candidatos. Capturas históricas sem esses campos mostram indisponibilidade. Dados seguem pelo gravador genérico fora do hit, com retry/checkpoint preservados.

houseCARL confirmou C:/modOrganizer, perfil AETHERIUS - GRAFICO - QUALIDADE, sem trocar instância. LvlAnimalForestPredator (01E7A0:Skyrim.esm) → LCharAnimalForestPredator (042297:Skyrim.esm): 26 entradas repetem seis cadeias distintas. Pares efetivos: SkeeverRace 013201 nível 1, WolfRace 01320A nível 2, FrostbiteSpiderRaceLarge 053477 nível 6, BearBrownRace 0131E7 nível 12, TrollRace 013205 nível 14, BearBlackRace 0131E8 nível 16 (todos Skyrim.esm; nomes só explicativos). Seis cadeias únicas, zero ambíguas por raça+nível; ponderadas pelas entradas, 26 únicas/zero ambíguas. A última passa por EncBearCave e EncBear, mas UseTraits/UseStats ficam em EncBearCave. Consultas e testes em _work/evidence/DS-0g/fix4. Isso não comprova entrega dos informes no jogo nem sincroniza a aparência de outros clientes.

**Nota histórica:** INTEGRACAO_HOST_E_AUTORIDADE_DE_SPAWN.md §§4.1/7 descreve fix3 como implementação/em revisão; o parecer aceitou a parada e esta fix4 entrega v2 sem root. Aquele arquivo está fora dos caminhos de escrita desta ordem; suas regras Q13 permanecem válidas. Teste em jogo cabe ao dono, sem instalação/ativação pelo executor.

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

## 9. Fonte combat entregue na DS-2 (24/10/2026)

Fonte efetiva: exports WEAP/ARMO/AMMO/RACE/KYWD de
_work/exports/combat-20261024, gerados pelo Opus com houseCARL na instância
C:\modOrganizer, perfil AETHERIUS - GRAFICO - QUALIDADE, epoch
e2-771486e30fc46d2a. O implementador usa esses artefatos por FormID, sem nova
consulta ao houseCARL nem mudança de instância. MANIFESTO.txt registra seus hashes.

catalog/combat.json inclui todos os records físicos exportados, inclusive
equipamento não jogável e RACE de NPC; KYWD somente alcançados. Nenhum filtro
por nome, nenhum valor de memória ou de descrição de mod. Os fingerprints de
plugins vêm explicitamente do manifesto local de plugins e são conferidos contra
os arquivos reais por verify.ts/createFileHost. Isso não prova por si só a
correspondência criptográfica entre o epoch houseCARL e o conteúdo dos plugins.

Campos e política de ausência estão em catalog/README.md. Enchantments são
referências, não contribuição certificada de ENCH DamageResist. Templates de
WEAP/ARMO/AttackRace não são resolvidos; depth 3 deixa os detalhes de
RACE.Attacks[].AttackData indisponíveis. Essas lacunas constam de unsupported,
sem default e sem inferência por evento de animação.

**Supersessão da previsão da seção 2:** esta ordem recebe cinco tipos físicos,
sem export GMST; os valores numéricos da tabela histórica não foram incorporados
como constantes. Ler/certificar GMST no boot continua pendente para a integração
da fórmula. Furtivo permanece desligado (Q9). PERK depth 12 fica com o compilador
DS-3. As linhas vencedoras SPID da Q8 não estão entre os artefatos desta ordem;
registro de distribuições não está entregue pelo domínio combat.

O runtime associa damage a combat e resolve pelo adapter de arquivos comum.
Catálogo reconciliado não significa cálculo certificado: damage continua
UNSUPPORTED pelos motivos DS-4 (perfil) e DS-5 (ponte nativa). O mapa e proposta
para substituir physicalRecords estão em integrations/host/COMBAT_DS2.md;
o C++ não foi alterado. Nenhuma família muda de dono. Q13: nenhum sorteio,
criação, remoção, substituição ou decisão de spawn/respawn é feito pelo catálogo.

## 10. NPC_ no domínio combat — DS-2b (24/10/2026)

Supersede a ausência de NPC_ na descrição histórica da DS-2 (§9): NPC_.jsonl de
combat-20261024 contém 11.583 winners no epoch e2-771486e30fc46d2a, depth 3,
SHA-256 fb17823c7349411a45ae5e6cd08510b78f2a52c18aac9b1e7f7172653e012032.
Não houve consulta de instância nem mudança no MO2; só os exports da ordem foram
usados para valores, localizados por plugin de definição + FormID local.

A estrutura foi conferida na referência Mutagen instalada (Npc, NpcConfiguration,
NpcLevel/PcLevelMult, PlayerSkills, PerkPlacement e ContainerEntry/ContainerItem).
Class/Race/TPLT, ACBS (flags, nível e offsets), DNAM (skills e atributos), PRKR
(perk/rank), SPLO, DOFT/SOFT e CNTO são preservados pelo contrato documentado em
catalog/README.md. CNTO.Count não está nas folhas depth 3: referência note_ref
preservada, quantidade null/UNSUPPORTED. Lista ausente é UNSUPPORTED, sem vazio
ou valor padrão presumido. Spells, perks, classe, itens e outfits são referências,
sem grants nem leitura de inventário de ator.

Fontes primárias locais para os provedores de template por categoria:
- [NPC_.h: TemplateFlags](../../../../aetherius-server/libespm/include/libespm/NPC_.h):
  UseTraits inclui raça; UseStats inclui nível, auto-cálculo, skills, atributos e
  classe; UseSpelllist inclui spells e perks; UseInventory inclui outfits/CNTO;
  UseAttackData e UseKeywords são categorias próprias.
- [EvaluateTemplate.h](../../../../aetherius-server/server/cpp/server_guest_lib/EvaluateTemplate.h):
  primeiro NPC sem TPLT ou sem o flag da categoria fornece o dado; não é uma
  regra de pegar a raiz global para todos os campos. A DS-2b resolve apenas a
  travessia NPC_→NPC_ estática. Categoria sem provedor, ciclo, link/flags ilegíveis
  ou alvo externo (inclusive LVLN) fica UNSUPPORTED. Não sorteia lista (Q13).

SUPPORTED em npc.templateProviders certifica apenas identidade/cadeia do provedor.
O dado local não vira dado efetivo automaticamente. AutoCalcStats continua
UNSUPPORTED para resultado: falta export CLAS dos Stats providers, incluindo
pesos de skills/atributos e parâmetros do auto-cálculo, no mesmo epoch, e prova
da fórmula usada pelo motor. required-clas.json em _work/evidence/DS-2b lista
as chaves alcançadas, sem presumir pesos ou fórmula. DS-4 continua responsável
por montar o perfil e respeitar limitações locais do provedor escolhido.

**Herança de equipamento (item 2): PARADA nesta entrega.** Tentativas de ler
[Weapons](https://ck.uesp.net/wiki/Weapons) e [Armor](https://ck.uesp.net/wiki/Armor)
no Creation Kit retornaram HTTP 403. Foram encontradas descrições secundárias,
mas não aceitas como prova de campos herdados/exceções. O código primário local
[WEAP.cpp](../../../../aetherius-server/libespm/src/WEAP.cpp) lê DATA/DNAM e
[ARMO.cpp](../../../../aetherius-server/libespm/src/ARMO.cpp) lê EITM/DATA/DNAM/ETYP/
BODT/BOD2; ambos não leem CNAM/TNAM, portanto não comprovam herança no engine.
A semântica completa de campos de WEAP/ARMO não foi implementada: dados locais,
Template/TemplateArmor e UNSUPPORTED da DS-2 permanecem. Fonte primária acessível
ou código comprovado do engine é o que falta para retomar o item. Investigação e
limites em _work/evidence/DS-2b/template-investigation.md. Isso não altera
ownership, fórmula nem autoridade de spawn; não instala ou ativa nada.

## 11. DS-2b-fix1 — fonte NPC/CLAS separada e compacta

Supersede a representação NPC_ no combat e a ausência de CLAS descritas na §10.
Fonte atual: catalog/npcs.json, 11.583 NPC_ + 220 CLAS de combat-20261024, epoch
e2-771486e30fc46d2a. CLAS.jsonl foi fornecido pelo revisor; valores localizados
por FormID, sem consulta live, troca de instância MO2 ou dados de memória.
Schema: referência Mutagen Class, Npc/NpcConfiguration/PlayerSkills. CLAS conserva
SkillWeights (18 skills), StatWeights (Health/Magicka/Stamina), BleedoutDefault,
VoicePoints, Unknown e Unknown2. Incompletude segue explícita. Não implementa
fórmula de auto-cálculo nem certifica o resultado do DNAM para AutoCalcStats.

Contrato compacto e helpers em catalog/README.md e shared/record-catalog/src/npcs.ts.
Cada record retém chave estável e assinatura; dados físicos não mudam. Provedores
por categoria são agrupados somente quando identidade, cadeia e motivo coincidem;
a regra NPC_.h/EvaluateTemplate.h da §10 continua a fonte. Stats fornece classe,
nível, skills/offsets/atributos; Traits fornece raça; SpellList fornece perks/spells;
Inventory fornece apenas referências CNTO/outfits, sem estado de inventário de ator.
RecordCatalog continua dono das definições; Damage consumirá o perfil em DS-4;
EnemySystem continua dono do spawn. Não há sorteio, criação, remoção, substituição,
respawn, segundo ActorCombatState ou I/O no hit.

Limitações repetidas ficam agregadas no bundle por campo/motivo e count. O CLI
gera fora dele a lista completa de ocorrências por record, com assinatura do
domínio para vincular o relatório à geração. Não se perde a declaração local de
null/indisponibilidade nem a razão/cadeia de template. Export CLAS agora disponível
não remove a exigência de semântica certificada pela DS-4. Templates WEAP/ARMO,
ENCH, condições e famílias já não certificadas permanecem nas mesmas condições;
nenhuma família muda de owner nesta ordem. Nenhum sistema é ativado ou instalado.

## 12. DS-2d — Q15a e fontes MGEF/ENCH/ALCH

Esta seção supersede a parada do item 2 da DS-2b (§10/§11), a ausência de ENCH
da §9 e a proposta histórica de magnitude das §4/§7 para este catálogo.
A regra normativa de Template WEAP CNAM / ARMO TNAM é a decisão Q15a do dono
(PLANO_DAMAGE_SYSTEM.md §6; REQUISITO_ENCANTAMENTOS_E_POCOES.md §5): stats físicos
do item de template, seguindo até o winner sem template; ObjectEffect fica no item.
Não se afirma que o executável herda mais campos do que essa decisão especifica.
Colunas exatas, proveniência e política de indisponibilidade em catalog/README.md
(seção DS-2d) e shared/record-catalog/src/combat.ts. Cadeia resolvida não torna
folha ausente suportada; falha nunca usa stats locais como substituto.

Valores: os exports combat-20261024 da ordem, epoch e2-771486e30fc46d2a,
instância C:\modOrganizer. SHA-256 conferidos com MANIFESTO.txt; nenhuma consulta
live ou troca de instância foi feita pelo implementador. Schemas Weapon, Armor,
MagicEffect, ObjectEffect, Ingestible, Effect/EffectData e ActorValue foram
conferidos na referência Mutagen local. Q13 segue integralmente preservada.

Os MGEF selecionados são alcançados pelos ENCH/ALCH e identificados por campos,
sem nome/descrição: Archetype.ActorValue, Type, flags e PerkToApply. Magnitudes,
durações e áreas são Effects[i].Data.* dos carriers. O registro de definições
não comprova efeito ativo. Fonte da operação percentual: entradas PERK vencedoras
identificadas abaixo, com Modification/coefficient e condições conservados no
effects.json. Os coeficientes são lidos do export, não constantes de dano.

| Família | ActorValue | Fonte da operação |
|---|---|---|
| Uma mão | OneHandedModifier / OneHandedPowerModifier | 0CF788 / 0A725C:Skyrim.esm → ModAttackDamage |
| Duas mãos | TwoHandedModifier / TwoHandedPowerModifier | 0CF788 / 0A725C:Skyrim.esm → ModAttackDamage |
| Arco/besta | MarksmanModifier / MarksmanPowerModifier | 0CF788 / 0A725C:Skyrim.esm → ModAttackDamage |
| Desarmado | Fame; UnarmedDamage | ADA501:Update.esm Effects[5] → ModAttackDamage percentual; UnarmedDamage é soma direta |
| Ataque forte | TwoHandedSkillAdvance | ADA501:Update.esm Effects[4] → ModPowerAttackDamage |
| Bash | LockpickingSkillAdvance | ADA501:Update.esm Effects[9] → ModBashingDamage |
| Armor Rating | DamageResist | soma direta ao rating; antes da curva Q4 |
| Bloqueio | BlockModifier / BlockPowerModifier | 0CF788 / 0A725C:Skyrim.esm → ModPercentBlocked |
| Resist Arrow bloqueando | AlterationSkillAdvance | ADA501:Update.esm Effects[7] → ModIncomingDamage; condições de escudo/bloqueio/projétil |
| Resist Power bloqueando | EnchantingSkillAdvance | ADA501:Update.esm Effects[16] → ModIncomingDamage; condições de escudo/bloqueio/forte |
| Furtivo (Q9, inativo) | SneakingSkillAdvance; Script/PerkToApply | ADA501:Update.esm Effects[14] → ModSneakAttackMult; perk constante 0FF15B:Skyrim.esm via MGEF 0FF15C |

Para as condições do controlador, o catálogo conserva a evidência CTDA; não
certifica que o ator tem a perk Q8, que o filtro SPID foi aplicado nem que o hit
confirma forte/bash/bloqueio. Não se pode aplicar simultaneamente a variável Q16
e a mesma contribuição do controlador novamente. Q9 bloqueia a família furtiva;
o caso Script/PerkToApply fica UNSUPPORTED também para tradução de magnitude.
MGEF com script/condição desconhecida continua UNSUPPORTED por record.
Hostile/Detrimental (inclusive Damage Armor/Weapon da função 22) ficam fora desta
seleção; magia, elementos/utilitários e efeitos omitidos nos carriers são contados.
Lista final por família e valores/evidências em _work/evidence/DS-2d/effect-families.json
e no relatório da ordem. Contrato de arrays compactos em catalog/README.md.

Q16/fonte: a magnitude de record só é válida para item/poção pronto desse winner.
Criação por jogador permanece UNSUPPORTED até encantamento/alquimia persistir a
magnitude por instância no inventário autoritativo, conforme
REQUISITO_ENCANTAMENTOS_E_POCOES.md. O DamageSystem não cria esse dado nem aceita
magnitude do cliente. Não há crafting, consumo, cronômetro, store de efeitos ou
ActorCombatState adicional nesta entrega. Nenhuma família muda de owner agora:
activation=UNSUPPORTED; o catálogo fornece definições para DS-4/DS-5.

## 13. CombatProfileProjection — fontes e donos dos campos (DS-4)

O perfil é uma projeção imutável, versionada (version=1) e publicada como uma única propriedade do host (aetheriusCombatProfile) somente quando uma fonte elegível está em active/canary. Ele não persiste um novo fato, não calcula nem aplica dano e não altera os owners da seção 7. A revisão é mantida por personagem em memória durante o processo e avança quando muda o conteúdo; reconectar o mesmo CharacterKey no processo conserva a revisão. Não há promessa de continuidade da revisão após reiniciar o processo, nem consumidor de hit integrado nesta etapa.

| Campo | Fonte autoritativa / dono do fato | Estado DS-4 e limite |
|---|---|---|
| subject.characterKey e revisão de vínculo | SessionBinding e ActorState | Player usa CharacterKey; epoch só valida o vínculo de sessão. A revisão do perfil é local ao processo, sem migration. |
| nível | Leveling / fato de classe capturado por ActorComposition | Player lê nível e revisão da mesma composição; ausente = UNSUPPORTED. NPC usa nível observado confirmado ou NPC_.level fixo. PC_LEVEL_MULT sem nível observado = UNSUPPORTED. |
| raça | Race + RecordCatalog | StableFormKey do RACE vencedor; sem record ou revisão = UNSUPPORTED. |
| skills de combate do player | Class + catalog/classes.json | Valores cumulativos de stages[].skills no nível atual (Q1/Q14), sem bônus racial. Skills ausentes = UNSUPPORTED. O perfil não aplica skills ao motor. |
| skills de NPC | record NPC_ vencedor e seu template Stats | Só valores explícitos do record com AutoCalcStats=false; auto-cálculo sem CLAS/GMSTs vencedores = UNSUPPORTED. |
| perks efetivos e origem | grants do ActorState (sourceKind + sourceKey) e compilador DS-3 | Compilação de origem CLASS; grava rank, StableFormKey, condições e resultado por regra. O catálogo PERK compacto usado em runtime omite condições CTDA completas de records como os da classe; nesses casos o compilador retorna UNSUPPORTED. Não se lê export de desenvolvimento em runtime nem se inventa regra. Outras origens não certificadas = UNSUPPORTED, preservando a origem. |
| perks do NPC | NPC_ Perks e PERK winner | A presença/proveniência do record pode ser relatada; compilador DS-3 só certifica grants CLASS, portanto perks NPC ficam UNSUPPORTED. `Perks=null` explícito é SUPPORTED vazio; uma lista presente sem nenhuma linha resolvida é UNSUPPORTED com motivo. Campo não exportado = UNSUPPORTED. |
| máximos de vida, magia e vigor | AttributeSystem e host SkyMP, lidos durante a composição | Snapshot sincronizado com a composição do personagem; override de desenvolvimento ou getter ausente = UNSUPPORTED. Para NPC, máximos ainda não resolvidos = UNSUPPORTED. |
| variáveis Q15/Q16 | instâncias ativas do ActorState do servidor | Dez famílias físicas declaradas; nesta ordem suas fontes de magnitude ativa não existem no ActorState, então cada valor é UNSUPPORTED com null. Fortify Sneak Attacks permanece INACTIVE (Q9). Record/descrição não substituem magnitude de instância; nunca aceitar valor do cliente. |
| identidade/cadeia do NPC | observação DS-0g + NPC_ e RecordCatalog | Exige observação confirmada com StableFormKey. O marcador DS-0g atualmente disponível fornece apenas geração; sem chave estável o perfil inteiro é UNSUPPORTED. Resolver/relatar a criatura observada não escolhe, troca, cria nem remove NPC (Q13). |

Inspeção do perfil NPC compõe por `actorId`, chave normalizada da observação (status, StableFormKey, geração, nível e motivo), identidade e assinatura dos catálogos NPC/race e identidade do lookup de perks. A mesma chave retorna o perfil cacheado sem recompor nem chamar `mp.set`; chave ou fonte diferente recompõe, mas só publica e avança a revisão se o conteúdo mudar. O runtime disponível não expõe callback de saída/destruição de NPC; o cache usa LRU limitado a 2.048 entradas e limpa a propriedade do host ao expulsar a mais antiga. Uma geração/observação nova substitui a entrada desse ator. O cache e a leitura não fazem I/O.

Leitura do perfil consulta somente a propriedade em memória; composição de player usa o snapshot produzido pelo ActorComposition. A troca publica um snapshot completo em um único mp.set, com revisão, para não expor campos de composições diferentes. Isso não prova que um hit consome essa revisão: consumo nativo e garantia no caminho de hit são DS-5.

## 14. DS-5a — pontes nativas e físico sem perks (25/10/2026)

Esta seção supersede o spike neutro S3 como integração de produção e a ausência
 de consumidor nativo descrita na §13. O spike e os testes históricos ficam preservados.
A implementação atual vive em aetherius_combat/ds5a/{Physical,Bridge,Host}.h.

**Ponte A:** combat-catalog-bridge.ts prepara os records efetivos do domínio combat
(Q15a já resolvida pelo catálogo), seus keywords e a contribuição legada de ENCH
DamageResist. A tabela só usa domínios reconciliados. ARMO com ObjectEffect cujo
ENCH não está completo no domínio effects fica UNSUPPORTED; não se perde a
contribuição antiga nem se presume que efeitos omitidos valem zero. A soma vem dos
carriers ENCH/links MGEF estáveis, sem reinterpretar FormIDs locais de ENCH como
globais. Nenhum enchantmentId dinâmico do cliente é aceito como magnitude.
Os GMSTs são lidos dos winners reais pela API bruta do host no boot: fDamagePCSkillMax
(skyrim.esm|0C5C0F), fArmorRatingBase (skyrim.esm|01A157) e fArmorRatingPCMax
(skyrim.esm|0C5C0C). Tipo, EDID e DATA float são conferidos; valores não estão
embutidos na ponte. Identidades confirmadas em houseCARL, instância C:\modOrganizer,
mesmo epoch e2-771486e30fc46d2a; evidência gmst-winners.jsonl em DS-5a.
A resolução usa getIdFromDesc e o nativo confere a correspondência da chave.
setAetheriusCombatCatalog recebe JSON uma vez; após aceito, o catálogo é imutável
pelo boot do host. Reenvio idêntico é idempotente; alteração exige outro boot.
Sem tabela ou tabela inicial inválida, o candidato é UNSUPPORTED. Não há JSON no hit.

**Ponte B:** aetheriusCombatProfile tem binding nativo invisível aos clientes.
Cada publicação converte uma vez por ator/revisão. Repetição idêntica não faz parse;
mesma revisão com conteúdo diferente ou revisão regressiva invalida o snapshot.
Há no máximo 4.096 conversões retidas, com referência fraca ao ator. null remove;
saída de player usa o clear já existente do Core, e atores destruídos são removidos
na manutenção (publicação, leitura de diagnóstico ou drenagem das solicitações),
fora do hit. O hit recusa referência expirada, player desconectado e geração NPC
obsoleta. Não se instala outro ActorCombatState ou store de efeitos.

A propriedade aetheriusNpcObservation agora normaliza a observação privada
confirmada do host para o contrato DS-4; NPC estático usa sua base real. Não sorteia
listas, não troca base, não gera/remove NPC (Q13). Solicitações de NPC são guardadas
num array de até 2.048 ids, drenado pelo Core a cada 250 ms; inspectNpcCombatProfile
compõe fora do hit com o cache DS-4-fix2. O primeiro hit pode ficar UNSUPPORTED.
AutoCalcStats, raças fora do domínio races e demais limitações do perfil DS-4
continuam UNSUPPORTED: esta ponte não inventa skills de NPC.

A fórmula aplica base WEAP (+ AMMO vestido para arco/besta), ou RACE desarmada;
Scaling de skill pela projeção (Archery do WEAP mapeia ao Marksman do contrato);
Scaling de ARMO pela skill leve/pesada, curva absoluta Q4, ENCH DamageResist uma vez,
bloqueio com isHitBlocked && IsBlockActive, G separado PvE/PvP e provider de refino
neutro. A confirmação de bloqueio só reutiliza o estado já disponível: NÃO certifica
geometria. Perks, forte, furtivo, bash e crítico não dão bônus ao candidato DS-5a.
Q16 fica UNSUPPORTED com contribuição zero e máscara por família no trace, mesmo
que um perfil futuro apresente variável SUPPORTED sem ativação certificada aqui.
NaN/inf/negativos/limites violados resultam em INVALID, preservando a cadeia atual.

Configuração: aetheriusCombat.families.{melee,ranged,unarmed} = off|shadow|active;
aetheriusCombat.multipliers.{pve,pvp} = número finito entre 0 e 100 (padrão 1).
Com todas off, a cadeia TES5 e suas quatro decorações é instalada sem wrapper DS-5a.
Shadow calcula o candidato e retorna sempre o resultado vigente. active é reconhecido
mas bloqueado com ACTIVE_REQUIRES_DS7; não existe cutover nesta ordem.
A chave antiga shadow/physicalRecords é histórica e não liga a DS-5a.

| Família | Owner aplicado | Candidato / estado |
|---|---|---|
| melee, ranged, unarmed | NATIVE_SERVER | AETHERIUS_SERVER / SHADOW quando configurada e com tabela válida; perfis/campos são verificados por hit |
| armadura e bloqueio | mesmo owner do golpe físico | componentes DS-5a; sem geometria certificada |
| perks, crítico, forte/bash | owner atual preservado | UNSUPPORTED_DS5B no candidato |
| Q16 | owner atual preservado | UNSUPPORTED_ZERO_CONTRIBUTION |
| magia | NATIVE_SERVER | cadeia vigente |
| procs | NATIVE_CLIENT | fora do candidato |

A tabela é conferida no boot pelo Core e exposta em systems.damage.nativeCombat.
getAetheriusCombatShadow() serializa só sob pedido os últimos 1.024 hits: revisões
dos dois lados, base, munição, Scaling, armor, ENCH, bloco, G, candidato/status e
motivo. A sequência é do buffer, nunca identidade do golpe. Sem log, banco,
arquivo, rede ou parse/alocação de JSON no cálculo do candidato.

**Deduplicação:** resolvido para a DS-5a pelo adendo 1; pendente para a DS-7.
Permanecem os cooldowns de splash e CanHit do host. Não foi adicionado cache
heurístico nem id por chamada. HitMessage com id/sequência real é pré-requisito
 da DS-7; o trace declara HOST_RECEIVED_NO_UNIQUENESS_CLAIM.

Aceites e limitações da execução estão no relatório DS-5a e em _work/evidence/DS-5a.
O script runtime/tests/ds5a-host.mjs é exclusivo do revisor, com --port e --work-dir
obrigatórios (recusa 7777, diretório não vazio e build/dist), addon, data-dir,
actor-base, target-base e weapon como argumentos. Ele usa host compilado real,
transporte bot nativo e base NPC do export, sem mock de fórmula. Não foi executado
pelo implementador; não constitui prova em jogo.
