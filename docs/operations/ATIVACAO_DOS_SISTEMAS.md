# Ativação dos sistemas do GameplayCore num servidor

Para quem vai ligar os sistemas do Core no servidor oficial. Atualizado em 09/10/2026.

Cada sistema do Core (pedras guardiãs, raças, e os que vierem) precisa de duas coisas no servidor onde roda: **tabelas próprias no PostgreSQL** e **uma opção de configuração que o liga**. No ambiente de desenvolvimento local esses dois passos foram feitos à mão a cada sistema. Este documento descreve o que foi feito, para ser repetido no servidor oficial com as diferenças necessárias.

Este documento não cobre a instalação do pacote (compilar o Core, compilar o servidor, registrar o Core no gamemode). Isso é assunto do guia de instalação, ainda a escrever (`integrations/host/INSTALL.md`). Aqui presume-se o Core já instalado e carregando.

## 1. O que o Core faz e não faz no banco

- Usa o PostgreSQL que o gamemode já usa, pelo mesmo pool (`server/gamemode/core/pg.js`). A conexão vem de `GAME_DATABASE_URL` ou, se ausente, de `DATABASE_URL`. O Core não cria conexão própria.
- Cria e usa **somente** tabelas com prefixo `gc_`. Não lê, não altera e não apaga nenhuma tabela existente (`users`, `sessions`, tabelas do painel, do gamemode ou dos serviços legados). O executor de migrations recusa qualquer arquivo que toque tabela sem o prefixo.
- As migrations são só aditivas: criam tabela e índice. Nenhuma altera ou remove coisa existente.

## 2. Tabelas, por migration

Arquivos em `database/migrations/`, mais a migration B5b em
`runtime/src/projection/migration.ts`, incluída pelo mesmo CLI e bundle, aplicados em ordem.

| Migration | Tabelas | Para quê | Quem precisa |
|---|---|---|---|
| `0001_gc_schema_migrations.sql` | `gc_schema_migrations` | controle: quais migrations foram aplicadas e a assinatura de cada arquivo | todos |
| `0002_gc_commands.sql` | `gc_commands` | registro de comandos, para que uma ação repetida não tenha efeito em dobro | todos |
| `0003_gc_spell_projection.sql` | `gc_spell_projection_heads`, `gc_spell_projections` | o que o Core já aplicou de feitiços em cada personagem, para enviar só a diferença e nunca remover o que não concedeu | pedras guardiãs e qualquer sistema que conceda feitiço |
| `0004_gc_standing_stone_choice.sql` | `gc_standing_stone_choice` | a pedra guardiã escolhida por personagem | pedras guardiãs |
| `0005_gc_race_observation.sql` | `gc_race_observation` | a raça que o servidor observou em cada personagem | raças |
| `0006_gc_character_class.sql` | `gc_character_class` | classe escolhida e revisão por personagem; não altera XP | classes |
| `0007_gc_leveling_progress.sql` | `gc_leveling_progress` | XP total, nível e estado de fadiga do único writer Leveling | adaptador Leveling e leitura de nível pelas classes |
| `0008_gc_perk_projection.sql` (runtime) | `gc_perk_projections` | aplicação confirmada de perks, autoria e revisão por personagem; proteção permanente de perks preexistentes | entrega B5b |

D-P1 não cria migration: revestimento e cargas usam o inventário nativo existente; o bônus por ator e os ticks do veneno são transitórios. Não há ledger ou store de efeitos novo.

FIX-1010 também não cria migration: a revisão da composição usa a cabeça já existente em `gc_spell_projection_heads`. Nenhuma tabela legada ou dado de `aetherius_dev` foi alterado pelo executor.

Cada sistema novo acrescentará a sua migration, com o próximo número. Esta tabela deve ser atualizada junto.

A identidade do personagem em todas as tabelas é `profile:<profile_id>`, com o `profile_id` da plataforma. No host atual, o Core usa exclusivamente `mp.aetheriusOfficialIdentity.session(actorId)`, confirma `isCurrent` e exige que o `profile_id` coincida com `mp.get(actorId, 'profileId')`. Nova sessão oficial recebe novo epoch do Core, mesmo com o mesmo ator e perfil. Nenhuma tabela guarda FormID de runtime nem posição de plugin.

O servidor oficial roda em `offlineMode=true` com login por token do site. Esse modo não identifica desenvolvimento. Ator sem sessão oficial não recebe vínculo, inclusive se a opção de identidade offline estiver configurada.

## 3. Como aplicar as migrations

Na raiz do Core, com o mesmo ambiente do gamemode (a variável de conexão definida no ambiente do processo, nunca em argumento):

```powershell
npm run migrations:status -- "<caminho absoluto>\gamemode\core\pg.js"
npm run migrations:apply  -- "<caminho absoluto>\gamemode\core\pg.js"
npm run migrations:status -- "<caminho absoluto>\gamemode\core\pg.js"
```

