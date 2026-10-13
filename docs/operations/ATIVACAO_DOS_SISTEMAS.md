# Ativação dos sistemas do GameplayCore num servidor

Para quem vai ligar os sistemas do Core no servidor oficial. Atualizado em 12/10/2026 (C3d-fix1).

Cada sistema do Core (pedras guardiãs, raças, e os que vierem) precisa de duas coisas no servidor onde roda: **tabelas próprias no PostgreSQL** e **uma opção de configuração que o liga**. No ambiente de desenvolvimento local esses dois passos foram feitos à mão a cada sistema. Este documento descreve o que foi feito, para ser repetido no servidor oficial com as diferenças necessárias.

Este documento não cobre a instalação do pacote (compilar o Core, compilar o servidor, registrar o Core no gamemode). Isso é assunto do guia de instalação, ainda a escrever (`integrations/host/INSTALL.md`). Aqui presume-se o Core já instalado e carregando.

**Nota de supersessão (DOC-1, 12/10/2026):** o guia de instalação existe e fica em `integrations/INSTALL.md` (não em `integrations/host/`); o pacote do host fica em `integrations/host/` e o do cliente em `integrations/client/`.

## 1. O que o Core faz e não faz no banco

- Usa o PostgreSQL que o gamemode já usa, pelo mesmo pool (`server/gamemode/core/pg.js`). A conexão vem de `GAME_DATABASE_URL` ou, se ausente, de `DATABASE_URL`. O Core não cria conexão própria.
- Cria e usa **somente** tabelas com prefixo `gc_`. Não lê, não altera e não apaga nenhuma tabela existente (`users`, `sessions`, tabelas do painel, do gamemode ou dos serviços legados). O executor de migrations recusa qualquer arquivo que toque tabela sem o prefixo.
- As migrations são só aditivas: criam tabela e índice. Nenhuma altera ou remove coisa existente.

## 2. Tabelas, por migration

**C3d-fix1:** migration `0009_gc_attribute_allocation.sql`, com distribuição por CharacterKey e revisão, sem saldo armazenado. Usa PRIMARY KEY e NOT NULL, sem CHECK conforme a política fixa. Não negativos/múltiplos de 5 são garantidos pelo único comando writer; leitura inválida declara `ATTRIBUTE_ALLOCATION_INVALID`, conserva a linha e suprime bônus. A 0008 da B5b permanece intacta. A 0009 foi aplicada pelo runner somente em schemas descartáveis de aetherius_test. O bloqueio do relatório parcial C3d está supersedido por esta retomada.

**Regra atual C3d:** 15 pontos por nível após o primeiro, blocos de 5 e ganho 1:1 de máximo; troca efetiva zera XP, nível e distribuição preservando fadiga/ciclo/limite diário. Trechos históricos C3a/C3c abaixo sobre preservar XP estão supersedidos pelo [contrato de atributos](../classes/ATRIBUTOS_C3d.md). Compilação/aceite nativo pendentes do revisor; validação com tela será no oficial.

**Nota de supersessão (DOC-1, 12/10/2026):** a compilação Release do host e os testes nativos, dados acima como pendentes do revisor, foram feitos em 12/10/2026 (parecer `_work/reviews/C3d-review-1.md`; `_work/evidence/C3d-fix1/native-build-opus.txt` e `native-unit-opus.txt`). A validação com tela continua sendo no oficial.


**C3c:** nenhuma migration, tabela, pool ou ledger novo. A varredura usa as tabelas anteriores e um nível transitório por personagem em memória; não cria nem altera `gc_leveling_progress`. O ponto `awardLevelingXp` usa o adaptador durável Leveling e seu `eventId` no ledger `gc_commands`; só o adaptador escreve XP, nível e fadiga.

**B5b-fix1:** nenhuma migration/tabela nova; formato do ACK e autoria durável permanecem iguais. Testes usam só `aetherius_test`.

**C3b-varredura:** nenhuma migration nova. A varredura temporária usa `classes.set` e as tabelas `gc_character_class`, `gc_commands` e de projeção já existentes. Só os testes acessam `aetherius_test`; esta entrega não acessa `aetherius_dev`.

D-P1-fix3 não cria migration, tabela, pool ou ledger. Só corrige a projeção
de veneno no cliente; testes usam exclusivamente aetherius_test.

**DEV-A1 não cria migration ou tabela.** Os máximos de teste ficam em memória no ator do host e nunca são escritos em `gc_*` ou no change form. Porcentagens continuam sob o writer normal do host.

Arquivos em `database/migrations/`, mais a migration B5b em
`runtime/src/projection/migration.ts`, incluída pelo mesmo CLI e bundle, aplicados em ordem.

| Migration | Tabelas | Para quê | Quem precisa |
|---|---|---|---|
| `0001_gc_schema_migrations.sql` | `gc_schema_migrations` | controle: quais migrations foram aplicadas e a assinatura de cada arquivo | todos |
| `0002_gc_commands.sql` | `gc_commands` | registro de comandos, para que uma ação repetida não tenha efeito em dobro | todos |
| `0003_gc_spell_projection.sql` | `gc_spell_projection_heads`, `gc_spell_projections` | o que o Core já aplicou de feitiços em cada personagem, para enviar só a diferença e nunca remover o que não concedeu | pedras guardiãs e qualquer sistema que conceda feitiço |
| `0004_gc_standing_stone_choice.sql` | `gc_standing_stone_choice` | a pedra guardiã escolhida por personagem | pedras guardiãs |
| `0005_gc_race_observation.sql` | `gc_race_observation` | a raça que o servidor observou em cada personagem | raças |
| `0006_gc_character_class.sql` | `gc_character_class` | classe escolhida e revisão por personagem; C3d chama o dono Leveling para reset na troca | classes |
| `0007_gc_leveling_progress.sql` | `gc_leveling_progress` | XP total, nível e estado de fadiga do único writer Leveling | adaptador Leveling e leitura de nível pelas classes |
| `0008_gc_perk_projection.sql` (runtime) | `gc_perk_projections` | aplicação confirmada de perks, autoria e revisão por personagem; proteção permanente de perks preexistentes | entrega B5b |
| `0009_gc_attribute_allocation.sql` | `gc_attribute_allocation` | pontos gastos por atributo e revisão; saldo derivado do nível | classes e atributos |

