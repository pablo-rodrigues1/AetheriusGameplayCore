# Persistência do Core — B3

Fundação PostgreSQL para comandos duráveis. A ordem B3 aprovada supersede a menção
a outbox na Fase B do plano: **outbox/inbox ficam para um slice que precisar**.
Aqui existem somente `gc_schema_migrations` e `gc_commands`. Nenhuma tabela de
domínio, grant, inventário ou efeito é criada nesta entrega.

## Dependências e comandos

O código TypeScript usa apenas bibliotecas do Node e os tipos de `shared/contracts`.
Não importa `pg`, não instancia pool e não instala dependências. Os scripts usam o
TypeScript 5.9.3 e `@types/node` já instalados em `runtime/node_modules`, somente para
leitura. Node utilizado nesta entrega: 22.14.0; PostgreSQL local: 18.

Na raiz do workspace:

```powershell
npm run typecheck --prefix AetheriusGameplayCore/shared/persistence
npm test --prefix AetheriusGameplayCore/shared/persistence
```

O segundo comando exige `AETHERIUS_TEST_DATABASE_URL`, carregada **somente** da linha
com esse nome em `_work/db.env`, sem imprimir a URL. O teste aceita apenas o banco
local `aetherius_test`, usa o `pg` instalado no gamemode compilado
(`aetherius-server/build/dist/server/gamemode/node_modules/pg`), cria um único pool
no papel do gamemode, e cria/remove um schema `gc_b3_*` exclusivo por execução.
Não toca nas tabelas existentes nem no servidor de jogo. Os arquivos de build e
as cópias de migrations usadas nos testes ficam em `build/`, ignorado pelo Git.

## API e garantias

| Função | Garantia | Responsabilidade do chamador / limite |
|---|---|---|
| `poolFromGamemode(pg)` | Devolve exatamente `pg.init()` | Gamemode cria e encerra seu único pool |
| `withTransaction(pool, fn)` | Conexão dedicada, `BEGIN`, isolamento READ COMMITTED, commit após `fn`, rollback em erro, release sempre | Callback aguarda todas as queries; não publica efeito fora do banco antes de commit |
| `lockCharacter(tx, key)` | Advisory lock de transação por `profile:<profile_id>` | Somente dentro de `withTransaction`; todos os writers do fato precisam usar a mesma trava |
| `executeCommand(pool, envelope, effect)` | Efeito e ledger na mesma transação, repetição retorna resultado salvo, conteúdo diferente retorna `conflict` | Identidade autenticada, epoch, permissão, revisão atual e semântica são validados pelo domínio/runtime |
| `readMigrations(dir)` | Lê o conteúdo UTF-8 dos arquivos `.sql` | Usar diretório de migrations entregue junto com o Core; faz I/O de arquivo |
| `applyMigrations(pool, files, schema)` | Valida todo o lote antes de SQL; aplica atomicamente, ordenado e serializado por schema, com SHA-256 | Schema precisa existir; papel precisa ter permissão de DDL nele |
| `migrationStatus(pool, files, schema)` | Retorna versões/hashes/datas e falha se não coincidirem com os arquivos | Conferência de ledger, não auditoria completa de drift das tabelas |
| `canonicalJson(value)` | JSON determinístico com objetos ordenados e arrays preservados | Só dados JSON finitos, objetos simples e sem getters/ciclos; não normaliza texto Unicode |

**Esta camada faz I/O de banco; jamais chamá-la no caminho de hit ou tick de efeito.**
Carregar migrations também faz I/O de arquivo. Não há timers, retries automáticos,
projeção ao cliente ou integração ao bundle. `withTransaction` fornece um executor
de consultas, sem `release`, `connect` ou controle de transação. Aceita uma query
sem `;` por chamada; comentários iniciais não permitem contornar o bloqueio de
`COMMIT`, `ROLLBACK` e outros controles. O executor expira antes do commit.

Se o callback engolir um erro SQL, o helper detecta `COMMIT` respondido como
`ROLLBACK`, evitando retornar sucesso de uma transação abortada. Falha ao obter
conexão/iniciar transação dá `DATABASE_UNAVAILABLE`. Falha na confirmação do commit
dá `COMMIT_UNCONFIRMED` e descarta a conexão: **o efeito pode já estar gravado**.
O chamador repete o mesmo `requestId` e conteúdo para descobrir o resultado salvo.
Nenhuma dessas falhas produz receipt `accepted`.

`accepted` em `CommandReceipt<T>` significa que a transação foi confirmada, não
que o efeito foi entregue ao cliente. O campo `result` contém o resultado JSON do
domínio, podendo ser o `CommandResult` dos contratos. A receipt é um retorno interno
de persistência, não um novo contrato de rede. O domínio continua responsável por
montar respostas e por não gravar mutação quando sua decisão for rejeitar o comando.
Não use `pending` como resultado final de uma execução durável nesta fundação.

## Identidade e idempotência

`PersistenceCommand` reutiliza os campos de `CommandEnvelope` dos contratos e
`JsonValue`, já readonly. Isso evita a expansão infinita de
`DeepReadonly<JsonValue>` no TypeScript 5.9, sem alterar contratos. Chaves devem ser
`profile:` seguido de um inteiro positivo seguro, sem zeros iniciais.

`requestId` é global no ledger. A ordem das travas é sempre request e depois
personagem. O hash canônico inclui `characterKey`, `type`, `payload` e, quando
presente, `expectedRevision`. Não inclui `requestId` (já é a chave do ledger) nem
`epoch` (evidência de sessão, que muda numa reconexão). Payload diferente, outro tipo,
outro personagem ou outra pré-condição de revisão dão `REQUEST_ID_REUSED`.
O envelope é copiado/congelado antes do primeiro await, e o resultado é copiado a
partir do mesmo JSON que vai ao banco, para evitar diferença entre execução e replay.