- O primeiro `status` mostra o que já está aplicado. O `apply` aplica só o que falta, numa única transação: ou entra tudo, ou nada. Repetir o `apply` não faz nada.
- Um terceiro argumento opcional é o schema; o padrão é `public`.
- **Aplique com o servidor do jogo parado ou com os sistemas do Core desligados.** As migrations só criam tabelas, então não travam nada do que já existe, mas ligar um sistema no meio da aplicação não foi testado.
- **Não edite um arquivo de migration já aplicado.** O Core guarda a assinatura de cada arquivo e recusa subir os sistemas que dependem do banco se um arquivo aplicado tiver mudado. Correção entra como migration nova. O repositório fixa o fim de linha desses arquivos (`.gitattributes`) para a assinatura ser a mesma em qualquer máquina; não os converta.
- Faça backup do banco antes, como em qualquer mudança de schema.

**O servidor não aplica migrations sozinho.** Se faltar alguma, o Core sobe, deixa indisponíveis os sistemas que dependem do banco, e escreve no log o comando a rodar. O servidor do jogo não cai por isso.

## 4. Opções de configuração

Ficam no `.env` do gamemode. O Core lê todas no boot; mudar exige reiniciar o servidor ou recarregar o gamemode.

### Sempre necessárias

| Opção | Valor | Efeito |
|---|---|---|
| `ENABLE_GAMEPLAY_CORE` | `true` | o gamemode carrega o Core |
| `GAMEPLAY_CORE_BUNDLE` | caminho do arquivo `aetherius-gameplay-core.cjs` | onde está o pacote compilado |

### Uma por sistema: o modo

`GAMEPLAY_CORE_MODE_<SISTEMA>`, com o nome do sistema em maiúsculas e `_` no lugar de `-`. Sistemas existentes: `GAMEPLAY_CORE_MODE_STANDING_STONES`, `GAMEPLAY_CORE_MODE_RACES`, `GAMEPLAY_CORE_MODE_CLASSES`. Leveling tem adaptador durável, mas nenhuma fonte de eventos ligada: aparece `UNSUPPORTED` no relatório de capacidades mesmo se `GAMEPLAY_CORE_MODE_LEVELING` for configurado.

| Modo | O que o sistema faz |
|---|---|
| `off` (padrão) | nada; o jogo se comporta como se o sistema não existisse |
| `audit`, `shadow` | observa e registra no log o que faria; não grava e não altera o jogo |
| `canary` | age só para os personagens listados em `GAMEPLAY_CORE_CANARY_CHARACTERS` |
| `active` | age para todos |

Valor inválido é tratado como `off`, com aviso no log. Sistema ausente da configuração fica `off`.

### Opcionais

| Opção | Uso |
|---|---|
| `GAMEPLAY_CORE_CANARY_CHARACTERS` | lista separada por vírgula, no formato `profile:<profile_id>`; vale para os sistemas em modo `canary` |
| `GAMEPLAY_CORE_DATABASE_SCHEMA` | schema das tabelas `gc_`; padrão `public`. Tem de ser o mesmo usado ao aplicar as migrations |

### Entrega de perks no cliente (B5b)

`GAMEPLAY_CORE_CLIENT_PERKS_MODE=off` por padrão. `active` habilita a conversa
para bindings autenticados; `canary` só para `GAMEPLAY_CORE_CANARY_CHARACTERS`.
`audit` e `shadow` não iniciam a conversa nem aplicam perks. A migration 0008
é obrigatória; sua ausência desabilita só esta entrega, mantendo a fundação
anterior. A opção não é de desenvolvimento e não contorna a trava B1-fix1.

Instalar o cliente conforme `integrations/client/LEIA-ME.md`. Serviço passivo
até hello do Core. Cliente antigo: perks `CLIENT_UNSUPPORTED`, readiness pela
aproximação de três segundos. Cliente novo: begin/challenge/ready acompanha as
tarefas conhecidas de spawn, nos caminhos com/sem loadGame, e invalida cada
ciclo anterior. Não muda o removeAllSpells/reaplicação já existente.

### Veneno no host nativo (D-P1) — configuração

A opção `aetheriusCombat.weaponPoison` é um booleano de **server-settings.json**, lido no construtor C++ do addon, não uma variável do `.env`. Ausente ou `false`: comportamento antigo. `true`: habilita o revestimento e o golpe com veneno. Alteração exige reiniciar o processo nativo; recarregar só o gamemode não altera a opção. Não habilita `aetheriusCombat.shadow`.

```json
"aetheriusCombat": { "weaponPoison": true, "shadow": false }
```

Sem Core, o host usa uma carga por dose. Com Core e classes em `active` (ou personagem selecionado em `canary`), a composição entrega `aetheriusPoisonDoseBonus`, propriedade nativa em memória, inteira de 0 a 65534. `mp.get(actorId, 'aetheriusPoisonStatus')` expõe resultado e máscara das famílias recusadas, para diagnóstico. O cliente não escreve esses valores. Os modos de classe não habilitam o C++ por si só.