D-P1 não cria migration: revestimento e cargas usam o inventário nativo existente; o bônus por ator e os ticks do veneno são transitórios. Não há ledger ou store de efeitos novo.

D-P1-fix2 também não cria migration nem pool/ledger: a intenção é transitória, autenticada pelo canal da B5b; request id é deduplicado por sessão/ciclo em memória. O host continua sendo o único writer do revestimento e do consumo no inventário nativo. Nenhum acesso a `aetherius_dev`.

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

**C3d-fix1:** nenhuma opção nova. Classes em active/canary exigem também a 0009. Propriedade nativa normal `aetheriusAttributeBonuses`: records + bônus, entrega após commit/vínculo/pronto, limpeza no desvínculo/shutdown. O host oficial precisa ser recompilado com ela; ausente, `UNSUPPORTED` explícito sem propriedade customizada. DEV-A1 aceito permanece absoluto sem somar bônus. O boot da varredura avisa que a troca zera progressão, e ela recusa XP/distribuição gravados com `SWEEP_WOULD_RESET_PROGRESS`, sem mutação. Não levar opções DEV ao oficial.


**C3c:** não há opção nova. Com a varredura aceita, `GAMEPLAY_CORE_DEV_CLASS_LEVEL` fornece o nível original que será restaurado; cada passo usa em memória o nível de `stages[].level` do catálogo. Fora da varredura, continua valendo o nível DEV configurado ou o Leveling. `GAMEPLAY_CORE_DEV_ATTRIBUTES` foi retirada do ambiente local pelo dono em 12/10; o código permanece inerte sem a opção.

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

**B5b-fix1:** nenhuma opção nova. Instalar o patch só-B5b corrigido; o cumulativo de veneno do Core `85b7066` fica suspenso em `integrations/client/suspenso/B5b-mais-veneno-fix3-aa864cb.patch`. As instruções históricas de instalação de D-P1-fix2/fix3 abaixo estão supersedidas por esta nota e pelo LEIA-ME atual. Veneno permanece suspenso; esta ordem não altera a configuração do servidor.

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

### Gatilho e diagnóstico do veneno (D-P1-fix2; correção D-P1-fix3)

A fix3 não cria opção no host/Core. Requer Papyrus Extender no cliente: a Platform
chama seus globais por callNative. Falta de função/retorno inválido é UNSUPPORTED,
sem reconstrução da arma. Com o trace existente, procurar correct-in-place
(before/after/functions); replace-base foi removido. Detalhes de instalação e
reversão em integrations/client/LEIA-ME.md. Nenhuma configuração local foi alterada.

Recompilar também o Core e instalar o patch cumulativo do cliente (ver
`integrations/client/LEIA-ME.md`). `weaponPoison=true` habilita o canal mesmo se
`GAMEPLAY_CORE_CLIENT_PERKS_MODE=off`; os perks só são enviados se seu próprio modo,
banco e migration estiverem disponíveis. O protocolo requer a sessão oficial
vigente, begin/challenge/ready. Sem contexto oficial ou binding nativo, o resultado
é `UNSUPPORTED`. O bônus continua vindo da composição; não nasce no cliente.
Nenhuma nova opção do gamemode, migration ou alteração de economia.

Diagnóstico opcional no arquivo existente de settings do plugin cliente
`skymp5-client-settings.txt` (JSON): acrescentar `"aetheriusWeaponPoisonTrace": true`
no objeto desse plugin. A opção é ausente/desligada por padrão. Ela habilita linhas
`[AETHERIUS poison]` no console/registro da Skyrim Platform para equip, unequip,
mudanças dos extras, intenção, resposta e reconstrução. Reverter removendo a chave
ou usando false e reiniciando o cliente. Não contém credenciais. O executor não
alterou settings no jogo/MO2 nem instalou o cliente.

### Só desenvolvimento: **não usar no servidor oficial**

Todas as opções abaixo usam a mesma trava: `NODE_ENV=local` explicitamente, `GAME_ACCESS_CONTROL` diferente de `true` e `GAMEPLAY_CORE_ALLOW_DEV_OPTIONS=true`. Ausência de `NODE_ENV` nunca conta como local, mesmo que `server-options.js` escolha o arquivo local por padrão. `production` e `staging` recusam as opções. O ambiente vem de `env: process.env` no descriptor do gamemode, depois de carregar seu `.env`; `GAME_ACCESS_CONTROL` é a mesma variável lida pelo AccessControl do host.

Fora dessa combinação, **a presença da opção, inclusive vazia ou `false`, é recusada com `ERROR`, nome e motivo no log**. Remova a opção para retomar o comportamento normal. A confirmação `GAMEPLAY_CORE_ALLOW_DEV_OPTIONS` não liga nenhum sistema por si só e também deve estar ausente no oficial.