O runtime deve validar a sessão antes da chamada e o domínio deve revalidá-la no
callback se uma espera por trava puder invalidá-la. A camada não aceita relato do
cliente como identidade autenticada e não consulta cadastros externos ao Core.

Travas de personagem usam exatamente o negativo do profile_id como bigint, sem
colisão de hash entre personagens. Travas de request e migrations usam o hash do
nome com prefixo `gc:` na metade não negativa do espaço de advisory locks. Colisão
desse hash de 63 bits pode serializar requests diferentes, mas nunca faz o ledger
confundir conteúdo ou executar o mesmo request duas vezes. O PostgreSQL libera
as travas no commit/rollback/desconexão, evitando a trava de sessão do spike e o
risco de devolvê-la ainda presa ao pool. Não há garantia de ordem FIFO: a sequência
efetiva é a aquisição da trava, não a ordem dos pacotes na rede.

Não remova linhas de `gc_commands` enquanto o respectivo `requestId` puder ser
repetido. Não há retenção automática, segundo ledger ou fallback em memória.

## Política das migrations

Arquivos `NNNN_gc_nome.sql`, com número único, ordenados numericamente.
`0001_gc_schema_migrations.sql` é o bootstrap fixo; somente o runner mantém seu
ledger. Hash SHA-256 é calculado sobre o conteúdo UTF-8 completo, incluindo
comentários e quebras de linha. Depois de aplicado, **não editar nem remover**
arquivo: acrescentar uma nova migration. Histórico com arquivo ausente, hash
diferente ou versão inserida antes de uma já aplicada é recusado.

O runner aceita somente este subconjunto aditivo, recomposto dos tokens validados:

- `CREATE TABLE gc_nome (...)`, colunas, `NOT NULL`, `PRIMARY KEY`, `UNIQUE` e
  `REFERENCES gc_nome (colunas)`; constraints nomeadas também precisam de `gc_`;
- tipos embutidos `text`, `jsonb`, `integer`, `bigint`, `smallint`, `boolean`,
  `timestamptz`, `uuid`, `numeric[(precisão[,escala])]`, `varchar[(tamanho)]`;
- `DEFAULT CURRENT_TIMESTAMP`, `NULL`, booleanos ou inteiro não negativo;
- `CREATE [UNIQUE] INDEX gc_nome ON gc_tabela (colunas)`;
- comentários de linha/bloco, inclusive blocos aninhados, e separador `;`.

Não aceita nomes qualificados ou entre aspas, expressões, funções arbitrárias,
`LIKE`, `AS SELECT`, `CHECK`, `ALTER`, DML, `DROP`, `DO`, triggers, extensões ou
controle de transação. Assim referências indiretas a tabelas externas também são
recusadas. SQL fora desse subconjunto precisa de ampliação explícita da política
e de seus testes em outra ordem. O schema de destino é informado separadamente
(padrão `public`), não é criado nem removido pelo runner. Nenhuma migration desta
entrega altera/apaga tabela existente: nomes já ocupados causam falha e rollback.

## Aplicação em banco existente pelo dev do servidor final

Usar a configuração segura de ambiente do gamemode (`GAME_DATABASE_URL` ou
`DATABASE_URL`), nunca URL em argumentos/logs. Os comandos abaixo são instruções
de entrega; o agente B3 executa banco apenas no `aetherius_test` local.

Na raiz do workspace, com dependências do runtime e gamemode já instaladas:

```powershell
npm run build --prefix AetheriusGameplayCore/shared/persistence
node AetheriusGameplayCore/shared/persistence/migrate.mjs apply aetherius-server/server/gamemode/core/pg.js
node AetheriusGameplayCore/shared/persistence/migrate.mjs status aetherius-server/server/gamemode/core/pg.js
```

No servidor compilado, substituir o último argumento pelo caminho do módulo
instalado (`aetherius-server/build/dist/server/gamemode/core/pg.js` neste workspace).
Pode-se acrescentar um schema existente como argumento final. A CLI é um processo
de manutenção separado, recebe o módulo do gamemode e usa/encerra o pool que ele
cria, sem iniciar ou parar o servidor. Não chamar essa CLI dentro do processo de
jogo; nele se usam diretamente as funções exportadas e não se fecha o pool.

`apply` retorna os arquivos aplicados e a contagem dos anteriores. `status` compara
os arquivos entregues com o ledger e retorna versão, hash e data. Nesta fundação
são duas linhas. Aplicação repetida retorna `applied: []`, `unchanged: 2`.
Também é possível conferir no schema escolhido:

```sql
SELECT version, sha256, applied_at FROM gc_schema_migrations ORDER BY version;
```

Reversão: desativar a feature no runtime e preservar as tabelas e o ledger. Não há
migration de down que apague fatos. Esta camada não fornece backup nem resolve
drift manual; uma recuperação de banco deve preservar fatos e ledger juntos.

## Uso pelo slice C1

C1 adiciona uma migration `NNNN_gc_standing_stone_choice.sql` para sua tabela de
escolha e executa `executeCommand(poolFromGamemode(pg), envelope, callback)`. O
callback valida sessão/record/revisão, usa `tx.query` com parâmetros para o upsert
de `gc_standing_stone_choice` por `character_key`, e devolve o resultado durável.
Usa StableFormKey do catálogo, nunca FormID de runtime. A trava e o ledger já são
fornecidos por B3. Só após a promise resolver se solicita recomposição ao ActorState
e projeção pelo port; replay não executa novamente o callback. Recuperação de
projeção a partir do fato confirmado pertence a C1/B5. Commit não é entrega, e a
janela entre commit e projeção não é resolvida por outbox nesta ordem.
