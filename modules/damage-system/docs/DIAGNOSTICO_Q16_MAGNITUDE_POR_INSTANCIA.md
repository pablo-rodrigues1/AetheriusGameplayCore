# DS-Q16 — Magnitude por instância de encantamento e poção

Diagnóstico de código e registros em 25/10/2026, antes da DS-5. Executor: Sol 6.1, Codex, workspace C:\Code\Aetherius - SkyMP. Não altera comportamento, contrato, ownership ou gate.

## 1. Conclusão para a DS-5

O host **não guarda magnitude, duração nem lista de efeitos em Inventory::Entry**. Guarda referências numéricas e extras, inclusive capacidade/carga, que não substituem magnitude. Há magnitude/duração em definições de records e em um store nativo de alguns efeitos já aplicados ao ator; são estruturas distintas da entrada de inventário (S/Inventory.h:31–79; S/ActiveMagicEffectsMap.h:12–18; S/gamemode_events/EatItemEvent.cpp:33–55).

Na tabela, SUPPORTED significa **fonte da definição disponível para a futura DS-5**, restrita ao subconjunto certificado; não significa buff Q15 ativo ou implementação concluída. Hoje as dez variáveis Q15 estão UNSUPPORTED e a furtiva INACTIVE (G/runtime/src/combat-profile.ts:77–96). Todos os carriers do catálogo declaram activation=UNSUPPORTED (G/catalog/effects.json:1, por StableFormKey; G/catalog/README.md:250–255).

| Fonte | Conclusão | De onde a DS-5 pode ler, sem I/O no hit / lacuna exata |
|---|---|---|
| (a1) Item pronto de record | **SUPPORTED para definição**; ativação Q15 ainda UNSUPPORTED | Base de item conferida no inventário do host → ObjectEffect do WEAP/ARMO vencedor no catálogo combat → ENCH/MGEF selecionados em effects. Resolver identidades no boot; preparar/recalcular snapshot na mudança de equipamento e ler só memória no hit. Exige origem de item pronto demonstrável, peça efetivamente vestida, definitionStatus suportado e condições certificadas. Não confiar em enchantmentId arbitrário do equipamento recebido. |
| (a2) Poção pronta de record | **SUPPORTED para definição**; ativação Q15 ainda UNSUPPORTED | Base ALCH existente no inventário → tupla de effects no catálogo: magnitude, duração, área, MGEF. O host já sinaliza onEatItem(actorId, baseId); faltam, para Q15, integração de consumo aceito, duração/expiração, origem e publicação da variável no perfil. Carregar definições antes; somar/remover fora do hit, no estado de combate existente. |
| (b) Item encantado por jogador | **UNSUPPORTED** | ExtraData tem só enchantmentId/maxCharge e demais escalares. ID criado não dá record ENCH no browser do host nem chave de plugin. Encantamento precisa guardar identidade persistente de instância, origem, referências estáveis e lista de efeitos com magnitude real calculada pelo servidor, duração/área e exposição de leitura. Não usar magnitude do ENCH estático para simular a criada. |
| (c) Poção criada por jogador | **UNSUPPORTED** | A mensagem de consumo contém apenas baseId; não contém uma definição ALCH criada, efeito ou identidade de instância. Para base sem record, OnEquip retorna false antes de consumir. Alquimia precisa guardar identidade persistente, origem e efeitos reais calculados pelo servidor, com magnitude/duração/área, além de identificar a unidade consumida e seu ciclo ativo. |
| (d) Carga do encantamento de arma | **UNSUPPORTED como estado autoritativo** | maxCharge/chargePercent são extras opcionais originados no cliente. Não há escritor/decremento de carga no C++ pesquisado; a projeção de equipamento no cliente chega a substituir chargePercent por maxCharge. O domínio responsável precisa manter capacidade, saldo, custo/consumo e recarga por instância no servidor. Carga não informa magnitude. Encantamentos ofensivos de arma continuam fora do resultado da DS-5 (PLANO_DAMAGE_SYSTEM.md:95). |