| Opção | Por que não |
|---|---|
| `GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV=true` | aplica migrations no boot somente com a trava local acima. Se recusada, não adquire o pool nem aplica migrations e deixa indisponíveis os sistemas dependentes do banco. No oficial as migrations são aplicadas à mão, com backup |
| `GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY=true` | aceita perfil sem autenticação somente em host antigo, sem `aetheriusOfficialIdentity`, com a trava local acima. Recusa bloqueia vínculos nesse host antigo, sem retornar silenciosamente à identidade normal. No host atual sempre exige sessão oficial; esta opção não contorna o login |
| `ENABLE_STANDING_STONE_SPIKE=true` | liga o protótipo antigo (`spike_*`) somente com a trava local acima. Recusada, não inicia o spike; os sistemas atuais independentes seguem. Nunca junto com pedras em `canary`/`active`: o sistema novo recusa iniciar. No oficial deixe ausente |
| `GAMEPLAY_CORE_DEV_CLASS_SWEEP=true` | **Nunca no servidor oficial.** Exige a trava única, um `GAMEPLAY_CORE_DEV_CLASS_LEVEL` aceito e `GAMEPLAY_CORE_CLIENT_PERKS_MODE=active`. Ausente ou `false` em desenvolvimento: sem varredura. Valor inválido ou pré-requisito ausente: `ERROR`, sem varredura; os demais sistemas seguem. Aceita: aviso **DEV** em cada boot. Classes e entrega devem estar disponíveis; caso contrário registra erro e não começa. |
| `GAMEPLAY_CORE_DEV_CLASS_LEVEL=<1..40>` | **Nunca no servidor oficial.** Com a trava local acima, `40` compõe todos os marcos sem gravar nível ou XP. Recusada, vazia, inválida ou fora de 1–40: **ERROR**, classes `UNSUPPORTED`, sem iniciar nem usar nível real em silêncio. Removida a opção, volta ao Leveling. Quando aceita, registra **DEV** e mostra essa origem na capacidade e explicação. Com B5b, a entrega depende também do modo de perks habilitado e do pronto confirmado pelo cliente. |
| `GAMEPLAY_CORE_DEV_ATTRIBUTES=<vida>,<magia>,<vigor>` | **Nunca no servidor oficial.** Três inteiros entre 1 e 100000, sem espaços; exemplo local: `300,300,300`. Exige a mesma trava de `development.ts`. Opção presente fora dela (inclusive vazia ou `false`) ou valor inválido: **ERROR**, sem override; os demais sistemas seguem. Aceita: aviso **DEV** a cada boot. Entregue só a jogador com sessão oficial atual, no vínculo e no pronto; reentregue depois do respawn/reconnect, limpo no desvínculo/shutdown. Sem propriedade nativa: `UNSUPPORTED`, sem gravar propriedade customizada. |

**Supersessão B1-fix1 (08/10/2026):** a trava anterior de C3a baseada em `offlineMode` e a premissa de B1 de que o oficial não roda offline estão substituídas por esta seção. O critério é exclusivamente o ambiente explícito acima.

A ferramenta `runtime/adopt-standing-stone.mjs` também é só de desenvolvimento: ela transferiu para o sistema novo a pedra de um personagem de teste que vinha do protótipo. O servidor oficial não tem dados do protótipo e não precisa dela.

## 5. O que cada sistema faz quando ligado

### Atributos distribuídos (C3d-fix1)

15 × (nível − 1) pontos, um por unidade de máximo, acréscimos em blocos de 5. API e recusas no [contrato para a tela](../classes/ATRIBUTOS_C3d.md). Troca efetiva de classe zera XP/nível/distribuição; mesma classe não zera; fadiga/ciclo/limite diário preservados. Leitura acima do ganho declara ATTRIBUTE_ALLOCATION_EXCEEDS_LEVEL; linha inválida declara ATTRIBUTE_ALLOCATION_INVALID. Ambos suprimem bônus, sem apagar/corrigir fatos.

Staff: `node runtime/allocate-attributes.mjs <pg.js> <profile:id> <vida delta> <magia delta> <vigor delta> [schema] [requestId]`. Usa o ambiente do gamemode, pool existente e comando de domínio. Só persiste (NOT_SENT); reconectar/pronto entrega ao host. Explicação: `node runtime/explain-character.mjs <pg.js> <profile:id> [schema]`, com pontos e origem do nível; máximos atuais exigem API online.

Harness exclusivo do revisor, não executado nesta entrega: `node runtime/harness/attribute-allocation.mjs --port <porta-isolada> --work-dir <pasta-vazia> --addon <scam_native.node> --data-dir <pasta-plugins>`, com AETHERIUS_TEST_DATABASE_URL. Recusa 7777 e banco diferente de aetherius_test. Usa addon/bot reais, autoridade de identidade TS real com autenticação de fixture e Leveling durável; confere alocação, máximo nativo, reconexão e reset. Não certifica login de produção nem barras do Skyrim. A validação com tela será no oficial pelo desenvolvedor; não usar o ambiente local para homologar esta entrega.

**Nota de supersessão (DOC-1, 12/10/2026):** o harness acima foi executado pelo revisor em 12/10/2026 com o servidor compilado, com resultado PASS (`_work/evidence/C3d-fix3/opus-harness-attributes.txt`). Continua valendo que ele não certifica login de produção nem as barras do jogo.


### Confirmação de remoção de perks (B5b-fix1)

A sessão real de 12/10 às 17:10 mostrou concessões certas nas 18 classes, mas remoções relatadas como `FAILED` antes de ficarem observáveis. A bridge da Platform aguarda a chamada nativa; o atraso interno do motor é inferência do log, não uma fila específica demonstrada no fonte. O cliente corrigido confere a ausência em updates posteriores, até três verificações ou 500 ms para a entrega inteira. Perk que continua presente é `FAILED`; perk já ausente é `ALREADY_ABSENT`. A entrega seguinte só começa a aplicar depois do ACK anterior. Ensure e formato/ordem do ACK permanecem iguais; reset de sessão/ciclo cancela callbacks antigos. Sem updates, não há confirmação fabricada; timeout do servidor continua em 10 segundos.

Cliente instalável contém somente B5b + B5b-fix1. `sync/inventory.ts` voltou à base aa864cb e `gameplayWeaponPoison.ts` saiu. O código de veneno permanece no patch suspenso citado na seção 4, que também alimenta seus testes sem recolocá-lo no cliente. Evidência e referências: `_work/evidence/B5b-fix1/PARTE-2.md`.

Depois da instalação pelo revisor, o dono deve ver 18 linhas `result=OK`, todas com `failed=0` e `unresolved=0`; `removed` confirma os perks exclusivos removidos, sem removê-los de novo como `alreadyAbsent` no passo seguinte. A linha final deve ser `done: ok=18 fail=0; restored=<original>; delivery=CONFIRMED`. Isso confirma entrega, não efeitos de combate. Harness continua com os mesmos argumentos e é exclusivo do revisor; servidor local e jogo não foram executados nesta ordem.

### Varredura por marcos (C3c, exclusivamente desenvolvimento)