### Só desenvolvimento: **não usar no servidor oficial**

Todas as opções abaixo usam a mesma trava: `NODE_ENV=local` explicitamente, `GAME_ACCESS_CONTROL` diferente de `true` e `GAMEPLAY_CORE_ALLOW_DEV_OPTIONS=true`. Ausência de `NODE_ENV` nunca conta como local, mesmo que `server-options.js` escolha o arquivo local por padrão. `production` e `staging` recusam as opções. O ambiente vem de `env: process.env` no descriptor do gamemode, depois de carregar seu `.env`; `GAME_ACCESS_CONTROL` é a mesma variável lida pelo AccessControl do host.

Fora dessa combinação, **a presença da opção, inclusive vazia ou `false`, é recusada com `ERROR`, nome e motivo no log**. Remova a opção para retomar o comportamento normal. A confirmação `GAMEPLAY_CORE_ALLOW_DEV_OPTIONS` não liga nenhum sistema por si só e também deve estar ausente no oficial.

| Opção | Por que não |
|---|---|
| `GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV=true` | aplica migrations no boot somente com a trava local acima. Se recusada, não adquire o pool nem aplica migrations e deixa indisponíveis os sistemas dependentes do banco. No oficial as migrations são aplicadas à mão, com backup |
| `GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY=true` | aceita perfil sem autenticação somente em host antigo, sem `aetheriusOfficialIdentity`, com a trava local acima. Recusa bloqueia vínculos nesse host antigo, sem retornar silenciosamente à identidade normal. No host atual sempre exige sessão oficial; esta opção não contorna o login |
| `ENABLE_STANDING_STONE_SPIKE=true` | liga o protótipo antigo (`spike_*`) somente com a trava local acima. Recusada, não inicia o spike; os sistemas atuais independentes seguem. Nunca junto com pedras em `canary`/`active`: o sistema novo recusa iniciar. No oficial deixe ausente |
| `GAMEPLAY_CORE_DEV_CLASS_LEVEL=<1..40>` | **Nunca no servidor oficial.** Com a trava local acima, `40` compõe todos os marcos sem gravar nível ou XP. Recusada, vazia, inválida ou fora de 1–40: **ERROR**, classes `UNSUPPORTED`, sem iniciar nem usar nível real em silêncio. Removida a opção, volta ao Leveling. Quando aceita, registra **DEV** e mostra essa origem na capacidade e explicação. Com B5b, a entrega depende também do modo de perks habilitado e do pronto confirmado pelo cliente. |

**Supersessão B1-fix1 (08/10/2026):** a trava anterior de C3a baseada em `offlineMode` e a premissa de B1 de que o oficial não roda offline estão substituídas por esta seção. O critério é exclusivamente o ambiente explícito acima.

A ferramenta `runtime/adopt-standing-stone.mjs` também é só de desenvolvimento: ela transferiu para o sistema novo a pedra de um personagem de teste que vinha do protótipo. O servidor oficial não tem dados do protótipo e não precisa dela.

## 5. O que cada sistema faz quando ligado

**Revisão da composição (FIX-1010):** trocar o nível de desenvolvimento, os providers ativos ou a assinatura de uma definição pode mudar os grants sem mudar fatos gravados. A composição consulta a cabeça persistida; se o conteúdo mudou, avança `grants` e, quando uma definição mantida muda de assinatura, `catalog`. Conserva os contadores anteriores ao retirar um provider. Mesmos conteúdo e revisão continuam idempotentes; a porta continua recusando uma publicação anterior ou conteúdo diferente enviado diretamente na mesma revisão. As opções continuam sendo lidas no boot, com as mesmas travas de desenvolvimento da seção 4.

### Pedras guardiãs (`standing-stones`)

- **Precisa de:** migrations 0001 a 0004; plugins `Skyrim.esm` e `Mundus.esp` presentes e iguais aos do export usado para gerar o catálogo.
- **Em `active`:** quando o jogador ativa uma pedra guardiã, o servidor impede a ação nativa da pedra, grava a escolha, remove os feitiços da pedra anterior e aplica os da nova. O jogador recebe uma mensagem na tela. Ao reconectar, o estado é reposto a partir do banco.
- **Feitiço que o personagem já tinha por outro motivo nunca é removido.**
- **Se o banco estiver fora do ar:** a ativação é recusada com mensagem ao jogador; a pedra nativa não age.
- **Não suportado:** o bônus de corrida da pedra do Corcel (o record não liga esse bônus à pedra).
- **Validado em jogo** no servidor local em 08/10/2026: escolha, repetição da mesma pedra, trocas, reconexão, mensagens. Não validado em jogo: reinício do servidor (coberto por teste automatizado).

### Raças (`races`)

