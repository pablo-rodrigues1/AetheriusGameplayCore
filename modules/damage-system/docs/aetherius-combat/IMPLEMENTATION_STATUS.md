# Estado da implementação

> [!NOTE]
> Este status descreve a entrega experimental original. A restrição histórica de manter mudanças dentro da pasta DamageSystem não é uma regra arquitetural atual. Consulte [a arquitetura canônica](../../../../docs/architecture/AETHERIUS_GAMEPLAY_CORE_ARCHITECTURE.md) para Host APIs, ownership e ordem de implementação.

**Entrega de infraestrutura e integração física experimental. Não é release completo nem produção validada.**

A restrição de pasta impede aplicar alterações nos projetos externos. O código novo vive em `server/server/cpp/server_guest_lib/aetherius_combat`; as alterações em arquivos existentes da Base e do ClassSystem são patches em `integration/`, exercitados somente em cópias internas ignoradas. A fórmula `TES5DamageFormula` e os decorators originais não foram alterados.

| Requisito | Estado real |
|---|---|
| Settings nativos / schema / dual mode | Implementados; patch preserva cadeia legacy inteira e seleciona apenas Aetherius no novo modo |
| ArmorCurve | Implementada e testada em todos os limites solicitados |
| CombatProfile exato, schema e revision | Implementado e testado; origem CLASS, ausência de skill = 0 |
| MpActor / persistência | Patch adiciona estado em Impl e profile no change form, com leitura backward-compatible da ausência do campo; schema desconhecido rejeitado |
| API ScampServer | Patch implementa apply/get, valida ID, tamanho, schema, catálogo/rank e stale revision; addon ainda não compilado |
| ClassSystem | Adapter real chamado por repository no load/save quando o modo está ativo; skills vêm de resolveSkillsForClassAndLevel; seis mappings corrigidos |
| Reconciliação cliente | Patch aplica valor exato, inclusive redução; profile publica as 18 skills para remover sobra de classe anterior |
| FALLBACK_MOCK | Resolver de produção retorna UNRESOLVED; mock exige opt-in explícito em testes; adapter ignora unlockedPerksData e exige catálogo |
| Equipamento | Adapter libespm usa winners, worn e keywords com resolução source-aware; cache por revisão; não lê arquivo/DB por golpe |
| Dano físico | Núcleo testado: base + modificadores -> skill -> perks -> ataque autorizado -> crítico -> global -> block -> armor |
| Block | Magnitude configurável, skill e Mastery; patch limpa flag cliente antes de recomputar geometria existente |
| Power / sneak / bash | Núcleo recebe modificador já autorizado; adapter nativo não concede bônus a flags do pacote. Autorização por animação e regras específicas pendentes |
| Crítico | RNG injetável e componente independente testados; adapter nativo mantém chance 0 até resolver CRDT e condições reais |
| Vokrii | Seis Masteries auditadas e nove efeitos traduzidos; cobertura ampla das 162 perks da configuração pendente; nenhum handler desconhecido é aceito no profile |
| Identidades / ESPFE | StableFormKey normalizado; bridge usa resolver atual da Base sem aritmética de slots; roundtrip na instalação nativa ainda não executado |
| Catálogo | Housecarl compila metadados; startup verifica CRC32/size por Loader.GetFilesInfo, winner e EditorID por libespm. SHA256 fica na auditoria. Não substitui manifestGen |
| Profession providers | IItemCombatModifierProvider e ICombatModifierProvider têm registry, validação, combinação, revisão e provenance; ICombatProfileProvider define fronteira; nenhuma dependência de profissão |
| Refino por instância | **Ainda não integrado**: provider neutro por padrão; native Inventory ainda não oferece identidade persistente de instância. Nenhum extra health vindo do cliente é usado como refino. Regra de integração: aplicar o tier persistente em cada hit/defesa elegível, **sem consumir/decrementar o tier no combate** |
| Efeitos | Store por instância, sete regras, scheduler central, cancelamento de canal, persistência/restart e expiração testados; conexão ao tick/change form real pendente |
| Magia | Núcleo por componente Health/Magicka/Stamina, elemento, caps, weakness e absorption testado; magnitude é por pulso, duração é responsabilidade do scheduler |
| SPEL/MGEF/ENCH runtime | Bloqueados na fórmula experimental até auditoria/tradução e build nativa verificável; spells e armor encantada produzem erro explícito, sem fallback silencioso |
| Resistências / buffs reais | Snapshot estruturado existe; derivação de records/efeitos reais ainda pendente |
| Métricas | Adapter registra hits, dano físico e tempo acumulado no registry existente; sem endpoint paralelo. Smoke test não compilado no toolchain disponível |
| Lifecycle | Módulo registra initialize/shutdown/healthCheck no module-registry; sem enforcement em JS/hit-events |
| Health / morte | Patch altera somente denominador do hit para Health autorizativa do profile no modo Aetherius. NetSetPercentages e death-service continuam no caminho original |
| Atributos fora do hit | Reconciliação completa de máximos, regeneração, poções e mensagens de criação ainda requer integração nativa testada; não se declara concluída |
| NPCs / PvE | Sem provider de profile NPC, o modo experimental recusa atores sem profile; não usa skills inventadas |
| Segurança / replay | Ownership, source equipada, células e antispam originais preservados. Deduplicação de pacotes com identidade de ataque ainda não implementada; não confundir cooldown de hit com garantia de replay |
| Manifest / integridade de conexão | manifestGen atual preservado; extensão combat/class/catalog no handshake pendente |
| Build e validação no Skyrim | Bloqueados: vcpkg não inicializado e compilador MSVC C++ exigido pela Base indisponível; testes em jogo, duelo/PvE e raid reais não executados |