Depois do primeiro ACK `CONFIRMED`, percorre classes em ordem de id e os marcos em ordem de nível, ambos lidos do catálogo assinado. O catálogo atual tem 18 classes e 162 marcos no total. Uma chamada `classes.set` por classe; entre marcos da mesma classe só muda a leitura transitória de nível e a composição avança `revision.grants`. **Com C3d, as trocas chamam o reset Leveling; só começa sem progresso/distribuição.** O override some antes da restauração, inclusive em timeout, saída, morte, respawn, carga e shutdown aguardado. Staff continua recebendo `DEV_SWEEP_IN_PROGRESS`. Uma tentativa por personagem por boot, inclusive após reload do Core.

Cada passo exige ACK `applied`, zero `unresolved` e `failed`, e presença confirmada exatamente igual aos perks de origem CLASS acumulados até esse marco. O esperado vem de `stages`, independentemente de `classGrants`. Perk futuro de CLASS dá `FAIL(UNEXPECTED_CLASS_PERK)`; ausente dá FAIL; erros por item continuam até o último passo. As confirmações cobrem os itens do protocolo, não uma enumeração de perks externos do save nem os efeitos. Perks compartilhados preservam a presença; o cliente responde `APPLIED` quando já são de autoria do Core.

Exemplo: `[classes] DEV sweep 1/162 anti_mago@1: expected=4; new=4; applied=4; alreadyPresent=0; unresolved=0; failed=0; removed=...; alreadyAbsent=0; result=OK`. No fim: `[classes] DEV sweep done: ok=162 fail=0; classes=18; milestones=162; restored=<original>; delivery=CONFIRMED`. Os números são calculados do catálogo, não constantes de execução. A reposição tem linha `restore <classe>@<nível original>`. `new` conta os perks definidos naquele marco; `expected` conta o acumulado sem duplicatas.

**Roteiro do dono/revisor:** com o cliente B5b-fix1 instalado (D538B93B2FA6), a trava local da seção 4, classes e perks em active, DEV_CLASS_LEVEL aceito e DEV_CLASS_SWEEP=true, instalar o bundle C3c quando a sessão estiver disponível para teste. Entrar com personagem que já tenha classe e permanecer sem morrer, sair ou carregar save até a linha final. Espera normal estimada: 15–60 segundos depois da primeira confirmação, a conferir no jogo. Limite nominal atual: (162 passos + 1 reposição) × 10 segundos = **1630 segundos, 27 min 10 s**, além da primeira entrega e das transações. Timeout aborta, não espera todos os passos. Conferir todas as linhas OK e a classe original no nível anterior. Reconectar no mesmo boot não deve repetir; repetir exige um boot novo autorizado pelo dono. Remover a opção desfaz a ativação em uma recarga posterior à reposição. Não apagar autoria no banco. Servidor em execução e jogo não foram manipulados pelo executor.

O harness `runtime/harness/class-sweep.mjs` usa os mesmos argumentos apresentados abaixo, conta marcos do catálogo, testa reposição no nível original 17 e recusa 7777. **Não executado pelo Sol: exige servidor local**; execução fica com Opus. Não recompilar o host ou cliente para esta ordem.

### Entrada durável de XP e entrega online (C3c)

`core.awardLevelingXp(input)` é o único ponto de prêmio de XP do runtime. Recebe a evidência e o snapshot de grupo do contrato existente, CharacterKey e epoch, chama o adaptador durável e só após COMMIT pede `ClassSystem.refresh` quando o nível mudou. O `eventId` do adaptador deduplica eventos; replay não reentrega nem avança revisão. Captura o vínculo antes de aguardar e confirma o epoch depois do commit: saída ou troca de sessão não publica pelo vínculo antigo; a próxima entrada recompõe do banco. Sem vínculo, persiste sem entrega. Um prêmio que alcance mais de um marco compõe todos os marcos alcançados numa entrega. Nível DEV aceito: grava XP normalmente e não reentrega porque o nível efetivo da classe permanece fixo.

As regras de Leveling são incorporadas ao bundle a partir dos JSON existentes, sem mudar seu conteúdo. O prêmio máximo fixo atual é 1000 e não cruza os níveis 5 e 10 em um único evento; o teste desse salto usa um balanceamento explicitamente de teste, validado pelo mesmo adaptador, contra PostgreSQL real e o mesmo cliente simulado.

**Fonte futura de abates deverá chamar `awardLevelingXp`, nunca `createDurableLeveling(...).award` diretamente.** O export de baixo nível permanece para caracterização de persistência. Nenhuma fonte de abates foi conectada. Capability de leveling permanece `UNSUPPORTED` / `SERVER_CONFIRMED_DEATH_OWNER_NOT_DECIDED`, com `entryPoint.name=awardLevelingXp`, `caller=NONE`. O ponto faz I/O e deve ser chamado fora de hit/tick; não é prova de autoridade de abate.

### Varredura de classes (C3b, exclusivamente desenvolvimento)

**Histórico supersedido pela C3c:** os 18 passos no nível máximo, o limite de 190 segundos e o roteiro de 18 linhas desta seção descrevem a varredura anterior. A implementação vigente é a seção “Varredura por marcos (C3c)” acima. O roteiro de 18 linhas da B5b-fix1 acima também é histórico; com o bundle C3c são os marcos do catálogo.

Após a primeira entrega de perks `CONFIRMED`, uma vez por boot do host e por personagem, percorre as 18 classes em ordem de `id`. Cada passo grava pelo comando idempotente `classes.set`, compõe uma nova revisão de publicação, mantém a publicação inicial em voo até seu ACK (sem duplicá-la na varredura), entrega pelo adaptador B5b e espera até 10 segundos pelo ACK exato já registrado no banco. **Histórico supersedido por C3d:** os comandos de troca agora zeram XP/nível/distribuição; a varredura recusa progresso existente. Catálogo e protocolo permanecem os existentes. A nova revisão evita a recusa do cliente a payload diferente na mesma revisão, inclusive ao restaurar a classe que já era a última da lista.