- **Precisa de:** migrations 0001 a 0005; plugins `Skyrim.esm`, `Aetherius.esp` e `AETHERIUS - BALANCE.esp` presentes e iguais aos do export.
- **Em `active`:** quando o personagem entra, o servidor lê a raça dele, grava a observação, e passa a listar as habilidades e os perks raciais como concessões de origem "raça".
- **O servidor não aplica nem remove nenhum efeito racial.** Quem aplica é o jogo, pelo record da raça. O jogador não percebe diferença.
- **Raça fora das dez jogáveis:** o personagem é marcado como não suportado no registro; nada é feito a ele nem à sessão.
- **Não verificado:** se os efeitos raciais que vêm de perk valem no multiplayer, em especial os que alteram dano (Nord, Elfo da Floresta), já que o servidor calcula o golpe. Tabela completa em `modules/race-system/ownership.json`.

### Classes (`classes`, C3a)

- **Precisa de:** fundação 0001 a 0004, migrations 0006 e 0007 e `catalog/classes.json`. Não exige que raças estejam ligadas. O catálogo confere só os plugins relevantes de definição e winner dos perks (Skyrim, Vokrii e os patches listados no próprio catálogo), sem depender da posição deles na load order.
- **Em `active`:** lê a classe e o nível e compõe os perks dos marcos atingidos com origem `CLASS`. Ao entrar novamente, recompõe dos fatos duráveis. Em `canary`, só compõe para os personagens autorizados. Em `audit`/`shadow`, nenhuma concessão de classe entra na composição ativa.
- A escolha é persistida pelo comando idempotente `classes.set`. Staff, inclusive com servidor parado: `node runtime/set-character-class.mjs "<caminho>\gamemode\core\pg.js" profile:<id> elementalista [schema] [requestId]`. O argumento `requestId` opcional permite repetir a mesma operação. Classe desconhecida é recusada. A ferramenta permite troca livre e não muda nível, XP, skills ou atributos.
- Sem progresso gravado, nível 1. O adaptador `createDurableLeveling(pool, configs).award(...)` calcula XP pelos JSONs e pelas políticas existentes e guarda progresso em `gc_leveling_progress`, usando `gc_commands` para replay por evento e personagem. Nunca cria outro pool ou ledger.
- **Leveling sem fonte de eventos:** C3a não assina `onDeath` nem aceita relatos de abate do cliente. Ainda faltam dono da confirmação de morte no servidor, cobertura dos inimigos/contextos, descoberta de exclusividade do writer de XP e vínculo autoritativo dos membros do grupo ao `CharacterKey`. Depois de definidos, o integrador poderá encaminhar `aetherius.enemy.killed.v1` e o snapshot de grupo ao adaptador. Até lá, nenhuma opção liga XP automático.
- **Entrega de perks (B5b, supersede a pendência C3a):** com o protocolo ativo,
  o único port envia o conjunto completo por revisão e o cliente aplica só a
  diferença. `CONFIRMED` somente após ACK exato e commit da autoria; antes disso
  `SENT_UNCONFIRMED`, com reenvio na próxima reconciliação. Sem suporte de cliente,
  `CLIENT_UNSUPPORTED`; opção desligada/indisponível, `UNSUPPORTED`. Skills e
  atributos não são aplicados. Feitiços continuam pelo host, com entrega ao
  cliente não confirmada. A explicação offline mostra o último ACK durável e
  declara que o estado da sessão atual exige o runtime.
- O Core remove somente perks de autoria confirmada. Preexistentes são
  protegidos permanentemente. Reconexão restaura a autoria confirmada do save;
  adição sem ACK seguida de restart é preservada como externa. RACE e perks
  ligados por PerkToApply dos MGEF da pedra são entregues pelo motor e não vão
  separados no pacote. Origem/rank continuam visíveis na composição.
- O perfil oficial não tem plugin `sweetpie`: os dois writers sweetTaffy já são
  inertes. Outro perfil com esse plugin requer corte explícito antes de ativar
  B5b. O ACK não certifica efeitos em combate, pré-requisitos, ranks esparsos ou
  persistência real após loadGame; resultado nativo e dano mantêm seus donos.
- No oficial com sessão autenticada, `offlineMode=true` permite pedras, raças e classes normalmente. Se `GAMEPLAY_CORE_DEV_CLASS_LEVEL=40` ficar por engano em produção, só classes ficam indisponíveis, com erro explícito; pedras e raças continuam para o jogador autenticado.
- Rank representa posição na cadeia `NextPerk`, não o `NumRanks` de cada record. A concessão automática segue os marcos de classes; condições nativas de aquisição são evidência e não são avaliadas pelo sistema. Não há complemento automático de ranks/pré-requisitos. Os seis rótulos não resolvidos permanecem no catálogo como `UNSUPPORTED`.
- Fora de C3a: interface, custo/restrições de troca (incluindo Winterhold), skills, pontos/alocação de atributos, feitiços de classe e entrega B5b. O módulo legado permanece intocado e não é ligado pelo runtime novo.

