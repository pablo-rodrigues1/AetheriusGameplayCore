# Ativação dos sistemas do GameplayCore num servidor

Para quem vai ligar os sistemas do Core no servidor oficial. Atualizado em 08/10/2026.

Cada sistema do Core (pedras guardiãs, raças, e os que vierem) precisa de duas coisas no servidor onde roda: **tabelas próprias no PostgreSQL** e **uma opção de configuração que o liga**. No ambiente de desenvolvimento local esses dois passos foram feitos à mão a cada sistema. Este documento descreve o que foi feito, para ser repetido no servidor oficial com as diferenças necessárias.

Este documento não cobre a instalação do pacote (compilar o Core, compilar o servidor, registrar o Core no gamemode). Isso é assunto do guia de instalação, ainda a escrever (`integrations/host/INSTALL.md`). Aqui presume-se o Core já instalado e carregando.

## 1. O que o Core faz e não faz no banco

- Usa o PostgreSQL que o gamemode já usa, pelo mesmo pool (`server/gamemode/core/pg.js`). A conexão vem de `GAME_DATABASE_URL` ou, se ausente, de `DATABASE_URL`. O Core não cria conexão própria.
- Cria e usa **somente** tabelas com prefixo `gc_`. Não lê, não altera e não apaga nenhuma tabela existente (`users`, `sessions`, tabelas do painel, do gamemode ou dos serviços legados). O executor de migrations recusa qualquer arquivo que toque tabela sem o prefixo.
- As migrations são só aditivas: criam tabela e índice. Nenhuma altera ou remove coisa existente.

## 2. Tabelas, por migration

Arquivos em `database/migrations/`, aplicados em ordem.

| Migration | Tabelas | Para quê | Quem precisa |
|---|---|---|---|
| `0001_gc_schema_migrations.sql` | `gc_schema_migrations` | controle: quais migrations foram aplicadas e a assinatura de cada arquivo | todos |
| `0002_gc_commands.sql` | `gc_commands` | registro de comandos, para que uma ação repetida não tenha efeito em dobro | todos |
| `0003_gc_spell_projection.sql` | `gc_spell_projection_heads`, `gc_spell_projections` | o que o Core já aplicou de feitiços em cada personagem, para enviar só a diferença e nunca remover o que não concedeu | pedras guardiãs e qualquer sistema que conceda feitiço |
| `0004_gc_standing_stone_choice.sql` | `gc_standing_stone_choice` | a pedra guardiã escolhida por personagem | pedras guardiãs |
| `0005_gc_race_observation.sql` | `gc_race_observation` | a raça que o servidor observou em cada personagem | raças |
| `0006_gc_character_class.sql` | `gc_character_class` | classe escolhida e revisão por personagem; não altera XP | classes |
| `0007_gc_leveling_progress.sql` | `gc_leveling_progress` | XP total, nível e estado de fadiga do único writer Leveling | adaptador Leveling e leitura de nível pelas classes |

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

### Só desenvolvimento: **não usar no servidor oficial**

Todas as opções abaixo usam a mesma trava: `NODE_ENV=local` explicitamente, `GAME_ACCESS_CONTROL` diferente de `true` e `GAMEPLAY_CORE_ALLOW_DEV_OPTIONS=true`. Ausência de `NODE_ENV` nunca conta como local, mesmo que `server-options.js` escolha o arquivo local por padrão. `production` e `staging` recusam as opções. O ambiente vem de `env: process.env` no descriptor do gamemode, depois de carregar seu `.env`; `GAME_ACCESS_CONTROL` é a mesma variável lida pelo AccessControl do host.

Fora dessa combinação, **a presença da opção, inclusive vazia ou `false`, é recusada com `ERROR`, nome e motivo no log**. Remova a opção para retomar o comportamento normal. A confirmação `GAMEPLAY_CORE_ALLOW_DEV_OPTIONS` não liga nenhum sistema por si só e também deve estar ausente no oficial.

| Opção | Por que não |
|---|---|
| `GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV=true` | aplica migrations no boot somente com a trava local acima. Se recusada, não adquire o pool nem aplica migrations e deixa indisponíveis os sistemas dependentes do banco. No oficial as migrations são aplicadas à mão, com backup |
| `GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY=true` | aceita perfil sem autenticação somente em host antigo, sem `aetheriusOfficialIdentity`, com a trava local acima. Recusa bloqueia vínculos nesse host antigo, sem retornar silenciosamente à identidade normal. No host atual sempre exige sessão oficial; esta opção não contorna o login |
| `ENABLE_STANDING_STONE_SPIKE=true` | liga o protótipo antigo (`spike_*`) somente com a trava local acima. Recusada, não inicia o spike; os sistemas atuais independentes seguem. Nunca junto com pedras em `canary`/`active`: o sistema novo recusa iniciar. No oficial deixe ausente |
| `GAMEPLAY_CORE_DEV_CLASS_LEVEL=<1..40>` | **Nunca no servidor oficial.** Com a trava local acima, `40` compõe todos os marcos sem gravar nível ou XP. Recusada, vazia, inválida ou fora de 1–40: **ERROR**, classes `UNSUPPORTED`, sem iniciar nem usar nível real em silêncio. Removida a opção, volta ao Leveling. Quando aceita, registra **DEV** e mostra essa origem na capacidade e explicação. **Nenhum perk é entregue antes de B5b** |