`UNRESOLVED` e `FAILED` produzem `FAIL` no passo, e a varredura segue. Saída, morte, respawn, início de carga ou shutdown interrompem com `ABORTED`; timeout também interrompe. A restauração usa `classes.set` mesmo sem ator vigente, antes de encerrar o sistema. Se houver ator pronto após o término normal ou timeout, aguarda também a entrega da classe original. Depois de saída/respawn, a próxima entrada pronta recompõe a classe restaurada. Um pronto recebido durante a restauração aguarda seu término. Sem classe original, registra `ORIGINAL_CLASS_REQUIRED`, sem mutação: o domínio atual não dispõe de comando para remover uma escolha. Staff não pode mudar a classe durante a varredura (`DEV_SWEEP_IN_PROGRESS`).

O log de cada passo traz `expected`, `applied`, `alreadyPresent`, `unresolved`, `failed`, `removed`, `alreadyAbsent` e `OK`/`FAIL`. As contagens de ensure correspondem aos perks dessa classe; erros e remoções incluem o ACK inteiro. A linha final informa `ok`, `fail`, `restored` e o estado da entrega restaurada. `RESTORE_FAILED` exige intervenção de staff quando o banco não permite gravar a restauração; não é reportado como sucesso. Fechamento abrupto do processo ou indisponibilidade permanente do banco não permitem garantir a restauração: a garantia automatizada cobre as interrupções observadas e o shutdown aguardado.

**Divergências verificadas em 85b7066:** o catálogo contém 350 entradas, em vez das 351 descritas na ordem; a tabela conserva essas 350 sem mudar o catálogo. O cliente atual preserva perks compartilhados sem remover/recolocar, mas responde `APPLIED` para um perk já pertencente ao Core. `ALREADY_PRESENT` indica presença protegida/preexistente. As contagens registram o ACK real, sem reclassificá-lo. O cliente instalado B5b e o resultado no Skyrim precisam ser conferidos pelo dono/revisor.

Tabela para o desenvolvedor oficial: `docs/classes/PERKS_POR_CLASSE.md`; regenerar com `node tools/catalog/perks-per-class.mjs`. A tabela não adiciona os pré-requisitos ausentes nem certifica seus efeitos.

**Roteiro local para o revisor/dono:** com o cliente B5b instalado, classes em `active`, nível DEV `40`, perks em `active`, configurar `GAMEPLAY_CORE_DEV_CLASS_SWEEP=true` e a trava local da seção 4. Não parar/reiniciar a sessão existente sem autorização do dono. Recarregar o Core quando a sessão estiver disponível para o teste; entrar com personagem que já tenha classe e aguardar sem morrer, sair ou carregar save. São 18 passos mais restauração, em geral segundos, limite nominal de 190 segundos após a primeira confirmação. Conferir 18 linhas `OK`, `done: ok=18 fail=0; restored=<original>; delivery=CONFIRMED` e remoção dos exclusivos; comparar o banco pelo comando de explicação. Falha por item continua até o fim; timeout aborta antes. Reconectar no mesmo boot não deve repetir. Recarregar o Core no mesmo host também não repete. Para repetir do início é necessário um novo processo do servidor de teste; não reiniciar a sessão existente sem autorização. Remover a opção e recarregar para desfazer; não apagar autoria de projeção.

**Harness, só Opus:** executar na raiz do Core, com a variável `AETHERIUS_TEST_DATABASE_URL` no ambiente, nunca em argumento/log:

```powershell
node runtime/harness/class-sweep.mjs --port <porta-isolada-diferente-de-7777> --work-dir <pasta-isolada> --addon <scam_native.node> --settings <server-settings.json>
```

Instancia o addon compilado e seu bot, encaminha begin/ready/ACK pelo transporte nativo e executa o cliente de harness B5b em memória. Usa schema descartável de `aetherius_test`, apagado ao fim. Settings fornecem somente dataDir/loadOrder; não copia credenciais, não inicia o gamemode oficial e não toca no servidor em execução. Não certifica efeito dos perks ou comportamento do motor do Skyrim. **Não executado pelo Sol: exige servidor local.**

### Máximos de teste (DEV-A1, exclusivamente desenvolvimento)

O ponto de verdade é `MpActor::GetMaximumValues()`: entrega os três valores em memória quando o ator é jogador online correspondente à entrega; sem override devolve os records como antes. Golpes físicos/mágicos, cura/dano por actor value e `ResourceDamage` do veneno usam esse máximo. O spawn usa a mesma aplicação do override. As taxas raciais de regeneração não mudam: a mesma porcentagem por segundo sobre 300 corresponde a três vezes os pontos por segundo sobre 100. A validação do caminho DEV recusa porcentagem não finita e limita também a regeneração de vigor; o caminho normal conserva a validação legada.

O host entrega os máximos pelo mecanismo existente `SpSnippet Actor.SetActorValue`. Depois das três confirmações de chamada, envia as porcentagens atuais por `ChangeValues`; ACK antigo não publica depois de outra entrega ou mudança de usuário. Não há alteração no cliente. Essas confirmações não comprovam o resultado visual em jogo. A ferramenta `runtime/explain-character.mjs` mostra `developmentAttributes.origin=DEV` e `CONFIGURED_ONLY`: a ferramenta offline não afirma que o ator recebeu o override.

Para o revisor/dono testar: configurar somente no ambiente local `GAMEPLAY_CORE_DEV_ATTRIBUTES=300,300,300`, `NODE_ENV=local`, `GAMEPLAY_CORE_ALLOW_DEV_OPTIONS=true`, sem `GAME_ACCESS_CONTROL=true`. Reconectar e conferir máximo 300 nas três barras/inspeção, inclusive após respawn. Um golpe com dano conhecido `D` deve reduzir a porcentagem de vida em `D/300` (exemplo: 30 pontos, de 100% para 90%, vida 270). Conferir também um golpe sem a opção: queda `D/máximo dos records`. Remover a opção e recarregar o Core devolve os records; a reconexão também permite conferir o spawn normal. Manter `weaponPoison=false` no servidor local. O aceite nativo habilita somente o gate de veneno da fixture `PartOne` em memória, sem socket ou servidor em execução, chama a operação e restaura `false`. Veneno em jogo permanece sujeito à revisão própria D-P1-fix2.

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

### Classes (`classes`, C3a; regra atual C3d)