### Veneno em arma (D-P1)

**Proteções FIX-1010:** o agressor deve ser um ator criado como jogador pelo host e ter usuário associado. NPC, ator sem usuário/mundo, fonte de golpe que não resolve e efeito sem MGEF válido não entram na aplicação de veneno. Alvo NPC hospedado continua possível quando o agressor é jogador; ausência de destinatário conectado é `UNSUPPORTED`, sem gasto de carga. Os timers mantêm referências fracas à origem e ao alvo e cessam na próxima execução se a origem se desconectar ou for destruída. Atualização de equipamento de NPC conserva o encaminhamento original; destinatários são deduplicados depois de resolver o hoster, sem eco ao dono por meio de listener NPC.

**Queda de 10/10:** a violação de acesso não foi reproduzida na matriz nativa PartOne, sem socket, antes da proteção. Esta entrega não certifica a causa nem a resolução da queda. Manter `weaponPoison=false` e shadow desligado até revisão do Opus e nova sessão do dono. O registro e a auditoria estão em `_work/evidence/FIX-1010/`.

**Primeira alteração de comportamento de jogo do Core no C++ do host.** A ordem foi autorizada fora da sequência da trilha D. O outro desenvolvedor precisa reaplicar os arquivos novos `server_guest_lib/aetherius_combat/WeaponPoison*.h`, as integrações marcadas `AETHERIUS D-P1`, os bindings `PoisonDoseBinding.*` e os testes nativos, e recompilar o addon. A lista exata de linhas está no relatório da ordem. O spike de dano anterior continua independente e desligado.

- Ao usar ALCH vencedor marcado como veneno, ele não passa por `EatItem`: consome uma unidade e reveste exatamente uma arma do inventário interno do host, preservando a mão equipada. Stack de armas é dividido em uma unidade revestida e o restante. Sem arma, duas armas candidatas ou arma já envenenada: recusa sem consumir.
- Correspondência de instância (D-P1-fix1): record de definição mais os extras presentes no inventário autoritativo (`health`, `enchantmentId`, `maxCharge`, `removeEnchantmentOnUnequip`, nome salvo pelo host e `soul`). Extras ausentes no host e informados só pelo cliente não identificam instância e não são copiados ao inventário. `chargePercent` é estado mutável, não identidade; contagem, veneno e mão também não são identidade. A mão já conhecida pelo host desempata cópias após separar a pilha; o veneno relatado pelo cliente nunca desempata. Duas candidatas reais continuam sendo recusa. A cópia não empunhada do inventário inteiro do cliente não desfaz a marca da mão empunhada.
- Convergência (D-P1-fix1): revestimento aceito e cada carga gasta/esgotada publicam uma vez inventário e equipamento ao dono. Uma recusa ou primeira divergência de veneno recebe uma única correção limpa. Respostas do cliente, mesmo repetidas ou com `numChanges` crescente, não geram nova publicação ao dono enquanto o veneno autoritativo não mudar. Trocas reais de equipamento seguem aos observadores, sem eco ao dono. A primeira correção usa um orçamento transitório por ator; mensagens limpas não o rearmam. Uma arma recusada pode conservar apenas no cliente o ícone do veneno; o host não aplica esse veneno. Corrigir inteiramente esse ícone exigiria comportamento adicional do cliente, fora desta ordem.
- Cada revestimento e recusa de uso gera log informativo com ator, arma/veneno por plugin de definição e FormID local, e motivo. Golpe/tick não fazem log síncrono: o resultado e a máscara de famílias ficam na propriedade de diagnóstico existente `aetheriusPoisonStatus`. A opção desligada preserva o fluxo do mantenedor; neste host `SendToNeighbours` inclui o próprio jogador, encaminhando o pacote original, sem publicação adicional da D-P1.
- Após golpe aceito, a arma é identificada pelo record do golpe e pela instância equipada. O pacote não identifica mão: duas cópias do mesmo record equipadas resultam em recusa. Golpe bloqueado, bash, fonte diferente, alvo morto pelo dano físico, arco/besta: sem aplicação nem gasto. São decisões conservadoras pendentes de confirmação em jogo, assim como mão preferida e substituição.
- Suportado: `ValueMod` detrimental de Health/Magicka/Stamina, magnitude positiva finita, sem área ou CTDA. Instantâneo reduz o percentual pelo máximo nativo e usa o writer `SetPercentages`, com publicação em fila; duração usa magnitude por segundo no store/timer existente do host. Não usa `ApplyMagicEffects`, que restauraria recursos. Duração superior a 86400 segundos é recusada. Um efeito ativo no mesmo recurso impede sobreposição (`UNSUPPORTED`), sem substituir o anterior. O primeiro segundo é aplicado no golpe; os restantes são ticks de um segundo.
- Famílias `UNSUPPORTED`, máscara: duração fora do limite `1`, archetype não coberto `2`, actor value não coberto `4`, magnitude inválida `8`, área `16`, condição ou parcela de script `32`, sobreposição `64`, contexto de recurso ausente `128`, dano letal sem dono certificado de abate `256`. VMAD é declarado como parcela de script não suportada; ele não suprime o dano direto declarado no record. CTDA não certificada recusa o efeito condicionado inteiro. Aplica as famílias cobertas de um ALCH misto e gasta uma carga; se nenhuma for aplicável, preserva a carga. Paralysis, Slow, fraquezas, debuffs e scripts não têm resultado certificado nesta ordem. Dano de veneno que zeraria Health é recusado, sem chamar o fluxo de morte/gamemode. Resistências/imunidades, atribuição de abate por veneno e visual do efeito não foram certificados.
- Ownership dos resultados cobertos: `NATIVE_SERVER`, pelo writer de recursos e inventário do host. O Core decide apenas o bônus derivado dos grants. Parcelas não cobertas ficam `UNSUPPORTED` no host.
- O dano físico é calculado pela mesma fórmula anterior. Nenhum entry point de dano foi ligado. Fangs (`ModAttackDamage`) e Alkahest (`ModTargetDamageResistance`) aguardam a ordem da fórmula e sua cobertura.
- `Concentrated Poison`: rank máximo possuído, bônus 2/4/6, mais uma carga base. Viper nível 40: **7 cargas**. Os três ranks coexistem nas concessões, mas as condições de entry point suprimem os inferiores. Condições de aquisição não impedem os marcos. O catálogo incorpora o export profundo oficial; as identidades continuam por plugin de definição e FormID local.
- O Core reentrega o bônus na composição e no sinal de ator pronto (B5b:
  ready do cliente com protocolo; aproximação de 3 segundos no cliente antigo),
  limpa no desligamento/desvínculo e recusa epoch antigo. Classe sem esse perk
  recebe zero. O revestimento já aplicado conserva as cargas obtidas ao usar a
  dose; trocar a classe altera a próxima dose.