Decisões de balanceamento, não claims de paridade vanilla: Armor skill inicial `1+.005*skill`; Block inicial `baseReduction + reductionPerSkill*Block`, vezes a Mastery, limitado pelo cap. Valores de Block estão explícitos na configuração. A curva padrão mantém exatamente 500=80% e 1000=90%, sem armor oculto.

**Regra normativa futura (não implementada nesta entrega):** Tier I/II/III (respectivamente +25/+50/+75% sobre a base elegível) permanece na instância de arma/armadura/escudo e influencia todos os eventos físicos pertinentes. A fórmula lê o tier a cada cálculo via snapshot, aplica o multiplicador uma única vez por cálculo e não executa nenhuma mutação/consumo de tier no hit. Só a operação de refino pode promover o tier por sucesso ou regredi-lo por falha total ao tentar o seguinte. O consumo de cargas de manutenção é independente; mudanças de tier exigem revisionamento/invalidação do cache. Ver [RefinementSystem](../../../refinement-system/README.md).

O cache de equipamento inclui perfil, equipamento/aparência, efeitos e providers. Providers com dados mutáveis devem chamar `Invalidate()` após alteração autorizada. Sem identificador de instância, equipar duas armas com o mesmo baseId é recusado explicitamente em vez de selecionar o refino errado. Matching set, encantamentos e debuffs reais não estão conectados.

O profile persistido está vinculado ao change form e identidade de ator já existentes; não há mapa de progressão paralelo no C++. O revisionamento protege substituição atômica do profile validado em memória. A gravação de progressão do ClassSystem e a gravação nativa não constituem uma transação distribuída de banco.

Não existe HOUSECARL_BLOCKER.md porque o Housecarl está disponível. Pendências de cobertura não são indisponibilidade da ferramenta. A ordem do prompt exige validar integração nativa antes de avançar a runtime mágico e hardening; a falta dessa build bloqueia a certificação e ativação. Infraestrutura independente foi implementada e testada apesar desse bloqueio.

Próximos passos necessários: prover o toolchain da Base e submódulos, compilar addon/servidor e executar golden/integração; completar profiles NPC/atributos e identidade de item; auditar/traduzir demais perks e magia; conectar effects/tick/resources e testar reconnect/replay/handshake no jogo. **Manter legacy até esses passos.**