- **Precisa de:** fundação 0001 a 0004, migrations 0006, 0007 e 0009 e `catalog/classes.json`. Não exige que raças estejam ligadas. O catálogo confere só os plugins relevantes de definição e winner dos perks (Skyrim, Vokrii e os patches listados no próprio catálogo), sem depender da posição deles na load order.
- **Em `active`:** lê a classe e o nível e compõe os perks dos marcos atingidos com origem `CLASS`. Ao entrar novamente, recompõe dos fatos duráveis. Em `canary`, só compõe para os personagens autorizados. Em `audit`/`shadow`, nenhuma concessão de classe entra na composição ativa.
- A escolha é persistida pelo comando idempotente `classes.set`. Staff, inclusive com servidor parado: `node runtime/set-character-class.mjs "<caminho>\gamemode\core\pg.js" profile:<id> elementalista [schema] [requestId]`. O argumento `requestId` opcional permite repetir a mesma operação. Classe desconhecida é recusada. A ferramenta permite troca livre; com C3d, troca efetiva zera XP/nível/distribuição na mesma transação, preservando fadiga/ciclo/limite diário. Definir a mesma classe não zera.
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
- **Nota de supersessão (DOC-1, 12/10/2026):** a frase acima sobre "seis rótulos não resolvidos" não descreve o catálogo atual: em `catalog/classes.json` a lista `unsupported` está vazia e as 350 entradas de perk das 18 classes estão `SUPPORTED`.
- Fora de C3a: interface, custo/restrições de troca (incluindo Winterhold), skills, pontos/alocação de atributos, feitiços de classe e entrega B5b. O módulo legado permanece intocado e não é ligado pelo runtime novo.

### Veneno em arma (D-P1)

**Fonte atual do cliente: D-P1-fix3; protocolo e servidor da fix2 preservados.**
A arma empunhada recebe o veneno/cargas no lugar por PO3_SKSEFunctions,
sem RemoveItem, AddItemEx, pushWornState ou queueNiNodeUpdate. Limpar deixa
veneno nulo e zero cargas; a comparação normaliza esse ExtraPoison vazio.
A API é conferida por getters após a chamada, com trace antes/depois/funções.
Falta de API ou contexto é UNSUPPORTED e impede reconstrução. Corrige somente
quando a arma esperada existe na mão local; repetições de entrada e ciclos não
repetem a mesma tentativa. Multiconjunto elimina o falso +1/-1 das cópias iguais.
Quantidade/outros extras divergentes e veneno divergente em cópia não empunhada
não têm correção certificada nesta ordem. Modelo e testes não provam animação,
registro da VM PO3 nem ausência de queda em Skyrim; roteiro em
integrations/client/LEIA-ME.md e no relatório D-P1-fix3.

**Histórico de reconstrução supersedido abaixo:** o parágrafo que descreve
RemoveItem/AddItemEx registra a fix2 reprovada em jogo em 10/10/2026. Não é
instrução de implantação. O restante do protocolo de intenção continua vigente.

**Fonte histórica: D-P1-fix2.** Os parágrafos históricos de convergência D-P1/fix1 abaixo
explicam o host, mas não provaram o gatilho nem a convergência do cliente. A leitura
prova que TESEquipEvent é repassado, sem provar que Skyrim emite esse evento quando
um veneno é aplicado. A nova intenção nasce da observação de ExtraPoison na arma
empunhada a cada update, usando o mesmo leitor do inventário existente. Também
observa antes da reaplicação de cinco segundos, que continua esperando o fechamento
dos menus. Assim, não depende de esperar esse ciclo para perceber a aplicação.

O cliente envia `weaponPoison/id/weaponId/poisonId/hand` no canal
`aetherius.gameplay.grants/1`, com session/cycle/challenge. Os ids numéricos são
**evidência de runtime, válida só nessa sessão**: não são gravados, catalogados ou
usados como identidade persistente. Não envia contagem, bônus ou resultado. O Core
usa o remetente nativo, verifica a sessão oficial atual e deduplica o id; invoca
`mp.set(actor, 'aetheriusWeaponPoisonIntent', {weaponId, poisonId, hand})`. Esse
binding nativo não é uma propriedade persistida. O host valida arma/mão e ALCH
vencedor, posse da dose e demais recusas existentes; executa a mesma `Coat`.

Durante o pedido, o cliente deixa as bases da arma/dose pendentes na reaplicação
existente, para não apagar a evidência antes da resposta; o ciclo continua a cada
cinco segundos para o resto. `weaponPoisonResult` substitui a projeção `pcInv`
existente pelo snapshot do host. Não cria inventário novo. Réplica do id não consome
outra dose, e a resposta usa o inventário **atual**, não cargas antigas do pedido.
Após 256 ids por sessão de entrega, novos pedidos retornam UNSUPPORTED sem
consumir dose. Sem resposta em dez segundos, o cliente volta à projeção que tem e registra
UNSUPPORTED se a instrumentação estiver ligada; não insiste no consumo. Inventário
que exceda o limite de 65.536 bytes impede essa resposta e produz UNSUPPORTED no
servidor; a publicação nativa continua existindo. O limite é declarado, sem fallback.

Para bases com diferença de veneno, `RemoveItem` sem extras remove o total das cópias
da base; `addItemEx` reconstrói as cópias autoritativas, sobressalentes antes da
empunhada. É no máximo uma substituição da cópia empunhada por transição (aceite,
recusa ou gasto/esgotamento), preservando mão, nome/carga locais quando não vierem
do host. Após esgotamento, a comparação de multiconjunto dessas bases evita o
+1/-1 espúrio de `getDiff(ignoreWorn)`. Bases nunca corrigidas por veneno conservam
o caminho anterior. `remoteServer.ts` e a cadência de cinco segundos não mudaram.

**Prova automatizada e limite:** testes do cliente executam o código real em uma
imitação documentada da API e passam por ClientDelivery/PoisonIntents; tests nativos
executam RequestWeaponPoison/Coat no PartOne real com os winners e a adaga encantada
do registro em jogo. O harness `runtime/harness/weapon-poison-client-native.mjs`
acopla ambos ao addon real, mas exige servidor local e fica para o Opus. A seleção
opaca do motor, execução das filas, som, mão visual e conjunto de golpes precisam
da sessão do dono. Não há declaração de validação em jogo nesta entrega.


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

