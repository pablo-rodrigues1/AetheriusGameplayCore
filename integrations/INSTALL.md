# Guia de instalação do GameplayCore no servidor e no cliente oficiais do Aetherius RP

Para o desenvolvedor que vai integrar. Presume que você conhece o `aetherius-server` e o `aetherius-client` oficiais e nunca viu este trabalho.

> **Versão de 12/10/2026, depois da ordem C3d.** Descreve o Core no commit `c50c735` da branch `work/gameplay` e o pacote do host gerado nessa data sobre o `aetherius-server` `340449f`.
>
> **Este guia ainda não foi executado de ponta a ponta numa máquina limpa nem no servidor oficial.** Tudo o que ele relata como validado foi validado no ambiente local de desenvolvimento, na data indicada. A seção 2 separa o que foi validado em jogo do que não foi.

Convenções: `<Core>` é a raiz deste repositório; `<aetherius-server>` e `<aetherius-client>` são os seus clones; `<gamemode>` é a pasta do gamemode no diretório de execução do servidor (no ambiente local, `<aetherius-server>\build\dist\server\gamemode`). Caminhos `_work\...` e o arquivo `RETOMADA.md` ficam no workspace de desenvolvimento do dono do projeto, fora deste repositório; são citados como origem dos fatos.

Documentos que este guia resume, sem copiar:

- [`docs/operations/ATIVACAO_DOS_SISTEMAS.md`](../docs/operations/ATIVACAO_DOS_SISTEMAS.md) — banco, opções e comportamento de cada sistema. É a fonte principal; quando este guia diz "Ativação, seção N", é esse arquivo.
- [`host/LEIA-ME.md`](host/LEIA-ME.md) — o pacote do servidor, trecho por trecho.
- [`client/LEIA-ME.md`](client/LEIA-ME.md) — o pacote do cliente.
- [`docs/classes/PERKS_POR_CLASSE.md`](../docs/classes/PERKS_POR_CLASSE.md) — os perks de cada classe, por marco.

---

## 1. O que é e o que entrega

O GameplayCore é um pacote de regras de gameplay que roda **dentro do gamemode** do servidor, carregado como um único arquivo JavaScript (`dist/aetherius-gameplay-core.cjs`). Ele decide e guarda, no PostgreSQL do próprio gamemode, quem tem qual pedra guardiã, raça e classe, e entrega ao jogador os feitiços e perks correspondentes. Ele não cria conexão de banco, não toca em tabela existente e não substitui nenhum serviço do gamemode.

### Sistemas

| Sistema | O que faz |
|---|---|
| **Pedras guardiãs** (`standing-stones`) | Quando o jogador ativa uma pedra, o servidor impede a ação nativa, grava a escolha, tira os feitiços da pedra anterior e aplica os da nova. Ao reconectar, repõe a partir do banco. 13 pedras no catálogo. |
| **Raças** (`races`) | Quando o personagem entra, o servidor lê a raça, grava a observação e passa a listar as habilidades e perks raciais como concessões de origem "raça". Não aplica nem remove nada: quem aplica o efeito racial é o jogo, pelo record. 10 raças jogáveis no catálogo. |
| **Classes** (`classes`) | O servidor guarda a classe do personagem e, pelo nível, compõe os perks dos marcos atingidos. O catálogo tem **18 classes**, cada uma com 9 marcos (níveis 1, 5, 10, 15, 20, 25, 30, 35 e 40), **162 marcos** e 350 entradas de perk ao todo. A classe é definida por uma ferramenta de staff; não há tela nem comando para o jogador nesta entrega. |
| **Entrega de perks ao cliente** | O servidor envia ao cliente o conjunto de perks do personagem; o cliente aplica só a diferença no jogo e confirma. O servidor só considera entregue depois da confirmação. Exige o pacote do cliente (seção 4.6). |
| **Entrega do marco na subida de nível** | Quando o XP gravado muda o nível do personagem, o marco novo é entregue ao jogador online depois do commit. O ponto de entrada existe (`awardLevelingXp`), mas **nenhuma fonte de XP está conectada** (seção 2). |
| **Pontos de atributo** | O personagem ganha **15 pontos por nível de classe** depois do primeiro (`15 × (nível − 1)`; 585 no nível 40) e os distribui em vida, magia e vigor. Um ponto vale 1 do máximo; a distribuição é em múltiplos de 5; ponto gasto não volta, a não ser pela troca de classe. O servidor guarda a distribuição e o host soma o bônus ao máximo dos records. Não há tela nesta entrega: o contrato para a tela está em `docs/classes/ATRIBUTOS_C3d.md` (seção 8) e existe uma ferramenta de staff (seção 4.5). **Não validado em jogo** (seção 2). |
| **Troca de classe** | Trocar de fato a classe de um personagem **zera o nível, o XP e a distribuição de pontos**, na mesma transação. Definir de novo a mesma classe não zera nada. Fadiga e limite diário de XP são preservados. |

### Quem decide o quê

O servidor é a autoridade sobre **concessão**: quem tem qual pedra, raça, classe, perk e feitiço. Sobre **resultado** (dano, cura, custo, duração), o servidor só responde pelo que o host já calculava; o efeito de cada perk e feitiço concedido é calculado pelo motor do jogo no cliente.

| Fato | Quem decide | Onde fica |
|---|---|---|
| Pedra escolhida, raça observada, classe, XP e nível | servidor (Core) | PostgreSQL, tabelas `gc_` |
| Pontos de atributo gastos em vida, magia e vigor | servidor (Core); o saldo não é gravado, é calculado do nível a cada leitura | PostgreSQL, tabela `gc_attribute_allocation` |
| Máximo de vida, magia e vigor | host: valor dos records mais o bônus que o Core entrega em memória (`aetheriusAttributeBonuses`) | memória do host; nada no save |
| Quais feitiços e perks o personagem tem por pedra, raça e classe | servidor (Core), a partir dos records do catálogo | composto a cada entrada; registro do que foi aplicado em `gc_spell_projections` e `gc_perk_projections` |
| Aplicar o feitiço de pedra no personagem | servidor (host) | — |
| Aplicar o perk de classe no personagem | cliente, a pedido do servidor, com confirmação | save do jogador |
| Efeito do perk, do feitiço e da habilidade racial (armadura, regeneração, custo, dano de magia) | motor do jogo, no cliente | — |
| Dano de golpe físico, vida, magia e vigor em runtime | host SkyMP, como antes | — |
| Inventário, ouro, economia, login, whitelist | não tocados | — |

O cliente nunca envia valor final: envia a confirmação de que aplicou o que o servidor mandou. Identidade de personagem é `profile:<profile_id>`, tirada da sessão oficial do login (`mp.aetheriusOfficialIdentity`); ator sem sessão oficial não recebe nada do Core.

---

## 2. Estado de cada sistema

Fatos, com a data e o registro. "Em jogo" significa sessão do dono do projeto no servidor **local** de desenvolvimento, com um personagem de teste (`profile:108549`). Nada foi executado no servidor oficial.

> **Atenção: sem fonte de XP, todo personagem do servidor oficial fica no nível 1 de classe.** Isso significa: só os perks do primeiro marco da classe e **zero pontos de atributo**. A fonte de XP por abates é uma pendência decidida pelo dono do projeto em 12/10/2026: falta definir quem prova o abate no servidor. O ponto de entrada já existe e é o único que deve ser usado: `core.awardLevelingXp(input)` (Ativação, seção 5, "Entrada durável de XP e entrega online"). No ambiente local os níveis acima de 1 foram exercitados com uma opção de desenvolvimento que não pode ir para o oficial (seção 6).

> **Atenção: os pontos de atributo não foram validados em jogo.** Por decisão do dono do projeto em 12/10/2026, eles não são validados no ambiente local; a homologação é no servidor oficial, com a tela do AetheriusUI Core. O que existe é teste automatizado e ensaio com o servidor compilado.

> **A entrega de perks foi alterada e depois revalidada em jogo, no mesmo dia.** A sessão de 12/10/2026 às 18:33 (162 marcos) validou o adaptador do commit `c7192d7`. Depois dela, a ordem C3d-fix3 corrigiu um defeito real nesse adaptador (duas entregas podiam ficar em andamento ao mesmo tempo, inclusive no caminho normal) e passou todas as publicações por uma fila por personagem (`runtime/src/projection/perks.ts`). A versão deste guia, `c50c735`, foi **revalidada em jogo em 12/10/2026 às 23:02**: 162 de 162 passos `OK`, restauração `OK` e `delivery=CONFIRMED`, com o mesmo cliente (`D538B93B2FA6`); registro em `_work\evidence\H\sessao-revalidacao-entrega-2026-10-12-2302.md`. A revalidação cobre a **entrega**. Não cobre o efeito dos perks (só a amostra da tabela abaixo foi medida) nem os pontos de atributo (o personagem não tinha pontos distribuídos). O cliente não mudou.