- Os ticks são transitórios: não são serializados nem reaplicados como cura ao carregar save. Reiniciar o host perde a porção temporal restante; desligar a opção cancela a continuação no próximo tick. A arma/cargas seguem o formato nativo existente. Persistência de efeito temporal e stacking completo permanecem sem certificação.
- O cliente compara `poisonId` e `poisonCount` em `extrasEqual`. Se a contagem local divergir, `applyInventory` remove e adiciona a instância, embora transmita o estado equipado por `pushWornState`. Essa correção pontual ainda pode produzir um som de reequipar; a D-P1-fix1 elimina as republicações que sustentavam o laço. Continuidade visual de equipamento exige nova sessão em jogo; não foi alterado o cliente.
- Caso da sessão de 09/10: `0014C4:Grimoire.esp`, Blessed Northern Iron Dagger, duas cópias e uma empunhada com nome e carga locais. O teste nativo copia os dados de `_work/evidence/H/changeform-0-apos-sessao-veneno-2026-10-09.json`, normaliza para StableFormKey e verifica uma dose consumida, uma unidade revestida e a mão preservada. O veneno `0FFA02:Skyrim.esm`, Potent Corrosion Poison, é vencido por `Potion Remodels Apothecary Patch.esp`: efeito `073F27:Skyrim.esm` vencido por `Apothecary.esp`, redução de armadura (archetype 34, AV 39), magnitude 200 por 60 segundos e CTDA. **Revestimento aceito; resultado no golpe `UNSUPPORTED`**, sem efeito nem gasto de carga. Não foi acrescentada uma família de veneno.

**Histórico supersedido:** a D-P1 foi reprovada na sessão em jogo de 09/10 por correspondência de instância e laço de equipamento (`_work/evidence/H/sessao-veneno-D-P1-2026-10-09.md`). O parecer anterior não cobre esses defeitos. A D-P1-fix1 corrige ambos no host, com testes nativos e harness preparado; ainda aguarda revisão e nova sessão. `weaponPoison=false` foi mantido após build e sync; servidor local permaneceu parado.

**Histórico anterior preservado:** a primeira sessão parou porque o export raso não continha as condições. O revisor forneceu `PERK-concentrated-poison-depth12.jsonl` e `REGRA-CONCENTRATED-POISON.md` pela instância oficial `C:\Modding\MO2`; o dono esclareceu que regras não verificáveis seriam tratadas conservadoramente e famílias parciais não impediriam a entrega. O antigo diagnóstico permanece em `_work/evidence/D-P1/`, mas seu bloqueio está resolvido.

Harness real, exclusivo do revisor (não executado por Sol):

```powershell
node "<workspace>\_work\evidence\D-P1\resume\native-harness-fix1.cjs" --port <porta-isolada> --work-dir <pasta-isolada> --addon "<build>\dist\server\scam_native.node" --settings "<build>\dist\server\server-settings.json"
```