- `GAMEPLAY_CORE_DEV_CLASS_SWEEP` (**varredura exclusiva do teste; nunca no servidor oficial**, remover inclusive `false`);
- `GAMEPLAY_CORE_DEV_CLASS_LEVEL` (override exclusivo do teste; em produção bloqueia classes);
- `GAMEPLAY_CORE_DEV_ATTRIBUTES` (**override exclusivo do teste; nunca no servidor oficial**);
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
- **Nota de supersessão (DOC-1, 12/10/2026):** o exemplo acima é anterior à entrega das classes. Com o bundle atual as classes carregam; os `UNSUPPORTED` esperados no boot são `leveling`, `religion`, `spells`, `perks` e `damage`, e aparece também `[gameplay-core] attribute maximum writer=CLASS_ADDITIVE; records provide base maxima` (log de 12/10/2026 em `_work/evidence/H/`).
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
- **Nota de supersessão (DOC-1, 12/10/2026):** a orientação acima de "revogar classes" para remover perks por origem **não é executável**: o domínio só tem `classes.set` para uma classe do catálogo e não há comando que remova a escolha (como a seção 5, "Varredura de classes", já diz). Esta entrega não tem procedimento de retirada dos perks de classe por revogação. Desligar conserva os perks no save e a autoria no banco. Não apagar tabela nem remover perks em massa; se a retirada total for exigida, é bloqueio que pede ordem própria.

- **Desligar um sistema:** pôr o modo dele em `off` e reiniciar o servidor (ou recarregar o gamemode). A pedra guardiã volta ao comportamento nativo do jogo; as raças deixam de ser observadas.
- **As tabelas ficam.** Desligar não apaga nada: a escolha de pedra e o registro do que o Core aplicou continuam no banco, e o sistema retoma de onde parou ao ser religado. Não há migration de remoção, de propósito.
- **Feitiços já aplicados** pelo sistema de pedras continuam no personagem depois de desligar; quem os remove é o próprio sistema, numa troca de pedra.
- **Desligar o Core inteiro:** `ENABLE_GAMEPLAY_CORE=false`.
- **Se o Core ou o banco falhar com o sistema ligado,** o servidor do jogo continua no ar; o sistema afetado fica indisponível e diz por quê no log.

## 9. O que foi feito no ambiente local, como referência

**Revalidação da entrega e retirada da varredura (12/10/2026, 23:02; acrescentado pela DOC-1 a partir do registro `_work/evidence/H/sessao-revalidacao-entrega-2026-10-12-2302.md`):** sessão em jogo do dono do projeto com o Core `c50c735`, o addon do servidor recompilado com o C++ da C3d, a migration 0009 aplicada no `aetherius_dev` e o cliente B5b-fix1 (`D538B93B2FA6`). Varredura por classe e por marco: 162 de 162 `result=OK`, sem `FAIL`, `ABORTED` nem `ACK_TIMEOUT`; linha final `done: ok=162 fail=0; classes=18; milestones=162; restored=viper; delivery=CONFIRMED`. Isso revalida em jogo a entrega de perks com a fila única da C3d-fix3. **Não valida os pontos de atributo:** o personagem não tinha pontos distribuídos; o boot mostrou `attribute maximum writer=CLASS_ADDITIVE`. Depois da sessão, `GAMEPLAY_CORE_DEV_CLASS_SWEEP` foi **retirada** do `.env` do servidor local (cópia anterior em `_work\backups\gamemode.env.before-sweep-off-20261012`); para religar no ambiente de desenvolvimento, repor a linha. **Nunca no servidor oficial.**

**C3d-fix1 (12/10/2026, Sol 6.1):** retomada com a 0009 sem CHECK; testes exclusivamente em schemas descartáveis de aetherius_test; nenhuma migration em aetherius_dev, opção local ou .env alterada. Servidor/jogo não iniciados, parados ou reiniciados, nenhuma porta aberta e nenhum binário copiado para build/dist. Core verificado e bundle gerado para revisão; C++ não recompilado neste sandbox, comandos entregues ao revisor. Decisão do dono: homologação de atributos com tela no servidor oficial, pelo desenvolvedor responsável. Não há ativação local a desfazer. O roteiro oficial está no contrato de atributos; ler ACKs, máximos e barras antes/depois de alocar, reconectar e trocar classe.


**Máximos de teste desligados (12/10/2026, revisor, a pedido do dono do projeto):** a linha `GAMEPLAY_CORE_DEV_ATTRIBUTES=300,300,300` foi retirada do `gamemode\.env` do servidor local (cópia anterior em `_work\backups\gamemode.env.before-remove-dev-attributes-20261012`). Vida, magia e vigor voltam aos valores dos records na subida seguinte do servidor; não há dado a apagar. O código da DEV-A1 permanece, inerte sem a opção. Para religar: repor a linha. **Nunca no servidor oficial.**

**C3c (12/10/2026, Sol 6.1):** Core alterado somente nos caminhos da ordem: varredura por marcos, entrada de XP após commit, testes e harness. Nenhuma configuração local, migration de desenvolvimento ou dado de aetherius_dev alterado. PostgreSQL usado apenas em schemas descartáveis de aetherius_test. Servidor/client intocados, sem recompilação, start/stop ou porta aberta. GAMEPLAY_CORE_DEV_ATTRIBUTES permanece retirada conforme o dono; seu código não mudou. Bundle gerado para revisão; instalação, teste do harness nativo e sessão em jogo ficam com revisor/dono. Reverter a ativação removendo DEV_CLASS_SWEEP depois da reposição e recarregando numa sessão autorizada; não apagar grants/autoria. Evidências e resultados finais no relatório C3c; G-C3 não foi marcado.