### Validado em jogo no ambiente local

| O quê | Data | Registro |
|---|---|---|
| Pedras: escolha, repetição da mesma pedra, trocas, reconexão, mensagens ao jogador | 08/10/2026 | `_work\evidence\H\sessao-pedras-C1-2026-10-08.md` |
| Raças: o servidor observou a raça do personagem (Nord) e listou as concessões raciais | 08/10/2026 | `_work\evidence\H\observacao-racas-C2-2026-10-08.md` |
| Entrega de perks: 19 perks da classe `viper` aplicados e confirmados; reaplicados na reentrada | 10/10/2026 | `STATE.json` (B5b); sessões de 10/10 em `_work\evidence\H\` |
| Concessão dos perks das 18 classes | 12/10/2026, 17:10 | `_work\evidence\C3b\sessao-em-jogo-2026-10-12-1710.log` |
| Entrega por marco: 162 de 162 passos `OK` nas 18 classes, com remoção de perk confirmada pelo cliente. **Feita com o adaptador de entrega anterior** (commit `c7192d7`; ver o terceiro aviso acima) | 12/10/2026, 18:33 | `_work\evidence\H\sessao-marcos-C3c-2026-10-12-1833.md` |
| Entrega por marco **com o adaptador corrigido** (Core `c50c735`, servidor recompilado com o C++ da C3d, migration 0009 aplicada no banco local): 162 de 162 passos `OK`, nenhum `FAIL`, `ABORTED` nem `ACK_TIMEOUT`; classe original reposta; boot com `attribute maximum writer=CLASS_ADDITIVE` e nenhuma linha `attributes UNSUPPORTED` | 12/10/2026, 23:02 | `_work\evidence\H\sessao-revalidacao-entrega-2026-10-12-2302.md` |
| Efeito de perks, **por amostra de duas classes**: confirmados com número Light Armor Mastery, Light Armor Fit, Slow Metabolism (viper); Brutal Fighter, três perks de armadura pesada, Heavy Armor Training, Magic Resistance (cavaleiro_negro) | 12/10/2026 | `_work\evidence\H\sessao-efeito-perks-A-viper-2026-10-12.md` e `...-B-cavaleiro-negro-2026-10-12.md` |
| Servidor sem queda com NPCs depois da correção `fix-1010` | sessões de 10/10 e 12/10/2026 | logs em `_work\evidence\H\` |

### Validado só em teste automatizado

| O quê | Observação |
|---|---|
| Pedras depois de reiniciar o servidor | coberto por teste com processo novo; não testado em jogo (Ativação, seção 5) |
| Entrega do marco na subida de nível por XP (`awardLevelingXp`) | testes do Core contra PostgreSQL real e cliente simulado (ordem C3c). Não há fonte de XP, então não há como acontecer em jogo |
| Trava das opções de desenvolvimento | matriz de combinações nos testes do runtime (ordem B1-fix1), incluindo o caso "opção esquecida no servidor oficial" |
| Fila única de entrega de perks (C3d-fix3), a versão que este guia instala (também revalidada em jogo às 23:02, tabela acima) | cinco testes novos (`runtime/tests/perk-concurrency.test.mjs`), que falham com o adaptador antigo; ensaio da varredura com o servidor compilado: 162 de 162 (`_work\evidence\C3d-fix3\opus-harness-sweep.txt`). Parecer: `_work\reviews\C3d-review-1.md` |
| Pontos de atributo: regra dos pontos, alocação, recusas, repetição do mesmo pedido, duas alocações concorrentes, publicação do bônus ao host | testes do Core contra PostgreSQL de teste; ensaio com o servidor compilado, de ponta a ponta: alocar, conferir o máximo que o host devolve, reconectar, trocar de classe (`_work\evidence\C3d-fix3\opus-harness-attributes.txt`) |
| Máximo do host com bônus, sem bônus e com o override de teste | testes nativos em C++: 69 conferências (`_work\evidence\C3d-fix1\native-unit-opus.txt`); compilação Release (`native-build-opus.txt`) |
| Troca de classe zera nível, XP e distribuição; a mesma classe não zera; fadiga preservada | testes do Core e o ensaio de atributos acima |

### Não validado

- **Pontos de atributo em jogo:** as três barras com o máximo novo, a tela, e o efeito da troca de classe sobre o personagem. Decisão do dono do projeto: homologar no servidor oficial. O roteiro de homologação está no fim de `docs/classes/ATRIBUTOS_C3d.md`.
- **O bônus de atributos nunca foi exercitado em jogo:** na sessão das 23:02 o servidor já rodava com o C++ e o Core da C3d, mas o personagem não tinha pontos distribuídos.

- Efeito dos perks de dano, de veneno e de golpe; efeito da maioria dos 350 perks (só a amostra acima foi medida).
- Efeito das habilidades raciais no multiplayer, em especial as que alteram dano (Ativação, seção 5, "Raças").
- Login em jogo com a identidade oficial **no servidor oficial**. No local, o personagem de teste recebeu vínculo e entrega nas sessões acima.
- Modos `audit`, `shadow` e `canary` em jogo: no ambiente local os sistemas foram direto para `active`, porque só há um personagem de teste (Ativação, seção 6).
- Mais de um jogador ao mesmo tempo.
- Este guia, executado numa máquina limpa.

### Suspenso

- **Veneno em arma.** Suspenso pelo dono do projeto em 12/10/2026. O código está no pacote do host (desligado por `aetheriusCombat.weaponPoison` ausente ou `false`) e num patch de cliente separado, em `client\suspenso\`, que **não** se instala. Histórico: reprovado em jogo em 09/10 e 10/10; a última versão não derrubou o jogo no ataque em uma sessão, e o efeito não foi testado (`RETOMADA.md`, seção 6).

### Desativado

- **Religião.** Não iniciada; desativada por enquanto, por decisão do dono do projeto em 12/10/2026. O relatório de boot mostra `religion: UNSUPPORTED; Catalog domain religion not delivered`, e isso é o esperado.

### Não conectado

- **Fonte de XP por abates.** O Core tem o adaptador que grava XP, nível e fadiga, mas nada o chama: falta decidir quem prova o abate no servidor. O boot mostra `leveling: UNSUPPORTED; SERVER_CONFIRMED_DEATH_OWNER_NOT_DECIDED: ...`. **Consequência prática: sem fonte de XP, todo personagem fica no nível 1 de classe**, recebe só os perks do marco de nível 1 e tem zero pontos de atributo. Quem for conectar a fonte de XP chama `core.awardLevelingXp`, nunca o adaptador de persistência diretamente. No ambiente local os outros marcos foram testados com uma opção de desenvolvimento que força o nível e que não pode ir para o oficial (seção 6).
- **Fórmula de dano.** Adiada. O que existe é um cálculo em sombra, desligado.

### Só desenvolvimento

- **Máximos de teste (300 de vida, magia e vigor).** Confirmados em jogo em 12/10/2026 e desligados no mesmo dia. O código fica inerte sem a opção (seção 6).

---

## 3. Pré-requisitos

### Versões

| Item | Versão | Origem do dado |
|---|---|---|
| Node.js | 22.14.0 ou mais novo | `package.json` do Core (`engines`); o ambiente local usou `v22.14.0` |
| npm | 10 | `runtime/README.md` |
| PostgreSQL | o ambiente local usou a versão 18. A versão mínima **não foi determinada**; as migrations usam `CREATE TABLE`, `jsonb` e `timestamptz` | `_work\evidence\A8\RUNBOOK.md` |
| Compilador C++ | MSVC 14.44, do Visual Studio Build Tools 2022, gerador CMake "Visual Studio 17 2022" | `_work\evidence\upstream-server\configure-nospace.txt` |
| Git | qualquer versão com `git apply`; o ambiente local usou 2.55 | — |

### Commits base

| Repositório | Commit sobre o qual os pacotes foram feitos |
|---|---|
| `aetherius-server` | `340449fae21bb4404439cad0814e60759f944857` |
| `aetherius-client` | `aa864cbf0a7f026dd1b0c2d373640ddedf030369` |
| `AetheriusGameplayCore` | branch `work/gameplay`, commit `c50c735` (35 commits sobre a `main`, `f622518`) |

Se o servidor ou o cliente oficial já passaram desses commits, veja a seção 7.

### Plugins que a load order precisa ter

O catálogo do Core foi gerado dos records vencedores da load order do ambiente local e guarda, para cada plugin de que depende, o **tamanho e o CRC32** do arquivo. No boot o Core confere esses arquivos na pasta de dados do servidor. Se um plugin faltar ou tiver tamanho ou CRC diferente, o sistema que depende dele fica `UNSUPPORTED`, com o motivo no log; os outros sistemas seguem.

Listas tiradas do campo `dependencies` de cada arquivo em `catalog\`:

| Sistema | Arquivo | Plugins conferidos |
|---|---|---|
| Pedras | `catalog/standing-stones.json` | `Skyrim.esm`, `Update.esm`, `unofficial skyrim special edition patch.esp`, `Mundus.esp` |
| Raças | `catalog/races.json` | `Skyrim.esm`, `Update.esm`, `Aetherius.esp`, `AETHERIUS - BALANCE.esp` |
| Classes | `catalog/classes.json` | `Skyrim.esm`, `Vokrii - Minimalistic Perks of Skyrim.esp`, `Vokrii - ADXP Patch.esp`, `Vokrii - Apply Spell Conditions Fix.esp`, `Mysticism - Vokrii Compatibility Patch.esp` |

O tamanho e o CRC32 esperados de cada um estão nesses mesmos arquivos. A **posição** do plugin na load order não importa.

### A regra de identidade de record

Um record é identificado pelo **plugin que o define mais o FormID local**, por exemplo `skyrim.esm|0BABE4`. O FormID de runtime é resolvido no boot. Nenhum índice de plugin, FormID de oito dígitos ou contagem de plugins é gravado em código, configuração ou banco. Por isso reordenar a load order não quebra o Core; trocar o **arquivo** de um plugin da lista acima, sim (o CRC muda).

---

## 4. Passo a passo

Ordem: host, banco, catálogo, bundle, configuração, cliente, ativação. Faça com o servidor do jogo parado, ou com `ENABLE_GAMEPLAY_CORE=false`, até a seção 4.7.

### 4.1 Aplicar o pacote do host e compilar

O pacote está em `host\`: `changes.patch` (um patch com tudo, arquivos novos incluídos), `files\` (cada arquivo tocado, inteiro, no estado final) e `manifest.json` (hash e funcionalidade de cada arquivo). Foi gerado em 12/10/2026 e a prova de que aplica sobre o commit base está em `_work\evidence\DOC-1\14-make-package-final.txt`.

```powershell
git -C <aetherius-server> rev-parse HEAD
Get-FileHash "<Core>\integrations\host\changes.patch" -Algorithm SHA256
git -C <aetherius-server> apply --check "<Core>\integrations\host\changes.patch"
git -C <aetherius-server> apply "<Core>\integrations\host\changes.patch"
```

O `rev-parse` tem de mostrar o commit base da seção 3, e o hash tem de ser o de `host\manifest.json` (`patch.sha256`). O que o patch contém, o que cada trecho faz, como aplicar só uma parte e como compilar estão em [`host/LEIA-ME.md`](host/LEIA-ME.md), seções 1 a 5. Resumo:

- O patch traz seis funcionalidades. **Duas são necessárias no oficial:** o carregador no gamemode (dois arquivos JavaScript, sem compilar C++) e o **bônus de atributos** (C++; exige compilar). A correção de queda do servidor (`fix-1010`) é recomendada e também exige compilar. Veneno, dano em sombra e máximos de teste ficam desligados.
- **Sem recompilar o C++**, pedras, raças, classes e entrega de perks funcionam; os pontos de atributo ficam indisponíveis e o log mostra `attributes UNSUPPORTED: ATTRIBUTE_NATIVE_PROPERTY_UNAVAILABLE`. Isso foi lido no código (`runtime/src/attribute-system.ts`); não foi exercitado com um host sem a propriedade.
- **Mudança de comportamento do host a conferir por você, mesmo com tudo desligado:** para ator **sem aparência**, a base passava `raceId = 0` em dois pontos (`CropRegeneration.cpp` e `MpActor::VisitProperties`); com o patch, os dois usam `GetRaceId()`, que resolve a raça pelo template do NPC. Para jogador com aparência nada muda. Isso foi **lido no diff, não medido**: não se sabe se altera os valores de algum NPC. Detalhe em [`host/LEIA-ME.md`](host/LEIA-ME.md), seção 3.
- Compilar: a sequência completa, com o preparo do vcpkg, o diretório de build obrigatório (`<aetherius-server>\build`) e o caminho **sem espaços**, está em [`host/LEIA-ME.md`](host/LEIA-ME.md), seção 5. Alvo `skymp5-server`, configuração `Release`; é preciso reconfigurar o CMake antes, por causa dos arquivos novos. Essa receita foi usada no clone de desenvolvimento; **não foi executada numa máquina limpa**.
- Depois de compilar, rodar `server\tools\sync-client-plugins.js` e conferir que `aetheriusCombat.weaponPoison` e `aetheriusCombat.shadow` continuam ausentes ou `false` no `server-settings.json` do diretório de execução.

### 4.2 Banco

O Core usa o PostgreSQL que o gamemode já usa, pelo pool de `<gamemode>\core\pg.js`. A conexão vem das variáveis que o gamemode já lê (`GAME_DATABASE_URL` ou, se ausente, `DATABASE_URL`). O Core só cria tabelas com prefixo `gc_`; o executor de migrations recusa arquivo que toque tabela sem esse prefixo. As migrations só criam tabela e índice (Ativação, seção 1).

| Migration | Onde está definida | Cria | Para quê |
|---|---|---|---|
| `0001_gc_schema_migrations.sql` | arquivo | `gc_schema_migrations` | controle das migrations aplicadas e da assinatura de cada arquivo |
| `0002_gc_commands.sql` | arquivo | `gc_commands` | registro de comandos, para ação repetida não valer em dobro |
| `0003_gc_spell_projection.sql` | arquivo | `gc_spell_projection_heads`, `gc_spell_projections` | o que o Core já aplicou de feitiços por personagem |
| `0004_gc_standing_stone_choice.sql` | arquivo | `gc_standing_stone_choice` | pedra escolhida |
| `0005_gc_race_observation.sql` | arquivo | `gc_race_observation` | raça observada |
| `0006_gc_character_class.sql` | arquivo | `gc_character_class` | classe e revisão |
| `0007_gc_leveling_progress.sql` | arquivo | `gc_leveling_progress` | XP, nível e fadiga |
| `0008_gc_perk_projection.sql` | **código** | `gc_perk_projections` | perks aplicados e confirmados, e autoria por personagem |
| `0009_gc_attribute_allocation.sql` | arquivo | `gc_attribute_allocation` | pontos gastos em vida, magia e vigor e a revisão, por personagem. Não guarda saldo. Sem `CHECK`: quem garante não negativos e múltiplos de 5 é o comando; uma linha inválida é recusada na leitura (`ATTRIBUTE_ALLOCATION_INVALID`) e não é corrigida sozinha |

São **nove**. Oito são arquivos em `database\migrations\` (0001 a 0007 e 0009). A **0008 é definida em código**, em `runtime/src/projection/migration.ts`, e não existe como arquivo `.sql`; é aplicada pelo mesmo comando e vai embutida no bundle. Não existe arquivo 0008 e isso não é uma lacuna.

A ordem de aplicação é sempre **0001 a 0009, pelo número**. O comando junta os oito arquivos e a 0008 definida em código, e o executor **ordena pelo número antes de aplicar** (`shared/persistence/src/migrations.ts`, função `prepare`). Ele também recusa aplicar uma migration de número menor que outra já aplicada (`MIGRATION_ORDER_INVALID`) e recusa continuar se uma migration já aplicada mudou ou não está mais entre as entregues (`MIGRATION_HASH_MISMATCH`). Num banco que já tem 0001 a 0008, o `apply` aplica só a 0009. Aplique sempre pelo comando abaixo; não rode os SQL à mão.

Quem precisa de quê: pedras, 0001 a 0004; raças, mais a 0005; **classes, mais a 0006, a 0007 e a 0009** (sem a 0009 as classes ficam indisponíveis); entrega de perks, mais a 0008.

**Como aplicar.** Na raiz do Core, depois do `npm ci` da seção 4.4, com as mesmas variáveis de ambiente do gamemode definidas no ambiente do processo (nunca em argumento de linha de comando):

```powershell
npm run migrations:status -- "<caminho absoluto>\gamemode\core\pg.js"
npm run migrations:apply  -- "<caminho absoluto>\gamemode\core\pg.js"
npm run migrations:status -- "<caminho absoluto>\gamemode\core\pg.js"
```

- O `apply` aplica só o que falta, numa transação: ou entra tudo, ou nada. Repetir não faz nada. Um terceiro argumento opcional é o schema (padrão `public`).
- **O `status` não lista o que falta.** Ele só passa quando as nove migrations estão aplicadas e iguais às entregues; nesse caso mostra as nove, com hash e data. Antes da primeira aplicação a tabela de controle ainda não existe e o comando termina com `Migration status failed: <código>`; com alguma migration pendente, termina com `Migration status failed: MIGRATIONS_NOT_CURRENT`. Portanto o **primeiro** `status` da sequência acima pode falhar, e isso é esperado; o que tem de passar é o `status` **depois** do `apply`. Isto foi lido no código (`migrationStatus`, no mesmo arquivo); não foi executado contra um banco nesta ordem.
- **Schema diferente de `public`:** ele precisa **existir antes**. O executor não cria schema e recusa com `SCHEMA_MISSING`.
- **Quem aplica:** uma pessoa, à mão, com backup do banco feito antes. **O servidor não aplica migrations sozinho** no oficial. Existe uma opção que aplica no boot; ela é só de desenvolvimento (seção 6).
- Não edite um arquivo de migration já aplicado: o Core guarda a assinatura de cada um e recusa subir os sistemas que dependem do banco se um arquivo aplicado mudou. O `.gitattributes` do Core fixa o fim de linha desses arquivos (LF) para a assinatura ser a mesma em qualquer máquina; não os converta.
- Detalhes: Ativação, seções 2 e 3.

### 4.3 Catálogo: conferir contra a load order oficial

Os três arquivos de `catalog\` já estão no repositório e são embutidos no bundle na seção 4.4. Você não precisa gerá-los se os plugins da seção 3 forem, byte a byte, os do ambiente onde o catálogo foi gerado.

**Conferência de verdade: o boot.** Ao subir, o Core lê os plugins relevantes na pasta de dados do servidor e compara tamanho, CRC32 e tipo (leve ou não). Divergência aparece no log como `Plugin absent: <arquivo>` ou `Plugin signature/kind mismatch: <arquivo>`, na linha `[gameplay-core] <sistema>: UNSUPPORTED; ...` (seção 5).

**Conferência antes de subir (limitada).** A partir de uma pasta que contenha `AetheriusGameplayCore\` e `aetherius-server\` lado a lado, com o servidor compilado e sincronizado (o script lê `aetherius-server\build\dist\server\data\aetherius-loadorder.json`):

```powershell
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/verify.ts .
```

Em 12/10/2026 esse comando passa nos três domínios (`_work\evidence\DOC-1\10-catalogo-verify-fase2.txt`). Ele compara, para cada plugin do catálogo, nome do arquivo, tamanho, CRC32 e tipo. Até essa data ele falhava no domínio de classes por comparar também três campos de metadados que não identificam o plugin; foi corrigido nesta entrega, e o teste com um plugin alterado e com um plugin ausente continua recusando (`13-catalogo-verify-teste-negativo.txt`).

**Se um plugin do oficial for diferente** (outra versão de `Vokrii`, de `Mundus.esp`, de `AETHERIUS - BALANCE.esp`, por exemplo), o catálogo precisa ser gerado de novo:

```powershell
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/build.ts <pasta dos exports> <aetherius-loadorder.json> AetheriusGameplayCore/catalog
```

Esse comando lê **exports de records em JSONL** (raças, feitiços, efeitos, perks, pedras) tirados da instância do Mod Organizer com a ferramenta houseCARL. Esses exports **não estão neste repositório** (ficam em `_work\exports\` no workspace de desenvolvimento) e o procedimento para produzi-los não está documentado aqui. **`build.ts` não regenera `classes.json`:** ele gera só `standing-stones.json` e `races.json` (`tools/catalog/build.ts`, função `buildDomains`, e o laço de gravação em `main`). Não há, neste repositório, comando que regenere o catálogo de classes; `perks-per-class.mjs` só produz a tabela de documentação a partir do catálogo que já existe. Se a load order oficial diferir nos plugins da seção 3, a regeneração tem de ser feita por quem tem os exports e a instância; trate como bloqueio e avise o dono do projeto. Depois de regenerar, refaça a seção 4.4.

Para regenerar só a tabela de perks por classe, a partir do catálogo já existente: `node tools/catalog/perks-per-class.mjs` (na raiz do Core).

### 4.4 Construir o bundle do Core

Na raiz do Core:

```powershell
npm ci
npm run typecheck
npm run build
```

O resultado é `dist\aetherius-gameplay-core.cjs`: um arquivo CommonJS, sem dependência de npm em runtime (só módulos internos do Node), com os três catálogos e as migrations embutidos. A pasta `dist\` é ignorada pelo git: o bundle se constrói, não se baixa. No ambiente local ele tinha cerca de 1,1 MB (relatório da ordem C3c).

`npm test` roda a suíte inteira, mas precisa de coisas que só o ambiente de desenvolvimento tem: um PostgreSQL de teste descartável na variável `AETHERIUS_TEST_DATABASE_URL`, os exports de records e a pasta de dados do servidor compilado. Sem isso os testes do catálogo falham por falta de artefato. A linha de base conhecida tem falhas antigas no módulo legado `class-system` (49 de 55), que o runtime novo não usa.

### 4.5 Ligar no gamemode

As opções ficam no `.env` do gamemode. O Core lê todas no boot; mudar exige reiniciar o servidor ou recarregar o gamemode (Ativação, seção 4).

| Opção | Valor no oficial | Se faltar ou estiver errada |
|---|---|---|
| `ENABLE_GAMEPLAY_CORE` | `true` | ausente ou `false`: o gamemode não carrega o Core; nada muda no jogo |
| `GAMEPLAY_CORE_BUNDLE` | caminho absoluto de `aetherius-gameplay-core.cjs` (ou relativo ao diretório de execução do servidor) | com o Core ligado e esta opção vazia, o módulo falha no boot com `Defina GAMEPLAY_CORE_BUNDLE para carregar o Core`; o resto do gamemode segue |
| `GAMEPLAY_CORE_MODE_STANDING_STONES` | `off`, `audit`, `shadow`, `canary` ou `active` (seção 4.7) | ausente: `off`. Valor inválido: `off`, com aviso `invalid mode for <sistema>; using off` |
| `GAMEPLAY_CORE_MODE_RACES` | idem | idem |
| `GAMEPLAY_CORE_MODE_CLASSES` | idem | idem |
| `GAMEPLAY_CORE_CLIENT_PERKS_MODE` | `off`, `canary` ou `active`. `audit` e `shadow` não iniciam a conversa com o cliente nem aplicam perks | ausente: `off`; as classes compõem os perks no servidor, mas nada chega ao jogo. Valor inválido: `invalid GAMEPLAY_CORE_CLIENT_PERKS_MODE; using off` |
| `GAMEPLAY_CORE_CANARY_CHARACTERS` | lista separada por vírgula, no formato `profile:<profile_id>` | só importa para o que estiver em `canary`; entrada fora do formato é ignorada |
| `GAMEPLAY_CORE_DATABASE_SCHEMA` | o schema das tabelas `gc_`, se não for `public` | ausente: `public`. Tem de ser o mesmo usado ao aplicar as migrations |
| `NODE_ENV` | `production` | é a mesma variável que o gamemode já usa para escolher o arquivo de opções. As opções de desenvolvimento só valem com `NODE_ENV=local` (seção 6) |

Todas as opções da seção 6 têm de estar **ausentes**.

O modo `GAMEPLAY_CORE_MODE_LEVELING` pode ser configurado, mas o leveling aparece `UNSUPPORTED` de qualquer jeito, por não ter fonte de eventos. As opções de `aetheriusCombat` (veneno e sombra) não são do `.env`: ficam no `server-settings.json` e devem permanecer ausentes ou `false`.

**Definir a classe de um personagem.** Não há tela nem comando de jogador. Staff define pela ferramenta abaixo (Ativação, seção 5, "Classes"). **Ela é offline quanto à entrega:** grava o comando no banco e termina; não fala com o servidor em execução.

```powershell
node runtime/set-character-class.mjs "<caminho absoluto>\gamemode\core\pg.js" profile:<profile_id> <classe>
```

Os ids das classes são: `anti_mago`, `arqueiro`, `assassino`, `berserker`, `cavaleiro_negro`, `criomante`, `curandeiro`, `druida`, `elementalista`, `eletromante`, `guardiao`, `invocador`, `mestre_espadachim`, `paladino`, `piromante`, `ranger`, `trapaceiro`, `viper`. Classe desconhecida é recusada. A ferramenta permite troca livre. **Trocar de fato a classe zera o nível, o XP e a distribuição de pontos do personagem**, na mesma transação; definir a mesma classe de novo não zera nada; fadiga e limite diário são preservados. Regras de quem pode trocar (ticket, nível gratuito) não existem no Core.

**O que acontece com um jogador online.** A ferramenta só executa o comando durável (`runtime/set-character-class.mjs`); ela não chama o Core em execução. No instante em que termina, **o banco já tem a classe nova, o nível e o XP zerados e a distribuição de pontos apagada**, mas o personagem que está online continua com os perks e o máximo antigos até a próxima entrada no mundo (o sinal de pronto do ator), quando o Core recompõe tudo a partir do banco. Por isso: faça a troca com o jogador fora do servidor, ou peça que ele saia e entre de novo; depois confira no log a linha `perks profile:<id>: CONFIRMED` (seção 5) e, se quiser, a explicação por personagem. A publicação imediata existe só no caminho online do runtime (`runtime/src/classes.ts`: depois do commit, republica atributos e perks), que nesta entrega não tem tela nem comando ligado a ele.

**Distribuir pontos de atributo por staff.** Enquanto não há tela, a distribuição é feita por esta ferramenta, que usa o mesmo comando de domínio que a tela usará:

```powershell
node runtime/allocate-attributes.mjs "<caminho absoluto>\gamemode\core\pg.js" profile:<profile_id> <vida> <magia> <vigor>
```

Os três números são **acréscimos** (inteiros não negativos, múltiplos de 5, soma maior que zero), não o total. A ferramenta só grava: o resultado traz `delivery=NOT_SENT`, e o host recebe o bônus na próxima entrada do personagem. Argumentos opcionais: schema e `requestId` (repita o mesmo `requestId` para repetir o mesmo pedido sem gastar em dobro). Com todo personagem no nível 1, não há ponto a distribuir: o pedido é recusado com `ATTRIBUTE_POINTS_INSUFFICIENT`.

### 4.6 Aplicar o pacote do cliente e compilar

Instruções completas em [`client/LEIA-ME.md`](client/LEIA-ME.md). Resumo:

```powershell
git -C <aetherius-client> rev-parse HEAD
git -C <aetherius-client> apply --check "<Core>\integrations\client\B5b-aa864cb.patch"
git -C <aetherius-client> apply "<Core>\integrations\client\B5b-aa864cb.patch"
```

- O patch altera quatro arquivos em `client\src\` e cria `client\src\services\services\gameplayGrantService.ts`. Só trata da entrega de perks. **Não** aplique `client\suspenso\B5b-mais-veneno-fix3-aa864cb.patch`: é o veneno, suspenso.
- Em 12/10/2026 foi conferido que o patch corresponde à árvore do cliente de desenvolvimento (`_work\evidence\DOC-1\02-cliente-apply-check-R.txt` e `03-cliente-prova-por-hash.txt`).
- Compilação: os comandos estão no `client/LEIA-ME.md` (TypeScript sem emitir, depois webpack). Eles pressupõem as dependências instaladas na pasta `client` (`node_modules`), pelo `client\package.json` e pelo `client\yarn.lock` do mantenedor; o pacote não acrescenta dependência. O bundle que foi validado em jogo em 12/10 tem SHA-256 começando em `D538B93B2FA6`; um build seu só terá o mesmo hash se as dependências forem as mesmas, o que não foi conferido fora do ambiente local.
- Distribuição aos jogadores: pelo fluxo do launcher que o projeto já usa. **Cliente antigo continua entrando:** para ele o servidor registra a entrega de perks como `CLIENT_UNSUPPORTED`, e pedras e raças funcionam sem o cliente novo (as mensagens das pedras apareceram no cliente v0.13.0 sem alteração, registro de 08/10).
- O serviço do cliente fica passivo até o servidor iniciar a conversa. Com `GAMEPLAY_CORE_CLIENT_PERKS_MODE=off`, o cliente novo se comporta como o antigo.
- A ordem C3d não alterou o cliente nem o protocolo `aetherius.gameplay.grants`. O que mudou depois da validação em jogo foi o lado do servidor da entrega (seção 2).

### 4.7 Ordem de ativação recomendada

Um sistema por vez, nesta ordem: pedras, raças, classes, entrega de perks. Para cada um (Ativação, seção 6):

1. Backup do banco.
2. Servidor parado, ou o sistema em `off`.
3. `migrations:status`, `migrations:apply`, `migrations:status` (seção 4.2).
4. `off` → `shadow` (ou `audit`, que é equivalente): o sistema observa e registra no log o que faria, sem gravar e sem alterar o jogo. Suba o servidor e leia o log por um período.
5. `shadow` → `canary`, com um ou dois `profile_id` da equipe em `GAMEPLAY_CORE_CANARY_CHARACTERS`. Teste em jogo.
6. `canary` → `active`.

Para a entrega de perks (`GAMEPLAY_CORE_CLIENT_PERKS_MODE`) não há etapa de observação: de `off` vai para `canary` e depois `active`. Ela só tem o que entregar com as classes em `canary` ou `active`, e precisa da migration `0008_gc_perk_projection.sql` e do cliente da seção 4.6.

Antes de ligar qualquer sistema, faça a conferência da seção 6.

Os passos 4 e 5 **não foram exercitados em jogo**: no ambiente local os sistemas foram direto para `active`.

---

## 5. Conferência depois de ligar

As linhas abaixo foram copiadas do log do servidor local de 12/10/2026 (`_work\evidence\H\server-20261012-183042.log`) do ensaio com o servidor compilado de 12/10/2026 (`_work\evidence\C3d-fix3\opus-harness-attributes.txt`) ou do código no commit `c50c735`. O prefixo de data e `[console] [info]` foi omitido. O Core escreve tudo no nível `info`, inclusive o que chama de `ERROR`: procure pelo texto, não pelo nível.

### No boot

| Linha | Significado |
|---|---|
| `[gameplay-core] bundle 0.1.0; initialized; active instances=1` | o Core carregou. Tem de haver **uma** instância |
| `[gameplay-core] attribute maximum writer=CLASS_ADDITIVE; records provide base maxima` | o sistema de atributos subiu: o máximo é o dos records mais o bônus distribuído. Aparece quando o banco está disponível e as classes não foram recusadas. **No oficial tem de ser `CLASS_ADDITIVE`**; `writer=DEV` significa opção de desenvolvimento ligada |
| `[module-registry] [LAB] gameplay-core: ATIVO (0 comandos registrados)` | o gamemode registrou o módulo |
| `[gameplay-core] leveling: UNSUPPORTED; SERVER_CONFIRMED_DEATH_OWNER_NOT_DECIDED: runtime awardLevelingXp entry available after boot; no caller/event source connected` | esperado: não há fonte de XP |
| `[gameplay-core] religion: UNSUPPORTED; Catalog domain religion not delivered` (e as mesmas para `spells`, `perks`, `damage`) | esperado: sistemas não entregues |

Não deve aparecer nenhuma linha `[gameplay-core] DEV ...` nem `[gameplay-core] ERROR ...`.

### Quando um personagem entra

| Linha | Significado |
|---|---|
| `[races] active: profile:<id> SUPPORTED skyrim.esm\|013746` | raça observada (o exemplo é Nord) |
| `[classes] active: profile:<id>; level origin=LEVELING; class perks=<n>; delivery=SENT_UNCONFIRMED` | classes compuseram `<n>` perks e enviaram. No oficial a origem do nível tem de ser `LEVELING`; `DEV` significa opção de desenvolvimento ligada |
| `[gameplay-core] perks profile:<id>: ACK_RECEIVED; applied=<n>; alreadyPresent=0; unresolved=0; failed=0; removed=0; alreadyAbsent=0; delivery evidence only` | o cliente respondeu. `unresolved` e `failed` têm de ser zero |
| `[gameplay-core] perks profile:<id>: CONFIRMED; <n> items; delivery evidence only` | a entrega foi gravada. **Só esta linha comprova a entrega**; `SENT_UNCONFIRMED` nunca significa aplicado. Nenhuma das duas comprova o efeito do perk no jogo |

As linhas do sistema de pedras têm o prefixo `[standing-stones]`.

### No banco e por personagem

```sql
SELECT version, applied_at FROM gc_schema_migrations ORDER BY version;
```

```powershell
node runtime/explain-character.mjs "<caminho absoluto>\gamemode\core\pg.js" profile:<profile_id>
```

A segunda só lê: mostra pedra, raça, classe, nível, origem do nível, marcos e concessões, com o servidor ligado ou parado (Ativação, seção 7).

Para os atributos, a explicação mostra nível, origem do nível, pontos ganhos, gastos, disponíveis e o motivo quando a distribuição não é aplicável. Ela não mostra o máximo atual: isso depende do host e da sessão. Sem a migration 0009 mostra `ATTRIBUTE_MIGRATION_UNAVAILABLE`.

Recusas que a API e a ferramenta de staff devolvem ao distribuir pontos (lista completa e o que a tela deve fazer com cada uma em `docs/classes/ATRIBUTOS_C3d.md`): `ATTRIBUTE_POINTS_INVALID`, `ATTRIBUTE_POINTS_INSUFFICIENT`, `CLASS_REQUIRED`, `REQUEST_ID_REUSED`, `MODE_OR_STALE_BINDING`, `DEV_SWEEP_IN_PROGRESS`.

### Linhas de erro e o que significam

| Linha (trecho) | Causa | O que fazer |
|---|---|---|
| `[gameplay-core] ERROR <OPÇÃO> refused: NODE_ENV must be explicitly local; ...` | uma opção de desenvolvimento está presente fora do ambiente de desenvolvimento | remover a opção do `.env` (seção 6). O sistema que depende dela fica indisponível até lá |
| `[gameplay-core] persistence unavailable: <código>; Run npm run migrations:apply -- <absolute-path-to-gamemode-core/pg.js> [schema] from the Core root` | falta migration, o banco está inacessível ou um arquivo de migration aplicado mudou | aplicar as migrations (seção 4.2). O servidor do jogo não cai; os sistemas que usam banco ficam indisponíveis |
| `[gameplay-core] client perks UNSUPPORTED: PERK_MIGRATION_UNAVAILABLE: apply 0008_gc_perk_projection.sql` | a tabela de perks não existe | aplicar as migrations |
| `[gameplay-core] client perks UNSUPPORTED: TRANSPORT_OR_DATABASE_UNAVAILABLE` | o modo de perks está ligado, mas falta o banco ou a API de pacote customizado do host | conferir o banco e a versão do servidor |
| `[gameplay-core] attributes UNSUPPORTED: ATTRIBUTE_NATIVE_PROPERTY_UNAVAILABLE` | o host não tem a propriedade `aetheriusAttributeBonuses` | aplicar o pacote do host e recompilar o C++ (seção 4.1). Nada é gravado em propriedade customizada no lugar |
| `[gameplay-core] attributes UNSUPPORTED: OFFICIAL_SESSION_REQUIRED` | o ator não tem sessão oficial atual | conferir o login do jogador |
| `[gameplay-core] attributes UNSUPPORTED: ATTRIBUTE_NATIVE_DELIVERY_UNAVAILABLE` | o gamemode não consegue escrever a propriedade no host | conferir a versão do servidor |
| `[gameplay-core] profile:<id>: ATTRIBUTE_ALLOCATION_EXCEEDS_LEVEL; saved allocation retained, bonuses suppressed` | os pontos gravados são mais do que o nível atual dá | o bônus não é aplicado e nada é apagado. Não corrija o dado em silêncio; investigue por que o nível caiu |
| `[gameplay-core] profile:<id>: ATTRIBUTE_ALLOCATION_INVALID; saved allocation retained, bonuses suppressed` | a linha gravada tem valor negativo ou fora de múltiplo de 5 (alguém escreveu na tabela por fora do comando) | encaminhar ao responsável pelo banco; o Core não corrige |
| `[classes] DEV sweep ERROR SWEEP_WOULD_RESET_PROGRESS` | só em desenvolvimento: a varredura recusou começar porque o personagem tem XP ou pontos distribuídos | no oficial essa linha não pode existir (a varredura é opção de desenvolvimento) |
| `[gameplay-core] <sistema>: UNSUPPORTED; Plugin absent: <arquivo>` | plugin do catálogo fora da load order | seção 3 |
| `[gameplay-core] <sistema>: UNSUPPORTED; Plugin signature/kind mismatch: <arquivo>` | o arquivo do plugin difere do usado para gerar o catálogo | seção 4.3 |
| `[gameplay-core] <sistema>: UNSUPPORTED; Catalog host/files unavailable; check host dataDir and relevant plugin files` | o Core não conseguiu ler a pasta de dados do servidor | conferir `dataDir` no `server-settings.json` |
| `[gameplay-core] invalid mode for <sistema>; using off` | valor inválido em `GAMEPLAY_CORE_MODE_*` | corrigir o valor |
| `STANDING_STONE_SPIKE_CONFLICT: disable ENABLE_STANDING_STONE_SPIKE before canary/active` | o protótipo antigo de pedras está ligado junto com o sistema novo | remover `ENABLE_STANDING_STONE_SPIKE` |
| `[races] profile:<id> UNSUPPORTED <motivo>` | raça fora das dez jogáveis, ou outro motivo declarado | nada é feito ao personagem; investigar o motivo |
| `ACK_TIMEOUT` (Ativação, seção 7) | o cliente não confirmou em 10 segundos; a entrega fica `SENT_UNCONFIRMED` e é reenviada na reconciliação seguinte | conferir a versão do cliente do jogador |
| `Defina GAMEPLAY_CORE_BUNDLE para carregar o Core`, `Bundle sem createGameplayCore`, `GameplayCore sem <método>` | erros do descriptor em `phase0-basic.js` | conferir o caminho e o arquivo do bundle |

O texto exato de `ACK_TIMEOUT` no log não foi conferido para este guia; a constante de 10 segundos está em `runtime/src/projection/perks.ts`.

---

## 6. O que nunca pode ir para o servidor oficial

O arquivo `runtime/src/development.ts` define a lista `DEVELOPMENT_OPTIONS`. Relida no commit `c50c735`: são seis opções, as mesmas de antes da C3d.

| Opção | O que faz no ambiente de desenvolvimento |
|---|---|
| `GAMEPLAY_CORE_DEV_CLASS_SWEEP` | troca a classe do personagem por todas as classes e marcos, para testar a entrega. Cada troca zera nível, XP e distribuição de pontos; por isso ela recusa começar se o personagem tiver XP ou pontos gravados (`SWEEP_WOULD_RESET_PROGRESS`) |
| `GAMEPLAY_CORE_DEV_CLASS_LEVEL` | força o nível de classe (1 a 40) sem gravar XP |
| `GAMEPLAY_CORE_DEV_ATTRIBUTES` | força os máximos de vida, magia e vigor |
| `GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY` | aceita perfil sem autenticação num host antigo |
| `GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV` | aplica migrations no boot |
| `ENABLE_STANDING_STONE_SPIKE` | liga o protótipo antigo de pedras |

Mais uma variável, que não está na lista mas é a chave que as libera: `GAMEPLAY_CORE_ALLOW_DEV_OPTIONS`.

### Lista de conferência

No `.env` do gamemode do servidor oficial, **as sete têm de estar ausentes** — não basta `false` nem valor vazio:

- [ ] `GAMEPLAY_CORE_DEV_CLASS_SWEEP`
- [ ] `GAMEPLAY_CORE_DEV_CLASS_LEVEL`
- [ ] `GAMEPLAY_CORE_DEV_ATTRIBUTES`
- [ ] `GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY`
- [ ] `GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV`
- [ ] `ENABLE_STANDING_STONE_SPIKE`
- [ ] `GAMEPLAY_CORE_ALLOW_DEV_OPTIONS`

E ainda:

- [ ] `NODE_ENV=production` no ambiente efetivo do processo.
- [ ] No log do boot, nenhuma linha `[gameplay-core] DEV ...`, nenhuma `[gameplay-core] ERROR ... refused` e nenhuma `attribute maximum writer=DEV`.
- [ ] `aetheriusCombat.weaponPoison` e `aetheriusCombat.shadow` ausentes ou `false` no `server-settings.json`.
- [ ] A ferramenta `runtime/adopt-standing-stone.mjs` não é usada: serviu para migrar um personagem de teste do protótipo.

### A trava

Uma opção da lista só é aceita quando as três condições valem ao mesmo tempo (função `isDevelopmentEnvironment`):

1. `NODE_ENV` é exatamente `local` (ausente não conta como local);
2. `GAME_ACCESS_CONTROL` não é `true`;
3. `GAMEPLAY_CORE_ALLOW_DEV_OPTIONS` é exatamente `true`.

Fora disso, a **simples presença** da opção — inclusive vazia ou `false` — é recusada: o Core escreve `ERROR <opção> refused: <motivos>` e o sistema que depende dela não sobe (por exemplo, com `GAMEPLAY_CORE_DEV_CLASS_LEVEL` esquecida, as classes ficam indisponíveis; pedras e raças continuam). Não há retorno silencioso ao comportamento normal: é preciso remover a opção.

O servidor oficial roda em `offlineMode=true` com login por token. **`offlineMode` não é critério de ambiente de desenvolvimento** e não deve ser alterado por causa do Core. Detalhes: Ativação, seção 4, "Só desenvolvimento".

---

## 7. Se o servidor ou o cliente oficial divergiram dos commits base

Os dois repositórios recebem commits com frequência; é provável que os patches não apliquem direto.

1. **Tente primeiro o patch inteiro, só conferindo:** `git apply --check`. Se passar, aplique.
2. **Se falhar, tente a aplicação a três vias,** que usa os blobs da base quando o seu clone os tem: `git apply --3way <patch>`. Os conflitos ficam marcados nos arquivos. (Essa forma não foi exercitada nesta entrega.)
3. **Se ainda falhar, aplique por partes:**
   - Arquivos **novos no pacote** podem já existir no oficial mais novo, se o mantenedor tiver criado o mesmo caminho. **Copie de `host\files\` só se o destino não existir.** Se existir, não copie por cima: compare os dois e trate como conflito, com o mantenedor. O `git apply` já recusa criar um arquivo que existe; mantenha essa mesma proteção na cópia manual. Para aplicar só um caminho: `git apply --include=<caminho>`.
   - Para cada arquivo **alterado**, use a tabela da seção 3 do [`host/LEIA-ME.md`](host/LEIA-ME.md): ela diz, por função, o que foi acrescentado e por quê. Os trechos são pequenos e marcados com `AETHERIUS <ordem>`. A cópia inteira do arquivo em `host\files\` serve para ver o resultado esperado, **não para substituir o arquivo do mantenedor**: ela está no estado da base mais as nossas mudanças e apagaria o que o mantenedor fez depois.
4. **Nunca sobrescreva o que o mantenedor alterou.** Em dúvida, o código dele vale e a nossa mudança é que se adapta.

### Arquivos com mais chance de conflito

| Arquivo | Por quê | Funcionalidades |
|---|---|---|
| `server/cpp/server_guest_lib/ActionListener.cpp` | cinco pontos, em funções movimentadas (golpe, equipamento, hospedagem, valores) | `fix-1010`, `weapon-poison`, `dev-attributes` |
| `server/cpp/server_guest_lib/MpActor.cpp` e `MpActor.h` | assinaturas de `GetBaseValues` e `GetMaximumValues`, `SetEquipment`, `OnEquip`, `VisitProperties`, e os métodos e campos do bônus de atributos | `weapon-poison`, `dev-attributes`, `attribute-bonus` |
| `server/gamemode/phase0-basic.js` | lista de módulos do gamemode, que o mantenedor edita | `core-loader` |
| `server/cpp/addon/ScampServer.cpp` | construtor do addon, perto da montagem das fórmulas de dano | `weapon-poison`, `damage-shadow` |
| `server/cpp/addon/property_bindings/PropertyBindingFactory.cpp` | lista de propriedades | `weapon-poison`, `dev-attributes`, `attribute-bonus` |
| cliente: `client/src/services/services/remoteServer.ts` | arquivo central do cliente; 49 linhas no resumo do diff | entrega de perks |

Para o cliente, a intenção de cada mudança está em [`client/LEIA-ME.md`](client/LEIA-ME.md), seção "Entrega e confirmação".

### Se a identidade ou o login mudaram no oficial

O Core depende de `mp.aetheriusOfficialIdentity` com `session(actorId)` e `isCurrent(...)`, e de `mp.get(actorId, 'profileId')`. Se o mantenedor mudou essa API depois de `340449f`, o Core deixa de vincular personagens: nada é concedido e nada é gravado, sem erro de boot. Confira com um personagem em `canary` antes de qualquer outra coisa.

---

## 8. Integração da tela (AetheriusUI Core)

Regra: **a tela é projeção mais intenção.** Ela mostra o estado que o servidor publica e envia o que o jogador quer fazer; nunca envia valor final (atributo, nível, perk concedido, dano). O servidor valida, grava e republica.

Nesta entrega não há tela nem comando de jogador para nenhum sistema: pedra é escolhida ativando a pedra no mundo; classe é definida por staff (seção 4.5).

**O contrato dos pontos de atributo** está em [`docs/classes/ATRIBUTOS_C3d.md`](../docs/classes/ATRIBUTOS_C3d.md). Resumo:

- A tela **lê** com `core.attributeState(binding)`: classe, nível e origem do nível, pontos ganhos, gastos por atributo, disponíveis, revisão, se a distribuição é aplicável, o máximo esperado, o máximo dos records e o que o host informa.
- A tela **envia** `core.allocateAttributes({ binding, requestId, health, magicka, stamina })`. Os três valores são acréscimos: inteiros não negativos, múltiplos de 5, soma positiva. A tela nunca envia nível, saldo nem máximo.
- O adaptador do servidor obtém o vínculo autenticado atual; não aceita um vínculo escolhido pelo cliente.
- Repetir o mesmo pedido depois de perder a resposta: mesmo `requestId`. Mudou os valores: outro `requestId`.
- Pedido aceito e gravado não certifica que o jogo já mostra o máximo novo: a resposta separa o que foi gravado do que foi projetado no host.
- Os motivos de recusa e o que a tela faz com cada um estão na tabela do contrato.
- **O transporte entre a tela e o servidor não existe ainda**: será integrado depois e não muda o protocolo de perks. O roteiro de homologação no oficial está no fim do contrato.

Os documentos em `docs\ui-integration\` e a pasta `integrations\ui-runtime-changes\` são de um trabalho anterior de interface (04/10/2026), sobre outras bases dos repositórios (`a89b2e6` do servidor e `8d1dd4e` do cliente). **Não aplique os patches de `ui-runtime-changes\` junto com os deste guia**: as bases são diferentes, e a compatibilidade entre os dois conjuntos não foi verificada.

---

## 9. Limitações e achados conhecidos

Tirados do `RETOMADA.md` (12/10/2026) e dos registros em `_work\evidence\H\`.

### Dos sistemas

- **Efeito dos perks só por amostra.** A confirmação de entrega prova que o perk está no personagem, não que o efeito funciona. Foram medidos perks de duas classes (seção 2). Perks de dano, de veneno e de golpe não foram testados; os de dano dependem da fórmula de dano, adiada.
- **Regeneração de vigor abaixo do record.** Os perks Agility e Stimulants ficaram ativos, com valor medido abaixo do que o record indica. Segue sem explicação. O corte de regeneração de vigor que o pacote do host acrescenta só atua com os máximos de teste ligados, e eles estavam desligados nessas sessões (parecer da C3d). O perk Disciplined Fighter reduziu o custo mais do que o record prevê (×0,66 medido contra ×0,75), sem explicação.
- **Nove perks concedidos antes do pré-requisito nativo.** Em nove casos a classe dá um perk num marco e só dá o pré-requisito nativo dele num marco posterior (tabela no relatório da ordem C3c). Só o jogo diz se o motor aceita o perk nesse intervalo; não foi verificado.
- **54 perks com pré-requisito que a classe não concede.** São concedidos assim mesmo e estão marcados em `docs/classes/PERKS_POR_CLASSE.md`. O Core não avalia as condições nativas de aquisição e não completa ranks nem pré-requisitos sozinho.
- **Sem fonte de XP,** todo personagem fica no nível 1 de classe (seção 2).
- **Pontos de atributo não validados em jogo** (seção 2). A entrega de perks foi alterada depois da validação das 18:33 e revalidada em jogo às 23:02; o efeito dos perks continua medido só por amostra.
- **Não há como retirar os perks de classe de um personagem por revogação** (seção 10): o domínio não tem comando que remova a escolha de classe.
- **As ferramentas de staff são offline quanto à entrega** (seção 4.5): gravam no banco e o jogador online só recebe na próxima entrada.
- **Limite diário de XP na troca de classe:** a troca preserva o limite diário, que fica com o valor do nível antigo até o ciclo diário seguinte (parecer da C3d).
- **Um personagem só pode ter, no host, bônus de até 585 pontos no total**, o ganho do nível 40; acima disso a propriedade recusa (`ATTRIBUTE_POINTS_INVALID`).
- **Pedra do Corcel:** o bônus de corrida não é suportado; o record não liga esse bônus à pedra (está em `unsupported` no catálogo).
- **Feitiço ou perk que o personagem já tinha por outro motivo nunca é removido** pelo Core. Efeito colateral declarado: se o servidor cair entre aplicar um feitiço e gravar o registro, o feitiço fica no personagem sem autoria e uma revogação posterior não o remove (parecer da ordem B5a).
- **Desligar não apaga.** Perks já aplicados continuam no save do jogador e as tabelas `gc_` ficam (seção 10).
- **Remoção de perk no cliente:** o jogo só mostra a ausência de um perk removido algumas atualizações depois da chamada. O cliente confere até três vezes ou 500 ms; se o perk continuar presente, relata falha e a remoção fica pendente no servidor.

### Do jogo e do host, sem causa determinada

- **O jogo fecha sozinho, sem relatório.** Erro `0xc0000409` em `ucrtbase.dll+0x71208`, sete ocorrências entre 10/10 e 12/10/2026, com versões diferentes do cliente: três em 10/10 e quatro em 12/10 (15:12:56 ao dar alt-tab, 17:10:56, 17:19:10 e 18:34:42, esta ao abrir o menu de feitiços). Relação com os perks concedidos: **não demonstrada nem descartada**. A investigação depende dos despejos de memória do Windows; os comandos para habilitá-los foram entregues ao dono do projeto em 12/10 e nenhum despejo tinha sido analisado até esta data.
- **Golpes em alvos que o servidor não conhece:** `ActionListener::OnHit - MpObjectReference not found`. Defeito do host, anterior a este trabalho.
- **Queda do servidor com NPC hospedado:** corrigida no pacote do host (`fix-1010`); o defeito existe no código da base. O relato para o mantenedor está em `_work\evidence\FIX-1010\DEFEITO-HOST-lastMovUpdateByIdx.md`.
- **Entrada no mundo que trava:** o cliente enviou `begin` e nunca `ready`, uma vez, em 12/10 às 15:42; não se repetiu nas entradas seguintes.
- **Queda ao carregar o save** (10/10, 12:48) e **queda na máquina de scripts Papyrus** (10/10, 10:52): uma ocorrência cada.
- **Vida 150 de um Nord** vista em 08/10: o host calcula 100; origem não determinada.
- **O cliente reaplica o inventário do servidor a cada 5 segundos** (`remoteServer.ts`); é comportamento do cliente da base, relevante para quem for mexer em equipamento.
- **Serviço de sobrevivência do gamemode** (fome e sede): com fome ou sede em zero ele drena vida, magia e vigor. Não é do Core; apareceu nos testes porque muda as barras.

### Desta entrega

- A conferência prévia do catálogo (`verify.ts`) falhava no domínio de classes e foi corrigida nesta entrega (seção 4.3).
- O `.gitattributes` do Core passou a proteger os patches e os arquivos espelhados de `integrations\host\` e `integrations\client\` contra conversão de fim de linha (`_work\evidence\DOC-1\12-gitattributes-check-attr.txt`). A proteção vale a partir do commit que a incluir; confira o SHA-256 do patch antes de aplicar.
- **Mudança de comportamento do host para ator sem aparência**, lida no diff e não medida (seção 4.1).
- A correção do revisor no ensaio de atributos (`runtime/harness/attribute-allocation.mjs`) e a correção `fix-1010` aguardam revisão independente (pareceres da C3d e da FIX-1010).

### Onde este guia diverge do documento de ativação

Em 12/10/2026 o `ATIVACAO_DOS_SISTEMAS.md` recebeu notas de supersessão (o texto antigo foi mantido) nestes pontos, que antes divergiam deste guia: o caminho do guia de instalação; os "seis rótulos não resolvidos" do catálogo de classes; o exemplo de boot com `classes: UNSUPPORTED`; as pendências do revisor da C3d, já cumpridas; a orientação de "revogar classes" para remover perks, que não é executável; e, na seção 9, a revalidação em jogo das 23:02 e a retirada da varredura do ambiente local.

Continuam divergentes, e **vale o que este guia diz**:

| Ativação diz | O que foi conferido |
|---|---|
| seção 5: pedras precisam dos plugins `Skyrim.esm` e `Mundus.esp`; raças, de `Skyrim.esm`, `Aetherius.esp` e `AETHERIUS - BALANCE.esp` | os catálogos conferem também `Update.esm` (pedras e raças) e `unofficial skyrim special edition patch.esp` (pedras). Lista completa na seção 3 |
| seção 3: "o primeiro `status` mostra o que já está aplicado" | o `status` só passa com tudo aplicado; antes disso falha (seção 4.2) |
| seção 2: a tabela lista a 0008 depois das outras, como "(runtime)" | a ordem de aplicação é por número, 0001 a 0009 (seção 4.2) |

---

## 10. Como desligar e como desfazer

| Passo | Desligar | Desfazer |
|---|---|---|
| Um sistema | pôr `GAMEPLAY_CORE_MODE_<SISTEMA>=off` e reiniciar o servidor ou recarregar o gamemode. A pedra guardiã volta ao comportamento nativo; as raças deixam de ser observadas | nada a desfazer: as tabelas ficam e o sistema retoma de onde parou ao ser religado |
| Entrega de perks | `GAMEPLAY_CORE_CLIENT_PERKS_MODE=off` | desligar **conserva** os perks já aplicados no save do jogador e a autoria no banco. **Esta entrega não tem procedimento para retirar os perks de classe de um personagem por revogação:** o domínio só oferece `classes.set` para uma classe do catálogo (`modules/class-progression-system/src/index.ts`) e não existe comando que remova a escolha de classe. Não apague linhas de `gc_perk_projections` e não remova perks em massa. Se a retirada total for exigida, trate como bloqueio: precisa de uma ordem de trabalho própria |
| Pontos de atributo | não têm opção própria: seguem o modo das classes. Com as classes em `off`, o bônus deixa de ser entregue; ele vive só na memória do host e some quando o personagem sai ou o servidor reinicia | ponto gasto **não volta**. O único caminho que apaga a distribuição é a troca de classe, que também zera nível e XP. Não apague linhas de `gc_attribute_allocation` à mão |
| O Core inteiro | `ENABLE_GAMEPLAY_CORE=false` e reiniciar | o gamemode volta a se comportar como antes do Core |
| Migrations | — | **não há migration de remoção, de propósito.** As tabelas `gc_` não interferem em nada quando o Core está desligado. Se for preciso removê-las, é decisão e operação manual do responsável pelo banco, com backup; restaurar o backup anterior à aplicação também desfaz |
| Pacote do host | manter as opções desligadas (o [`host/LEIA-ME.md`](host/LEIA-ME.md), seção 6, lista cada uma) | `git apply -R "<Core>\integrations\host\changes.patch"` no clone e recompilar; ou voltar ao binário anterior, que você guardou antes de trocar |
| Pacote do cliente | o cliente novo fica passivo com o modo de perks em `off` | repor o bundle anterior do cliente, com o jogo fechado; `git apply -R` do patch no clone |
| Bundle do Core | — | apontar `GAMEPLAY_CORE_BUNDLE` para o bundle anterior e reiniciar |
| Feitiços de pedra já aplicados | continuam no personagem depois de desligar | quem os remove é o próprio sistema, numa troca de pedra |

Se o Core ou o banco falharem com um sistema ligado, o servidor do jogo continua no ar; o sistema afetado fica indisponível e diz por quê no log.

Guarde, antes de cada troca: o backup do banco, o binário do servidor (`scam_native.node`), o bundle do cliente e o `.env` do gamemode.

---

## 11. Onde está cada coisa

| Caminho no Core | Conteúdo |
|---|---|
| `integrations/INSTALL.md` | este guia |
| `integrations/host/` | pacote do servidor: `changes.patch`, `files/`, `manifest.json`, `LEIA-ME.md`, e o gerador (`make-package.mjs`, `features.json`) |
| `integrations/client/` | pacote do cliente: `B5b-aa864cb.patch`, `LEIA-ME.md`; `suspenso/` com o patch de veneno, que não se instala |
| `integrations/ui-runtime-changes/` | trabalho anterior de interface, sobre outras bases; não faz parte desta instalação |
| `docs/operations/ATIVACAO_DOS_SISTEMAS.md` | banco, opções, comportamento de cada sistema, como conferir e desligar |
| `docs/classes/PERKS_POR_CLASSE.md` | perks de cada classe por marco |
| `docs/classes/ATRIBUTOS_C3d.md` | contrato dos pontos de atributo para a tela e roteiro de homologação |
| `docs/architecture/adr/` | decisões de arquitetura D1 a D8 (D8: mudanças no host viajam como pacote dentro do Core) |
| `catalog/` | os três catálogos assinados (`standing-stones.json`, `races.json`, `classes.json`) e o `README.md` |
| `tools/catalog/` | gerador e verificador do catálogo, tabela de perks por classe |
| `database/migrations/` | migrations em SQL (0001 a 0007 e 0009; a 0008 é definida em `runtime/src/projection/migration.ts`) |
| `runtime/` | o runtime: `src/` (código), `build.mjs` (gera o bundle), `migrations.mjs` (aplica e mostra migrations), `explain-character.mjs` (explicação por personagem), `set-character-class.mjs` (define a classe), `allocate-attributes.mjs` (distribui pontos de atributo), `harness/` (ensaios com o servidor compilado, só para desenvolvimento) |
| `runtime/src/development.ts` | a lista das opções de desenvolvimento e a trava |
| `modules/standing-stone-system/`, `modules/race-system/`, `modules/class-progression-system/`, `modules/leveling-system/` | regras de cada sistema |
| `modules/race-system/ownership.json` | quem responde por cada efeito racial |
| `shared/` | catálogo de records, persistência, contratos |
| `dist/aetherius-gameplay-core.cjs` | o bundle; gerado, ignorado pelo git |

No workspace de desenvolvimento, fora deste repositório: `RETOMADA.md` (estado do trabalho), `_work\STATE.json` (fases e gates), `_work\orders\` e `_work\reviews\` (ordens e pareceres), `_work\evidence\` (saídas de comandos e sessões em jogo).
