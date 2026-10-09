# C3a: classes no servidor

`src/index.ts` guarda a escolha pelo comando `classes.set` e compõe os perks de
todos os marcos alcançados. Usa `CharacterKey`, `StableFormKey`, a persistência e
o ledger de comandos existentes. Não importa o sistema de classes legado nem
ensina feitiços, altera skills ou aloca atributos.

`CharacterLevelPort` é leitura do progresso durável do Leveling. O adaptador está
em `modules/leveling-system/src/integration/durable.ts`; aceita internamente o
evento `aetherius.enemy.killed.v1`, snapshot de grupo do servidor e o vínculo do
destinatário ao personagem. A matemática vem dos módulos e JSONs existentes.
Nenhuma fonte de abates está conectada. Faltam o dono da confirmação de morte,
a cobertura dos inimigos/contextos e o mapeamento autoritativo de destinatários.

O rank do catálogo é posição na cadeia `NextPerk`, diferente do `NumRanks` de
um record individual. Todos os records de uma cadeia ficam distintos. Não há
inserção automática de ranks anteriores. As condições de aquisição do record
ficam como evidência; C3a concede pelo marco definido pelo dono do projeto e não
implementa um motor de condições ou resultados de perks. B5b deverá definir
como entregar essas cadeias ao cliente. Entrega: `UNSUPPORTED`, aguarda B5b.

O provedor entra na única `ActorComposition`. Classes apenas inspecionam a
composição; o dono de feitiços continua chamando o port existente, que recusa
perks e continua aplicando os feitiços. A explicação lista ambos.

Staff: `node runtime/set-character-class.mjs <pg.js> <profile:id> <classe>
[schema] [requestId]`. A ferramenta funciona com o servidor parado, sem
restrição de troca e sem modificar progresso. `runtime/explain-character.mjs`
mostra classe, nível, origem, marcos e origens dos grants. Com DEV configurado,
exige como quarto argumento um `server-settings.json` com `offlineMode:true`.

Testes: `runtime/tests/classes.unit.test.mjs` e `classes.acceptance.mjs`, incluídos
em `npm test` da raiz. A aceitação usa somente PostgreSQL local `aetherius_test`.
Não há pacote novo nem dependência nova.

Revisor, fora do sandbox: `node runtime/review-classes.mjs <workspace>
<novo-diretório-em-_work/evidence/C3a> <porta-livre-exceto-7777>
<cell-ou-world-local:plugin> [classe]`. Esse harness cria um ator isolado no addon
real e inicia o runtime com DEV=40. A inclusão do ator sem cliente no snapshot
de jogadores é fixture de prontidão explicitada, não confirmação de entrega.
Nenhuma sessão do dono é parada ou reiniciada. Ensaio real de load order:
`node --experimental-strip-types tools/catalog/real-host.ts <workspace>
<novo-diretório-de-evidência> <porta-livre-exceto-7777>`. Move Vokrii e dois
plugins leves, respeitando MAST, e compara os três domínios no addon real.