**B5b-fix1 (12/10/2026, Sol 6.1):** cliente voltou à B5b pura por `git apply -R`/`git apply`, e o build reproduziu o instalado EE6EF143294D byte a byte; depois foi corrigida a confirmação de remoção. Veneno preservado no patch suspenso do Core `85b7066`. Cliente compilado só em evidência, deploy/zip desligados. Nenhum commit, configuração local, jogo/MO2, servidor ou `aetherius_dev` alterado; nenhuma porta aberta. Para futura reversão, o revisor repõe o bundle que preservou, com o jogo fechado; não apagar autoria ou dados. Validação em jogo/harness nativo permanece pendente do revisor/dono.

**C3b-varredura, ativação local (12/10/2026, revisor):** `GAMEPLAY_CORE_DEV_CLASS_SWEEP=true` acrescentada ao `gamemode.env` do servidor local (cópia anterior em `_workackupsgamemode.env.before-class-sweep-20261012`); boot conferido, opção aceita. `aetheriusCombat.weaponPoison` voltou a `false` e o cliente instalado voltou ao build da B5b, por decisão do dono do projeto de suspender o veneno. Harness com o servidor compilado: 18 de 18 classes `OK`. Para desfazer: apagar a linha da opção. **Não levar ao servidor oficial.**

**C3b-varredura (12/10/2026):** opção, testes, harness e tabela preparados no Core. Nenhum `.env` ou setting alterado; servidor/cliente não recompilados, iniciados ou interrompidos; nenhuma porta aberta. Veneno continua suspenso, e seus arquivos não foram alterados. PostgreSQL somente `aetherius_test`. A ativação local e a sessão em jogo são do revisor/dono. Desfazer a futura ativação removendo `GAMEPLAY_CORE_DEV_CLASS_SWEEP` e recarregando o Core depois da restauração. O catálogo real tem 350 entradas; o item de 351 da ordem não foi satisfeito.

**D-P1-fix3 (10/10/2026):** cliente compilado somente em evidência, com deploy/zip
desligados. Servidor intocado, sem recompilação, start/stop ou porta. Sem MO2/jogo,
.env ou aetherius_dev alterados. Core verificado em cópia dentro de evidência
para confinar saídas geradas aos caminhos autorizados. Instalação, harness real
e sessão de jogo ficam para Opus/dono; snapshot e relatório não marcam gate.

**DEV-A1 (10/10/2026):** código e bundle preparados para os máximos de teste. Esta entrega não altera `.env`, não aplica migration, não acessa `aetherius_dev`, não sobe servidor e não liga a opção. `weaponPoison` deve continuar `false`. A ativação e a conferência em jogo ficam com o revisor/dono, seguindo a seção 5. Para desfazer a ativação local, remover `GAMEPLAY_CORE_DEV_ATTRIBUTES` e recarregar o Core/reconectar; não há dado de máximos a apagar. Evidências e limitações da compilação estão no relatório DEV-A1.

| Data | Sistema | No banco de desenvolvimento | Na configuração do servidor local |
|---|---|---|---|
| 08/10/2026 | pedras guardiãs | migrations 0001 a 0004; adoção da pedra do personagem de teste, vinda do protótipo | `ENABLE_STANDING_STONE_SPIKE=false`, `GAMEPLAY_CORE_MODE_STANDING_STONES=active`, `GAMEPLAY_CORE_DATABASE_SCHEMA=public`, `GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV=false`, `GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY=true` |
| 08/10/2026 | raças | migration 0005 | `GAMEPLAY_CORE_MODE_RACES=active` |
| 09/10/2026 | veneno D-P1 | nenhuma alteração em aetherius_dev; testes somente em aetherius_test | compilação Release e sync dos plugins oficiais; opção não ligada; servidor não iniciado; ticks cobertos por teste unitário; stacking e jogo pendentes de revisão |
| 10/10/2026 | D-P1-fix2 | nenhuma migration nova; testes só em aetherius_test; aetherius_dev intocado | Release host e cliente compilados, Core reconstruído e sync conferido; weaponPoison=false; servidor parado; cliente só em evidência, sem jogo/MO2; diagnóstico desligado |
| 10/10/2026 | FIX-1010 | nenhuma migration nova; testes do Core somente em schemas descartáveis de aetherius_test | proteção de veneno e revisão derivada; rebuild Release e bundle; servidor mantido parado; weaponPoison desligado; queda não reproduzida; servidor e jogo pendentes do revisor/dono |
| 08/10/2026 | classes (C3a) | migrations 0006 e 0007; classe do personagem de teste definida como `viper` pela ferramenta `runtime/set-character-class.mjs` | `GAMEPLAY_CORE_MODE_CLASSES=active` e, **só neste ambiente de teste**, `GAMEPLAY_CORE_DEV_CLASS_LEVEL=40` |
| 09/10/2026 | perks no cliente B5b | nenhuma alteração em aetherius_dev; migration 0008 somente em schemas descartáveis de aetherius_test | nenhuma opção local alterada; bundle do cliente em evidência, sem instalação; addon e jogo não executados pelo Sol |

As linhas acima registram a configuração histórica anterior à B1-fix1; não comprovam ativação com a trava nova. **Para o revisor manter o teste local:** definir `NODE_ENV=local` e `GAMEPLAY_CORE_ALLOW_DEV_OPTIONS=true`; deixar `GAME_ACCESS_CONTROL` ausente (ou `false`). `GAMEPLAY_CORE_DEV_CLASS_LEVEL=40` pode permanecer somente nesse teste. Com login oficial, remover `GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY`: o host novo exige sessão oficial mesmo quando ela está presente. Para harness com host antigo sem identidade oficial, conservar essa opção com a trava local.

Remover `ENABLE_STANDING_STONE_SPIKE=false` e `GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV=false` do `.env` quando não forem usadas: fora de desenvolvimento até `false` é presença recusada. As migrations existentes continuam aplicadas manualmente. Nenhuma configuração ou tabela do ambiente local foi alterada na entrega B1-fix1; aplicação e boot cabem ao revisor.

O que difere no servidor oficial: `NODE_ENV=production`, sem confirmação/opções de desenvolvimento e sem adoção; nível vem do Leveling. Manter `offlineMode=true`, login por token e passagem por `audit`/`canary` antes de `active`.

Cada sistema novo acrescenta uma linha a esta tabela e uma subseção à seção 5.