Provas da tabela: §2–§5 abaixo; vínculo ObjectEffect e tuplas em G/catalog/README.md:192–205, 242–255; origem de record permitida por Q16/fonte em PLANO_DAMAGE_SYSTEM.md:181 e REQUISITO_ENCANTAMENTOS_E_POCOES.md §2/§4. O caminho de cache acima é requisito de integração futura, não código encontrado nesta ordem. Ausência de origem, definição, contexto ou semântica deve continuar UNSUPPORTED. Nenhum segundo inventário, store de efeitos ou ActorCombatState é proposto.

## 2. Escopo, baselines e convenções de referência

- **G/** = AetheriusGameplayCore/; **S/** = aetherius-server/server/cpp/server_guest_lib/; **M/** = aetherius-server/server/cpp/messages/; **B/** = aetherius-server/server/cpp/addon/property_bindings/; **C/** = aetherius-client/client/src/. Os números são linhas do arquivo atual, preservadas em _work/evidence/DS-Q16/10-source-excerpts.txt e vinculadas a hashes em 10-source-hashes.json.
- Core HEAD f34d456f14b91abbe9d5d4d1ebd5bc6f7a083436, work/gameplay, árvore inicialmente limpa. Host HEAD 6181abf1774c31a4e93206f71b784af5b13f10ae, main, com alterações locais preexistentes. Cliente HEAD 31566e83fc5f991aaa29f6ee0e868f8a558fe2ad, main, com alterações locais preexistentes. Evidência: 01-baselines.txt; o diagnóstico descreve esses fontes locais, não apenas HEAD.
- STATE.json: trilha D exige G-FUND, que está PASSED. A pausa histórica de D em 25/10 é superada para este diagnóstico pela instrução direta da sessão. Nenhum estado foi alterado. O catálogo mencionado na ordem fica em G/catalog/, não dentro de modules/damage-system/.
- Schemas consultados offline pela skill mutagen-reference: ObjectEffect/ENCH, Ingestible/ALCH, Weapon/WEAP, Armor/ARMO e MagicEffect/MGEF (07-record-schemas.json). Valores vêm exclusivamente do catálogo exportado, epoch e2-771486e30fc46d2a. A skill housecarl foi lida; não foi necessária consulta live, troca de instância MO2 ou instalação. Não se afirma que o winner instalado foi reconferido nesta sessão.

## 3. O que a entrada do host representa, guarda e transmite

### 3.1 Campos e escritores

Inventory::Entry herda ExtraData e acrescenta baseId/count. Não há UUID/instanceId, criador, sourceKind/sourceKey, data de criação ou receita nessa estrutura (S/Inventory.h:31–79). Entradas com a mesma base e extras se agregam por contagem, em vez de possuir identidade persistente individual (S/Inventory.cpp:74–103). O servidor pode receber/criar entradas pelo binding de inventário e AddItems; isso não demonstra cálculo autoritativo de um encantamento (B/InventoryBinding.cpp:13–42; S/MpObjectReference.cpp:824–883).

Na coluna ChangeForm, “sim” significa que o campo **quando presente** é serializado dentro de inv e/ou equipmentDump; não que exista em todos os itens, nem que sua origem tenha sido verificada. A cadeia comum é ExtraData::Serialize → Entry::Serialize → Inventory::Serialize → Equipment::Serialize (S/Inventory.h:20–23, 34–47, 66–71; S/Equipment.h:13–29). MpChangeForms.cpp grava inv:34/equipmentDump:52 e restaura inv:188–189/equipmentDump:216–234.

| Campo de entrada | Tipo no host / linha de S/Inventory.h | Quem fornece/escreve no caminho observado | ChangeForm |
|---|---|---|---|
| baseId | uint32_t, :78 | Base do record ou intenção do cliente; servidor cria/adiciona entradas; :69 serializa. Cliente lê changesEntry.baseId em C/sync/inventory.ts:211–224. | Sim, numérico |
| count | uint32_t, :79 | Cliente lê Count/countDelta; servidor altera ao adicionar/remover/consumir (C/sync/inventory.ts:159–160, 211–224; S/Inventory.cpp:92–145; S/MpActor.cpp:562–563). | Sim |
| health | optional<float>, :50 | Cliente: ExtraHealth arredondado; não é magnitude (C/sync/inventory.ts:151–158). Servidor pode preservar extra recebido. | Sim |
| enchantmentId | optional<uint32_t>, :51 | Cliente: ExtraEnchantment.enchantmentId, copiado sem resolver para plugin (C/sync/inventory.ts:162–168). Refere-se ao extra; encantamento fixo do record também pode existir em ObjectEffect sem este campo (S/formulas/TES5DamageFormula.cpp:90–98). | Sim, ID numérico bruto |
| maxCharge | optional<float>, :52 | Cliente: ExtraEnchantment.maxCharge, mesma extra :164. Não há cálculo de magnitude a partir desse campo no schema. | Sim |
| removeEnchantmentOnUnequip | optional<bool>, :53 | Cliente: ExtraEnchantment.removeOnUnequip, :165–167. É flag, não duração temporizada. | Sim |
| chargePercent | optional<float>, :54 | Cliente: ExtraCharge.charge, :169–170. Unidade/percentual real não demonstrado pelo nome do campo; ver §3.3. | Sim |
| name | optional<string>, :55 | Cliente: ExtraTextDisplayData.name, :179–180; pode ser removido da mensagem de container quando coincide com nome de base (C/services/services/containersService.ts:64–65). Não serve de identidade ou fonte de efeito. | Sim, se presente |
| soul | optional<uint8_t>, :56 | Cliente: ExtraSoul.soul, :176–177; tipo TS admite 0 a 5 (C/sync/inventory.ts:33). Não há cálculo de encantamento nesta entrada. | Sim |
| poisonId | optional<uint32_t>, :57 | Cliente: ExtraPoison.poisonId, :172–174. Se a funcionalidade D-P1 está ligada, servidor substitui pelo veneno da entrada possuída (S/aetherius_combat/WeaponPoison.h:99–108). | Sim, ID numérico |
| poisonCount | optional<uint32_t>, :58 | Cliente: ExtraPoison.count, :174; domínio nativo D-P1 pode criar/gastar doses (S/aetherius_combat/WeaponPoison.h:88–96). É contagem de doses, não magnitude. | Sim |
| worn (membro worn_) | optional<bool>, :59 | Cliente: ExtraWorn ou correção de Ammo (C/sync/inventory.ts:140–146, 182–184); servidor SetWorn atualiza flags (S/Inventory.cpp:46–70). | Sim |
| wornLeft | optional<bool>, :60 | Cliente: ExtraWornLeft (:185–186); servidor SetWorn. GetWorn prioriza Left quando ambos estão marcados (S/Inventory.cpp:32–43). | Sim |
| magnitude / duration / effects / origem | **Não existem** na entrada | Lista fechada em S/Inventory.h:31–79 e C/sync/inventory.ts:26–45. | Não como dados da entrada |

Equipment contém inv, quatro IDs opcionais de spells e numChanges uint32_t, serializados em S/Equipment.h:16–29; não acrescenta efeitos nem identidade de instância. O comentário “Doesn't parse extra data currently” em Inventory.h:19 está desatualizado: o código de FromJson efetivamente chama Serialize (Inventory.cpp:21–29, 191–204), incluindo todos os extras acima.

### 3.2 Mensagens, persistência e limite de autoridade

- UpdateEquipment serializa idx e Equipment; SetInventory serializa Inventory (M/UpdateEquipmentMessage.h:18–27; M/SetInventoryMessage.h:12–18). JSON e binário usam a mesma função Serialize (M/MessageBase.h:31–53). Inventory.cpp:184–204 e Equipment.cpp:12–32 confirmam o round-trip pelo schema.
- Cliente monta getInventory por container base + alterações/extras, depois getEquipment inclui esse inventário inteiro, não só peças vestidas (C/sync/inventory.ts:205–240, 306–312; C/sync/equipment.ts:82–90). SendInputsService envia isso em mensagem reliable ao mudar equipamento (C/services/services/sendInputsService.ts:283–305). O id de encantamento não é convertido ali.
- Host confere posse **por baseId**, spells aprendidas e conflitos de slots; depois publica para vizinhos e grava o equipamento recebido (S/ActionListener.cpp:325–405, 407–479; S/MpActor.cpp:242–246). Essa checagem não certifica que enchantmentId/maxCharge/chargePercent correspondam à instância possuída. O ramo D-P1 concilia veneno, sem converter os demais extras em efeitos autoritativos (S/aetherius_combat/WeaponPoisonHost.h:140–157; WeaponPoison.h:99–117). Nada foi ligado nesta ordem.
- PutItem/TakeItem também herdam e serializam ExtraData (M/PutItemMessage.h:7–27; M/TakeItemMessage.h:7–27); ActionListener copia esses extras para Entry e zera worn em PutItem (S/ActionListener.cpp:617–653). O cliente espalha a entrada obtida do diff nessas mensagens (C/services/services/containersService.ts:33–72). DropItem tem só baseId/count, sem extras (M/DropItemMessage.h:11–20).
- O inventário autoritativo e o equipamento têm portas JSON distintas: B/InventoryBinding.cpp:4–10 e B/EquipmentBinding.cpp:5–13. SetInventory e AddItems gravam inv; SetEquipment grava equipment, não copia automaticamente todos os extras recebidos para inv (S/MpObjectReference.cpp:824–883; S/MpActor.cpp:242–246). O host retransmite seu inventário ao dono com SetInventoryMessage (S/MpObjectReference.cpp:1900–1907).

Portanto, “existe no equipamento persistido” não prova “foi criado/calculado pelo servidor”. Tampouco um enchantmentId extra nulo prova ausência de ObjectEffect no record base: são vias distintas (S/Inventory.h:51; S/formulas/TES5DamageFormula.cpp:90–98).

### 3.3 Carga de arma

O host apenas declara, serializa e compara maxCharge/chargePercent nos caminhos pesquisados (03-search-extra-data.txt; S/Inventory.cpp:78–84). Não foi encontrado escritor de saldo, gasto no hit ou regra de recarga de encantamento no conjunto server/cpp. Ausência nessa busca tem esse alcance, não é prova sobre serviços externos não inspecionados.

No cliente, chargePercent recebe ExtraCharge.charge (:170), é passado a AddItemEx (:426) e fica **excluído** de extrasEqual (:122). Na projeção applyEquipment, removeUnnecessaryExtra substitui chargePercent por maxCharge (C/sync/equipment.ts:66–78, 109–118). Isso impede tratar o campo como saldo autoritativo confiável, ou inventar a relação carga → magnitude. A sonda nem captura carga: EquipmentItem contém apenas base/count/hand/health/enchantmentId/poisonId/poisonCount (S/aetherius_combat/CombatProbe.h:222–228).

## 4. Encantamentos e poções criados: ID transmitido, resolução e sessão

### 4.1 O que chega do cliente

ExtraEnchantment.enchantmentId é copiado literalmente; nenhuma magnitude ou lista de efeitos acompanha o extra (C/sync/inventory.ts:162–170). Ao recriar item, o cliente tenta Game.getFormEx(enchantmentId) e o converte para Enchantment (C/sync/inventory.ts:416–430). A mensagem de crafting relacionada carrega workbench, craftInputObjects e resultObjectId, não uma definição de resultado com efeitos/magnitudes (C/services/services/craftService.ts:33–65; M/CraftItemMessage.h:12–25). Esta observação se limita ao transporte; não inspeciona nem altera serviços de inventário/economia do gamemode.

**Um encantamento criado chega com índice FF?** O transporte aceita e repassa o número do extra sem normalização. O código diagnóstico do host trata explicitamente a faixa FF como created record fora da load order, devolvendo CREATED_RECORD_NOT_IN_LOAD_ORDER (S/aetherius_combat/CombatProbe.h:869–875). Isso prova o tratamento para um ID dessa faixa, mas **não prova que uma criação real foi emitida/aceita nesta instalação**: nenhuma amostra não nula foi encontrada (§6). Não é correto inventar uma amostra de FF ou afirmar criação funcional em jogo.

### 4.2 StableFormKey e continuidade

Para IDs de plugin, PluginIndexMapping recupera nome do plugin e parte local, tanto FULL quanto LIGHT; a direção inversa usa o nome, sem persistir posição (S/PluginIndexMapping.cpp:248–297). Entretanto, Entry persiste os números diretamente (Inventory.h:38–45, 69), sem executar essa conversão na serialização.

Para faixa FF, RuntimeFormIdToFormDesc retorna parte numérica e **arquivo vazio** (:252–253); a inversa só recompõe a faixa (:277–278). Isso não é StableFormKey de record, pois não existe plugin de definição. ResolveEnchantment recusa esse caso e, para um ID de plugin, exige ENCH e todos os MGEF resolvidos, retornando magnitude/área/duração **do record**, somente na leitura sob pedido (S/aetherius_combat/CombatProbe.h:857–911). “SUPPORTED” desse resolver significa definição resolvida, não magnitude de instância certificada nem família Q15 suportada.

**Esse ID muda entre sessões? Não provado.** Os fontes de transporte examinados não mostram criação nativa, persistência de definição criada ou rebinding entre sessões. Não há par de amostras do mesmo item/poção criado antes/depois de reconectar. Não se afirma que todo FF muda; afirma-se que não existe garantia de identidade persistente demonstrada e que um FF sem plugin não pode ser promovido a StableFormKey. Uma tabela de IDs de runtime persistidos também não provaria a existência da definição correspondente no servidor.

### 4.3 Poção consumida: dado conhecido e ciclo nativo existente

O cliente envia OnEquip para poções/ingredientes como intenção unreliable contendo só baseObj.getFormID(), sem extra da unidade consumida (C/services/services/sendInputsService.ts:57–77; M/OnEquipMessage.h:11–17). ActionListener chama OnEquip(baseId) para o ator da sessão (S/ActionListener.cpp:736–753).

OnEquip resolve baseId no browser; sem record retorna false (:480–486). Para ALCH, exige posse, distingue veneno, chama EatItem para poção comum e remove uma unidade; o evento Papyrus OnObjectEquipped recebe o record e None, não origem de criação (S/MpActor.cpp:494–570). O ramo veneno é separado e permanece suspenso por Q25; não foi reativado.

EatItem dispara onEatItem(actorId, baseId); no sucesso, lê effects do ALCH e converte IDs de MGEF pelo winner antes de ApplyMagicEffects (S/MpActor.cpp:1153–1159; S/gamemode_events/EatItemEvent.cpp:17–55). Logo o host conhece efeitos, magnitude, duração e área **da definição ALCH disponível**, sem recebê-los como resultado final do cliente. A mensagem de consumo não carrega criador, skill, receita, sourceKind/sourceKey ou instância persistente.

Há um store nativo preexistente: ActiveMagicEffectsMap::Entry tem efeito completo, timerId e endTime; o mapa é por ActorValue e Add substitui o valor existente (S/ActiveMagicEffectsMap.h:12–18, 25–29, 43). Seu JSON guarda effectId, magnitude, duration, areaOfEffect, actorValue e endTime, mas não ALCH de origem nem unidade consumida (S/ActiveMagicEffectsMap.cpp:61–74); esse JSON entra em ChangeForm.effects (S/MpChangeForms.cpp:78, 298). **Isso não contradiz a ausência de magnitude na entrada de inventário.**

ApplyMagicEffect trata CureDisease e restringe seus ramos a Health/Magicka/Stamina, taxas e multiplicadores de regeneração (S/MpActor.cpp:1938–1975). Só o ramo de taxa/multiplicador cria cronômetro e grava o mapa (:1979–2023), substituindo o timer por AV. Os AVs físicos Q15 não têm ramo ali; o perfil também os mantém sem fonte (:77–96 de G/runtime/src/combat-profile.ts). Portanto não há suporte genérico de buffs físicos, soma por origem ou ativação de poção Q15 só porque existe onEatItem e um store nativo. Um eventual consumidor deve integrar o ciclo existente conforme os donos do fato, sem criar store paralelo nesta ordem.

Para poção criada cujo ALCH é só um form do cliente, aplica-se o mesmo limite de identidade: transmite-se apenas baseId; sem record no browser nem definição persistida de efeitos o servidor não chega ao ciclo de consumo. O comportamento efetivo de uma criação real FF, e sua continuidade entre sessões, permanecem não provados (§6).

## 5. O que já existe no catálogo e o que ele não certifica

G/catalog/effects.json:1 contém 37 MGEF, 111 ENCH e 44 ALCH; esquema compacto em G/shared/record-catalog/src/effects.ts:1–5. Cada tupla é [MGEF estável, magnitude, duração em segundos, área, índice original do efeito, sem condições]. Os campos vêm do export vencedor; catálogo declara magnitudeSource=PREMADE_RECORD_ONLY e activation=UNSUPPORTED (G/catalog/README.md:213–255). A signature do domínio e SHA-256 estão em 11-catalog-check.json.

Exemplos **de catálogo**, não amostras de item consumido/equipado:

| Carrier, por StableFormKey | MGEF | Magnitude / duração / área | Limite |
|---|---|---|---|
| ENCH skyrim.esm\|064929 | skyrim.esm\|07A0FF | 12 / 0 s / 0 | Índice original 1; outro efeito do carrier fica excluído do recorte. ENCH winner Skyrim.esm; MGEF winner Thaumaturgy.esp. |
| ALCH skyrim.esm\|039954 | skyrim.esm\|03EB19 | 30 / 60 s / 0 | ALCH e MGEF winners Apothecary.esp; um efeito no recorte. |

Ambos têm definitionStatus=SUPPORTED, mas activation=UNSUPPORTED. Os exemplos demonstram a fonte e evitam presumir um único número por família; não provam posse, consumo, origem ou ativação de nenhuma instância. Consulta por chave em G/catalog/effects.json:1; recorte completo em 11-catalog-check.json. ObjectEffect permanece no item quando stats físicos vêm de Template (G/catalog/README.md:192–205; G/modules/damage-system/docs/FONTES_E_DONOS.md:295–305).

O catálogo é recortado: ausência nele não significa que um ENCH/ALCH inexiste em todos os plugins. Scripts/condições não certificados, MGEF fora do filtro, definições incompletas e efeitos ofensivos não ganham suporte por associação. O host atual já soma DamageResist do ENCH do record ARMO (S/formulas/TES5DamageFormula.cpp:71–99); a DS-5 deve preservar essa contribuição sem aplicá-la de novo pela variável Q16. Ownership não mudou nesta análise (G/modules/damage-system/docs/FONTES_E_DONOS.md:334–351).

## 6. Registros reais: resultado da busca, sem extrapolação

Foram processadas todas as linhas não vazias das nove sondas JSONL existentes em _work/evidence/DS-0/probe/: **8.182 linhas válidas, zero erro de JSON, 535 campos enchantmentId e todos null**. Contagens são ocorrências em snapshots/transições, não itens distintos.

| Arquivo combat-probe-* | Linhas JSON | enchantmentId null | IDs não nulos |
|---|---:|---:|---:|
| sessao-20261023.jsonl | 810 | 75 | 0 |
| sessao2-20261023.jsonl | 448 | 95 | 0 |
| sessao3-20261024.jsonl | 313 | 30 | 0 |
| sessao4-20261024.jsonl | 352 | 29 | 0 |
| sessao5-20261024.jsonl | 234 | 56 | 0 |
| sessao6-20261024.jsonl | 2.551 | 84 | 0 |
| sessao7-20261024.jsonl | 1.734 | 56 | 0 |
| sessao7b-ate-1734.jsonl | 3 | 0 | 0 |
| sessao8-20261024.jsonl | 1.737 | 110 | 0 |

Amostras com o **campo**, identificadas por record: sessao8-20261024.jsonl:1, equipped[0], baseDesc 00156E:Grimoire.esp, enchantmentId=null; mesma linha, equipped[2], baseDesc 000835:Sentinel.esp, enchantmentId=null. Não são amostras de encantamento real. Não se classificam como ID de plugin nem FF, nem se inventa um JOIN no catálogo para null.

Em H, a busca textual por enchantmentId/CREATED_RECORD_NOT_IN_LOAD_ORDER não encontrou ocorrência nos arquivos de raiz existentes no início (logs, documentos e ChangeForm) nem nos quatro crash logs históricos de 10/10. Manifesto em 02-input-manifest.json; resultados 06-search-H-enchantments.json e 06-search-H-crash.txt. Relatórios de processo em node-reports não foram abertos: não são sondas de item e podem incluir ambiente/credenciais. Registros novos de H da sessão paralela não foram usados nem alterados. A conclusão de ausência se limita a esse conjunto seguro explicitamente identificado.

**Classificação efetivamente possível: zero IDs de plugin, zero IDs criados, zero comparações com effects.json.** O contexto da ordem pressupunha uma observação de enchantmentId por item; os arquivos indicados provam a existência do campo e do schema, mas não forneceram um valor não nulo. Isso é divergência de evidência, não evidência de que o jogo nunca tenha itens encantados. O capturador também tem limites de retenção/truncamento e não inclui carga (S/aetherius_combat/CombatProbe.h:222–238, 398–419); a busca não é inventário exaustivo de todos os itens em todas as sessões.

## 7. O que permanece sem prova e condições de avanço

1. **Não provado em jogo:** criação de ENCH/ALCH por jogador, ID FF realmente emitido/aceito, resolução de definição criada no servidor ou mudança/conservação desse ID entre sessões. Faltam registros do mesmo item criado e da mesma poção antes/depois de reconexão; esta ordem não produz sessão em jogo.
2. **Não provado:** vínculo de um enchantmentId não nulo observado ao catálogo, pois não houve amostra. É preciso preservar no registro a base e a identidade do encantamento, distinguindo plugin de definição de arquivo vencedor. Nenhuma classificação foi presumida por nome.
3. **Não provado como autoridade:** magnitude criada, duração criada, proveniência e saldo/custo de carga por instância. O domínio responsável deve persistir resultados calculados no servidor com identidade estável e expor uma leitura; o DamageSystem não calcula crafting nem aceita resultado do cliente (REQUISITO_ENCANTAMENTOS_E_POCOES.md §3).
4. **Não implementado/sem prova de ativação:** alimentar/somar/remover variáveis Q15 por equipamento/consumo e expiração, uso de uma única revisão no hit, cache e ausência de I/O desse futuro caminho. G/runtime/src/combat-profile.ts:77–96 permanece a fonte atual dos estados UNSUPPORTED/INACTIVE.
5. **Não executados:** servidor, jogo, banco, build ou testes funcionais. O aceite desta ordem é documental e por busca de código/registros; evidências não equivalem a homologação do comportamento nativo.

Reprodução das buscas e extrações: node _work/evidence/DS-Q16/audit.mjs; saída integral em 13-audit-command.txt. O script usa somente o manifesto congelado para sondas/H e as raízes de fontes indicadas, escreve apenas em _work/evidence/DS-Q16 e não inicializa servidor. Snapshot e relatório de entrega estão registrados em _work/orders/DS-Q16-diagnostico-magnitude.result.md.