Antes do harness, compilar seu observador de transporte com `python _work\evidence\D-P1-fix1\build-counter.py` no mesmo build Release do host. O observador vive somente em evidência, copia o wrapper existente, conta as mensagens destinadas ao bot e as encaminha sem alteração ao transporte real. Pode informar `--counter-addon <poison-counter.node>` e `--fixture <session-fixture.json>`; os padrões estão na pasta D-P1-fix1. Rodar novamente em outra pasta e porta com `--mode off` para conferir o fluxo original do mantenedor. **Não instalar esse observador no servidor de jogo.**

Instancia o addon real com seu bot interno, arma e veneno resolvidos por StableFormKey. Não usa banco, `destroyActor` ou Papyrus Activate. A porta é obrigatória e 7777 é recusada. Teste em execução e validação em jogo cabem ao revisor/dono; esta entrega não ligou o servidor.

## 6. Ordem recomendada para ligar um sistema no servidor oficial

1. Backup do banco.
2. Servidor parado, ou o sistema em `off`.
3. `migrations:status`, `migrations:apply`, `migrations:status` (seção 3).
4. Ligar o sistema em `audit`. Subir o servidor e ler o log por um período: o sistema registra o que faria, sem agir.
5. Passar para `canary` com um ou dois `profile_id` da equipe. Testar em jogo.
6. Passar para `active`.

No ambiente local os passos 4 e 5 foram pulados: o sistema foi direto para `active`, porque só há um personagem de teste.

### Conferência obrigatória antes de ligar qualquer sistema no servidor oficial

No `.env` do gamemode do servidor oficial, estas opções têm de estar **ausentes**:

- `GAMEPLAY_CORE_DEV_CLASS_LEVEL` (override exclusivo do teste; em produção bloqueia classes);
- `GAMEPLAY_CORE_ALLOW_DEV_OPTIONS`;
- `GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY`;
- `GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV`;
- `ENABLE_STANDING_STONE_SPIKE`.

Exija `NODE_ENV=production` no ambiente efetivo do processo. O servidor oficial usa `offlineMode=true` e sessão oficial autenticada por token; não mude esse modo para contornar a identidade. No log não deve haver override `DEV` aceito nem `ERROR` de opção de desenvolvimento recusada. Uma opção recusada precisa ser removida antes de ligar o sistema afetado.

## 7. Como conferir

- **FIX-1010/B5b:** `ACK_RECEIVED` informa contagens `applied`, `alreadyPresent`, `unresolved`, `failed`, `removed` e `alreadyAbsent`. Essa linha registra recebimento; só o `CONFIRMED` posterior comprova o registro transacional da entrega. Após 10 segundos sem ACK válido da publicação atual, `ACK_TIMEOUT` mantém `delivery=SENT_UNCONFIRMED`. Reset de sessão, nova publicação e shutdown cancelam o timer anterior. Nenhuma dessas linhas comprova resultado de gameplay no motor.
- **Harness FIX-1010, apenas revisor:** `node runtime/harness/weapon-poison.cjs --port <porta-isolada> --work-dir <pasta-isolada> --addon <scam_native.node> --settings <server-settings.json> --mode on` (repetir com `--mode off`). Inclui NPC real `0422B4:Skyrim.esm` colocado por `mp.place`, hospedado pelo bot via mensagem `Host`, golpeando o ator do bot. O harness `runtime/harness/client-packet.mjs` usa os mesmos argumentos sem `--mode` e inicializa `globalThis.require`. Não executados pelo Sol: exigem servidor local/porta.

- **B5b:** log `perks profile:<id>: CONFIRMED; 19 items` para viper no nível 40
  autorizado de teste. `SENT_UNCONFIRMED` jamais significa aplicado. Conferir
  `gc_perk_projections` por personagem (`owned`, `active`, `item_status` e
  `revision`), sem guardar valores de runtime. A ferramenta offline lê o último
  ACK; para sessão atual, usar `refreshClass(binding).delivery` e capabilities.
  Roteiro em jogo e limitações no relatório B5b.

- **No boot**, o log deve ter `[gameplay-core] bundle <versão>; initialized; active instances=1`. Sistemas que não podem subir aparecem com o motivo, por exemplo `[gameplay-core] classes: UNSUPPORTED; Catalog domain classes not delivered` (esperado para os sistemas ainda não entregues). Migration faltando aparece com o comando a rodar.
- **Raças:** a cada personagem observado, `[races] active: profile:<id> SUPPORTED <raça>`.
- **No banco:** `SELECT version, applied_at FROM gc_schema_migrations ORDER BY version;` e, por personagem, `gc_standing_stone_choice`, `gc_race_observation`, `gc_commands`.
- **Por personagem, com o servidor ligado ou parado:**

  ```powershell
  node runtime/explain-character.mjs "<caminho absoluto>\gamemode\core\pg.js" profile:<profile_id>
  ```

  Só lê. Mostra pedra, raça, classe, nível, origem do nível, marcos e concessões. Sem as migrations C3a, declara classes não suportadas e preserva pedras e raças. Com `GAMEPLAY_CORE_DEV_CLASS_LEVEL`, exige a mesma trava de ambiente da seção 4 e registra `DEV`. B1-fix1 substitui a prova anterior por `server-settings.json`: esse argumento não autoriza opções de desenvolvimento.