**Supersessão B1-fix1 (08/10/2026):** a trava anterior de C3a baseada em `offlineMode` e a premissa de B1 de que o oficial não roda offline estão substituídas por esta seção. O critério é exclusivamente o ambiente explícito acima.

A ferramenta `runtime/adopt-standing-stone.mjs` também é só de desenvolvimento: ela transferiu para o sistema novo a pedra de um personagem de teste que vinha do protótipo. O servidor oficial não tem dados do protótipo e não precisa dela.

## 5. O que cada sistema faz quando ligado

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
- **Entrega de perks: `UNSUPPORTED`, aguarda B5b.** Nenhum perk, skill ou atributo é aplicado ao jogador. O port de feitiços mantém a recusa de perks. Raças e pedras continuam funcionando. A explicação mostra a origem `CLASS`, rank e a falta de entrega.
- No oficial com sessão autenticada, `offlineMode=true` permite pedras, raças e classes normalmente. Se `GAMEPLAY_CORE_DEV_CLASS_LEVEL=40` ficar por engano em produção, só classes ficam indisponíveis, com erro explícito; pedras e raças continuam para o jogador autenticado.
- Rank representa posição na cadeia `NextPerk`, não o `NumRanks` de cada record. A concessão automática segue os marcos de classes; condições nativas de aquisição são evidência e não são avaliadas pelo sistema. Não há complemento automático de ranks/pré-requisitos. Os seis rótulos não resolvidos permanecem no catálogo como `UNSUPPORTED`.
- Fora de C3a: interface, custo/restrições de troca (incluindo Winterhold), skills, pontos/alocação de atributos, feitiços de classe e entrega B5b. O módulo legado permanece intocado e não é ligado pelo runtime novo.

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

- **No boot**, o log deve ter `[gameplay-core] bundle <versão>; initialized; active instances=1`. Sistemas que não podem subir aparecem com o motivo, por exemplo `[gameplay-core] classes: UNSUPPORTED; Catalog domain classes not delivered` (esperado para os sistemas ainda não entregues). Migration faltando aparece com o comando a rodar.
- **Raças:** a cada personagem observado, `[races] active: profile:<id> SUPPORTED <raça>`.
- **No banco:** `SELECT version, applied_at FROM gc_schema_migrations ORDER BY version;` e, por personagem, `gc_standing_stone_choice`, `gc_race_observation`, `gc_commands`.
- **Por personagem, com o servidor ligado ou parado:**

  ```powershell
  node runtime/explain-character.mjs "<caminho absoluto>\gamemode\core\pg.js" profile:<profile_id>
  ```

  Só lê. Mostra pedra, raça, classe, nível, origem do nível, marcos e concessões. Sem as migrations C3a, declara classes não suportadas e preserva pedras e raças. Com `GAMEPLAY_CORE_DEV_CLASS_LEVEL`, exige a mesma trava de ambiente da seção 4 e registra `DEV`. B1-fix1 substitui a prova anterior por `server-settings.json`: esse argumento não autoriza opções de desenvolvimento.

## 8. Como desligar ou voltar atrás

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
| 08/10/2026 | classes (C3a) | migrations 0006 e 0007; classe do personagem de teste definida como `viper` pela ferramenta `runtime/set-character-class.mjs` | `GAMEPLAY_CORE_MODE_CLASSES=active` e, **só neste ambiente de teste**, `GAMEPLAY_CORE_DEV_CLASS_LEVEL=40` |

As linhas acima registram a configuração histórica anterior à B1-fix1; não comprovam ativação com a trava nova. **Para o revisor manter o teste local:** definir `NODE_ENV=local` e `GAMEPLAY_CORE_ALLOW_DEV_OPTIONS=true`; deixar `GAME_ACCESS_CONTROL` ausente (ou `false`). `GAMEPLAY_CORE_DEV_CLASS_LEVEL=40` pode permanecer somente nesse teste. Com login oficial, remover `GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY`: o host novo exige sessão oficial mesmo quando ela está presente. Para harness com host antigo sem identidade oficial, conservar essa opção com a trava local.

Remover `ENABLE_STANDING_STONE_SPIKE=false` e `GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV=false` do `.env` quando não forem usadas: fora de desenvolvimento até `false` é presença recusada. As migrations existentes continuam aplicadas manualmente. Nenhuma configuração ou tabela do ambiente local foi alterada na entrega B1-fix1; aplicação e boot cabem ao revisor.

O que difere no servidor oficial: `NODE_ENV=production`, sem confirmação/opções de desenvolvimento e sem adoção; nível vem do Leveling. Manter `offlineMode=true`, login por token e passagem por `audit`/`canary` antes de `active`.

Cada sistema novo acrescenta uma linha a esta tabela e uma subseção à seção 5.
