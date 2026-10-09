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

A identidade do personagem em todas as tabelas é `profile:<profile_id>`, com o `profile_id` da plataforma. Nenhuma tabela guarda FormID de runtime nem posição de plugin.

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

| Opção | Por que não |
|---|---|
| `GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV=true` | faz o servidor aplicar migrations sozinho no boot. No oficial as migrations são aplicadas à mão, com backup |
| `GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY=true` | faz o Core aceitar a identidade do jogador com o servidor em `offlineMode`, isto é, sem login validado. O servidor local de teste roda assim; o oficial não. Sem esta opção e com `offlineMode` ligado, os sistemas não agem para ninguém |
| `ENABLE_STANDING_STONE_SPIKE=true` | liga o protótipo antigo das pedras, com tabelas próprias (`spike_*`). Nunca junto com `GAMEPLAY_CORE_MODE_STANDING_STONES` em `canary` ou `active`: o sistema novo recusa iniciar. No oficial o protótipo nunca foi usado; deixe ausente ou `false` |
| `GAMEPLAY_CORE_DEV_CLASS_LEVEL=<1..40>` | **ATENÇÃO: nunca no servidor oficial.** Implementado em C3a; usar `40` no teste local compõe os perks de todos os marcos desde a criação. Não grava nível nem XP. Removida a opção, a leitura retorna ao Leveling (nível 1 se ainda não houver progresso). Só é aceita se `offlineMode` for exatamente `true`; com ele desligado, ausente, valor inválido, vazio ou fora de 1–40, registra **ERROR**, marca classes `UNSUPPORTED` e não inicia o sistema, sem usar o nível real em silêncio. Quando aceita, registra **DEV** a cada boot e mostra origem `DEV` na capacidade e na explicação. C3a apenas compõe esses perks: **nenhum é entregue ao cliente antes de B5b** |

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

- `GAMEPLAY_CORE_DEV_CLASS_LEVEL` (daria nível 40 a todos os personagens);
- `GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY`;
- `GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV`;
- `ENABLE_STANDING_STONE_SPIKE`.

E `offlineMode` tem de estar desligado nas configurações do servidor. No log de boot não pode aparecer nenhum aviso do Core com a palavra `DEV`.

## 7. Como conferir

- **No boot**, o log deve ter `[gameplay-core] bundle <versão>; initialized; active instances=1`. Sistemas que não podem subir aparecem com o motivo, por exemplo `[gameplay-core] classes: UNSUPPORTED; Catalog domain classes not delivered` (esperado para os sistemas ainda não entregues). Migration faltando aparece com o comando a rodar.
- **Raças:** a cada personagem observado, `[races] active: profile:<id> SUPPORTED <raça>`.
- **No banco:** `SELECT version, applied_at FROM gc_schema_migrations ORDER BY version;` e, por personagem, `gc_standing_stone_choice`, `gc_race_observation`, `gc_commands`.
- **Por personagem, com o servidor ligado ou parado:**

  ```powershell
  node runtime/explain-character.mjs "<caminho absoluto>\gamemode\core\pg.js" profile:<profile_id>
  ```

  Só lê. Mostra pedra, raça, classe, nível, origem do nível, marcos e cada concessão com suas origens. Sem as migrations C3a, declara classes não suportadas e preserva a explicação de pedras e raças. Com `GAMEPLAY_CORE_DEV_CLASS_LEVEL`, exige um quarto argumento, caminho do `server-settings.json` com `offlineMode:true`, e registra `DEV`. Sem prova de offline recusa a opção.

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
| 08/10/2026 | classes C3a (entrega para revisão) | 0006/0007 exercitadas somente em schemas isolados de `aetherius_test`; **não aplicadas em `aetherius_dev` pelo executor** | nenhuma configuração local alterada. Para teste pelo revisor: aplicar migrations, `GAMEPLAY_CORE_MODE_CLASSES=active`, `GAMEPLAY_CORE_DEV_CLASS_LEVEL=40`, `offlineMode:true` e opt-in de identidade offline; remover DEV e desligar classes desfaz a ativação sem apagar fatos |

O que difere no servidor oficial: sem adoção, sem `GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY`, sem a opção do protótipo, e com a passagem por `audit` e `canary` antes de `active`.

Cada sistema novo acrescenta uma linha a esta tabela e uma subseção à seção 5.