## 8. Como desligar ou voltar atrás

- **B5b:** definir `GAMEPLAY_CORE_CLIENT_PERKS_MODE=off`, recarregar o Core e
  restaurar o bundle anterior conforme o guia. Perks já no save não são apagados
  por desligar. Revogar classes com o protocolo ativo antes de desativá-lo se
  for necessária remoção por origem; não apagar a autoria no banco. Remoções
  dependem de confirmação e permanecem pendentes quando o cliente falha.

- **Desligar um sistema:** pôr o modo dele em `off` e reiniciar o servidor (ou recarregar o gamemode). A pedra guardiã volta ao comportamento nativo do jogo; as raças deixam de ser observadas.
- **As tabelas ficam.** Desligar não apaga nada: a escolha de pedra e o registro do que o Core aplicou continuam no banco, e o sistema retoma de onde parou ao ser religado. Não há migration de remoção, de propósito.
- **Feitiços já aplicados** pelo sistema de pedras continuam no personagem depois de desligar; quem os remove é o próprio sistema, numa troca de pedra.
- **Desligar o Core inteiro:** `ENABLE_GAMEPLAY_CORE=false`.
- **Se o Core ou o banco falhar com o sistema ligado,** o servidor do jogo continua no ar; o sistema afetado fica indisponível e diz por quê no log.

## 9. O que foi feito no ambiente local, como referência

| Data | Sistema | No banco de desenvolvimento | Na configuração do servidor local |
|---|---|---|---|
| 08/10/2026 | pedras guardiãs | migrations 0001 a 0004; adoção da pedra do personagem de teste, vinda do protótipo | `ENABLE_STANDING_STONE_SPIKE=false`, `GAMEPLAY_CORE_MODE_STANDING_STONES=active`, `GAMEPLAY_CORE_DATABASE_SCHEMA=public`, `GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV=false`, `GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY=true` |
| 08/10/2026 | raças | migration 0005 | `GAMEPLAY_CORE_MODE_RACES=active` |
| 09/10/2026 | veneno D-P1 | nenhuma alteração em aetherius_dev; testes somente em aetherius_test | compilação Release e sync dos plugins oficiais; opção não ligada; servidor não iniciado; ticks cobertos por teste unitário; stacking e jogo pendentes de revisão |
| 10/10/2026 | FIX-1010 | nenhuma migration nova; testes do Core somente em schemas descartáveis de aetherius_test | proteção de veneno e revisão derivada; rebuild Release e bundle; servidor mantido parado; weaponPoison desligado; queda não reproduzida; servidor e jogo pendentes do revisor/dono |
| 08/10/2026 | classes (C3a) | migrations 0006 e 0007; classe do personagem de teste definida como `viper` pela ferramenta `runtime/set-character-class.mjs` | `GAMEPLAY_CORE_MODE_CLASSES=active` e, **só neste ambiente de teste**, `GAMEPLAY_CORE_DEV_CLASS_LEVEL=40` |
| 09/10/2026 | perks no cliente B5b | nenhuma alteração em aetherius_dev; migration 0008 somente em schemas descartáveis de aetherius_test | nenhuma opção local alterada; bundle do cliente em evidência, sem instalação; addon e jogo não executados pelo Sol |

As linhas acima registram a configuração histórica anterior à B1-fix1; não comprovam ativação com a trava nova. **Para o revisor manter o teste local:** definir `NODE_ENV=local` e `GAMEPLAY_CORE_ALLOW_DEV_OPTIONS=true`; deixar `GAME_ACCESS_CONTROL` ausente (ou `false`). `GAMEPLAY_CORE_DEV_CLASS_LEVEL=40` pode permanecer somente nesse teste. Com login oficial, remover `GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY`: o host novo exige sessão oficial mesmo quando ela está presente. Para harness com host antigo sem identidade oficial, conservar essa opção com a trava local.

Remover `ENABLE_STANDING_STONE_SPIKE=false` e `GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV=false` do `.env` quando não forem usadas: fora de desenvolvimento até `false` é presença recusada. As migrations existentes continuam aplicadas manualmente. Nenhuma configuração ou tabela do ambiente local foi alterada na entrega B1-fix1; aplicação e boot cabem ao revisor.

O que difere no servidor oficial: `NODE_ENV=production`, sem confirmação/opções de desenvolvimento e sem adoção; nível vem do Leveling. Manter `offlineMode=true`, login por token e passagem por `audit`/`canary` antes de `active`.

Cada sistema novo acrescenta uma linha a esta tabela e uma subseção à seção 5.
