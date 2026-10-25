# Gerador e adapter do catálogo

> Atualização DS-2d: use a seção DS-2d ao fim deste arquivo para Template e effects; as limitações históricas correspondentes estão supersedidas.

Atualização C2: `PERK.jsonl` é uma entrada obrigatória adicional, com manifesto e
epoch conferidos. SPEL → MGEF → PerkToApply é seguido nos dois domínios. Os PERK
alcançados conservam os valores dos campos exportados e notas de entry points e
condições limitadas pela profundidade do export. Não há avaliação de condições,
novo grant do provider de pedras ou autoridade de resultado certificada. Apenas
records novos são acrescentados; assinaturas dos records inalterados são preservadas.

Da raiz do workspace:

```powershell
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/build.ts _work/exports aetherius-server/build/dist/server/data/aetherius-loadorder.json AetheriusGameplayCore/catalog
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/verify.ts .
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/real-host.ts . _work/evidence/B2-fix1/reviewer-real-host 7791
```

O diretório de exports, o manifesto dos plugins e a saída são argumentos. Os JSONL
são lidos por streaming; manifesto, epoch e contagens são conferidos. Nenhuma consulta
ao houseCARL, nome localizado ou ID de runtime exportado participa da geração.

Os exports A2 não carregam metadados TES4, tamanho nem CRC dos plugins. O gerador
recebe explicitamente `plugins` do manifesto produzido por `sync-client-plugins.js`.
Só exige metadados dos plugins alcançados pelos domínios; a assinatura SHA-256
inclui epoch, conteúdo e fingerprints relevantes, sem posição ou assinatura global.
Essa é a assinatura do domínio. Desde B2-fix1 cada record também recebe
`signature`, calculada somente de seu conteúdo no catálogo e do fingerprint
do plugin de definição. É ela que vai em `DefinitionRef.catalogSignature`.
O mesmo SPEL/MGEF alcançado por dois domínios tem a mesma assinatura. O
`verify.ts` confere tanto a assinatura do domínio quanto cada record.
A reprodução exige os mesmos exports e fingerprints. Os plugins relevantes são
tratados como estáveis conforme D6; o epoch dos exports não é uma prova criptográfica
da correspondência aos arquivos atuais.

Pedras: o booleano `b<Stone>` verdadeiro de `powerShrineScript` seleciona as
propriedades `pDoom<Stone>Ability` e `pDoom<Stone>NegativeAbility`. Os vínculos do
script ficam em `scriptEvidence`, incluindo o negativo do Aprendiz. Spell do domínio
Mundus sem ligação a seletor é `UNSUPPORTED`, incluindo a corrida do Corcel.
Raças: seleção por flag `Playable`, `Starting`, boosts, regen e `ActorEffect` do
winner. SPEL e seus MGEF alcançados entram como definições; nenhuma família recebe
autoridade de resultado do servidor por estar neste catálogo.

O adapter `createFileHost(mp, dataDir, domains)` usa `mp.getEspmLoadOrder()` como
presença efetivamente carregada. `fingerprintFiles` lê os arquivos relevantes do
Data real no boot, com a mesma regra de `client-plugins.js`: extensão `.esl` ou
flag TES4 Light, tamanho em bytes e `zlib.crc32(buffer) | 0`. Não confia em um
manifesto potencialmente desatualizado como evidência dos arquivos de runtime.
O custo é linear no total de bytes relevantes; pode ser compartilhado entre
domínios no mesmo boot. Falhas de leitura só bloqueiam domínios dependentes.
Para lookup, extrai apenas `result.record?.type`, porque ausente retorna `{}`.

O ensaio real carrega diretamente o addon compilado em dois processos e confere
masters via TES4/MAST, incluindo o marcador de tamanho estendido XXXX. Configurações
mínimas e logs ficam nas evidências. A porta UDP é o terceiro argumento,
obrigatório, inteiro de 1 a 65535, sem padrão. A porta escolhida passa para os
dois processos e seus settings; é conferida antes de cada processo. O exemplo
usa 7791: escolha uma porta livre diferente da 7777 usada pelo dono do projeto.
Use uma pasta de evidência separada da pasta de trabalho do servidor dele.
O harness nunca para outro servidor e não carrega gamemode, banco, bundle ou saves.
Os snapshots incluem a assinatura de cada record, além da assinatura do domínio;
ambas precisam continuar iguais depois da reordenação.

O ensaio B2 foi aprovado pelo revisor conforme `_work/reviews/B2-review-1.md`.
O ensaio após B2-fix1 fica **não executado: exige servidor local**, conforme
AGENTS.md §7.1; Opus 5.5 executa o comando acima fora do sandbox e grava as
saídas. Sol 6.1 executa apenas a validação dos argumentos e os testes sem rede.
O runtime atual importa `loadDomain` e não monta referências com a assinatura
do domínio. Seu `runtime/build.mjs` embute os JSONs em `BUILD_DOMAINS`; o revisor
precisa executar `npm run build --workspace @aetherius/runtime` na raiz do Core
com as dependências instaladas antes de usar a correção no bundle. B2-fix1 não
reescreve `runtime/` nem `dist/`.

## Gerar e conferir combat (DS-2)

Da raiz do workspace, com Node 22 e as dependências do Core já instaladas:

```powershell
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/build.ts _work/exports/combat-20261024 aetherius-server/build/dist/server/data/aetherius-loadorder.json AetheriusGameplayCore/catalog combat
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/verify.ts .
cd AetheriusGameplayCore
npm run build --workspace @aetherius/runtime
node --test runtime/tests/combat.test.mjs
```

O quarto argumento `combat` gera somente combat.json. Sem esse argumento, o
comando mantém o comportamento histórico e gera apenas pedras/raças; não use os
exports novos nesse modo. Classes mantêm seu gerador. O reader de streaming
comum está em exports.ts, preservando a seleção/assinaturas dos domínios antigos.

combat.ts exige WEAP/ARMO/AMMO/RACE/KYWD com contagens e epoch coerentes; indexa
por FormID e inclui todos os records físicos, sem filtro por nome ou jogabilidade.
Usa apenas fingerprints relevantes do manifesto explícito. O manifesto não prova
correspondência criptográfica entre o export houseCARL e os arquivos; verify.ts
compara os fingerprints catalogados com os arquivos reais. MANIFESTO.txt dos
exports fornece hashes de reprodução; não fornece fingerprints TES4.

Assinaturas de domínio e de cada record independem da ordem do manifesto. O teste
combat.test.mjs regenera o arquivo canônico com o manifesto invertido, confere os
valores por FormID, resolve FULL/LIGHT com IDs distintos e assinaturas iguais,
confere ausência de record, lacunas de dados, epoch divergente e metadados ausentes.
O contrato duplo usa os wrappers reais do host; não prova execução nativa.

verify.ts e real-host.ts incluem agora combat. O ensaio nativo continua reservado
ao Opus (AGENTS §7.1), com porta e pasta explícitas, a partir do workspace:

```powershell
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/real-host.ts . _work/evidence/DS-2/real-host-opus 7791
```

Esse comando não foi executado pelo implementador: exige servidor local. A porta
é exemplo, não padrão; conferir que está livre e não usar a porta do dono. O
harness prepara processos isolados, sem gamemode/banco/saves, e compara todos os
records após reordenar. O bundle é reconstruído com combat em BUILD_DOMAINS e o
boot usa o mesmo createFileHost. A DS-2 não instala nem ativa esses artefatos.

## DS-2b: entrada NPC_ e limites da herança

Histórico: a geração conjunta, a representação e a pendência de CLAS abaixo
são supersedidas pela seção DS-2b-fix1.

O comando combat acima exige também NPC_.jsonl no diretório combat-20261024,
com manifesto, contagem de 11.583 e epoch igual. O SHA-256 esperado consta de
MANIFESTO.txt. Não usar NPC_ do export antigo nem inventar CLAS ausentes.
O leitor exports.ts expõe note_ref para os vínculos de ContainerItem que o depth 3
não expande em folhas. Valores de records são procurados exclusivamente por FormID.

O contrato dos dados locais e de npc.templateProviders está em catalog/README.md.
A resolução de categoria segue os flags definidos em libespm/include/libespm/NPC_.h
e a parada por categoria de server/cpp/server_guest_lib/EvaluateTemplate.h,
conferidos no host atual. Nenhuma lista nivelada é avaliada. Contagem de NPC,
assinaturas, fingerprints, dados por FormID, offsets negativos, ranks, cadeia
encadeada, template ausente/cíclico, flags desconhecidas e campos incompletos
são cobertos pelos testes combat. Reordenação muda IDs de NPC_ e equipamento
com template mantendo dados e assinaturas. Esses testes usam contrato duplo do
host, sem alegar execução nativa.

Saídas dos aceites: _work/evidence/DS-2b. O real-host.ts exige agora também um
movimento válido de plugin que define NPC_ e equipamento com template, além das
provas anteriores FULL/LIGHT. Compara por chave indexada para evitar busca quadrática.
Roteiro do revisor, não executado pelo implementador (AGENTS §7.1):

~~~powershell
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/real-host.ts . _work/evidence/DS-2b/real-host-opus <porta-udp-livre>
~~~

A porta é argumento, sem padrão. Escolher pasta isolada e porta diferente da do
dono; o harness não para servidor existente. O teste nativo prova resolução, não
semântica de template no engine. O item 2 da ordem parou por falta de prova
primária acessível (investigação em template-investigation.md). WEAP/ARMO mantêm
os valores locais e a limitação de herança da DS-2. CLAS/auto-cálculo ficam
pendentes; required-clas.json identifica os records a exportar no mesmo epoch.
Não há migration, opção de configuração, instalação ou ativação nova.

## DS-2b-fix1: combat e npcs independentes

Com Node 22, da raiz do workspace:

~~~powershell
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/npcs.ts _work/exports/combat-20261024 aetherius-server/build/dist/server/data/aetherius-loadorder.json AetheriusGameplayCore/catalog _work/evidence/DS-2b/fix1
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/verify.ts .
cd AetheriusGameplayCore
npm run typecheck --workspace @aetherius/catalog-tools
npm run typecheck --workspace @aetherius/runtime
npm run build --workspace @aetherius/runtime
node --test runtime/tests/combat.test.mjs
npm test --workspace @aetherius/runtime
~~~

O CLI npcs.ts gera combat.json (cinco tipos físicos) e npcs.json (NPC_ + CLAS),
além de combat-unsupported.json e npcs-unsupported.json fora do bundle. Os quatro
argumentos são obrigatórios; não há diretório de relatório padrão. combat.ts
continua exportando buildCombatDomain; build.ts ... combat gera apenas combat e
não atualiza npcs nem seus relatórios. Use o comando conjunto acima nesta entrega.

NPC_ e CLAS exigem manifestos, contagens e epoch igual entre si. O pacote da ordem
tem 11.583 e 220 records, respectivamente, no mesmo epoch dos físicos. NPC_FIELDS,
NPC_TEMPLATE_CATEGORIES e NPC_PROVIDER_REASONS definem o layout 1, documentado em
catalog/README.md, com helpers puros de leitura. Null não vira zero nem lista vazia.
As listas completas de limitações são retornadas pelo argumento opcional report
dos builders; unsupported do domínio contém grupos/contagens. Não copie esses
relatórios para catalog nem BUILD_DOMAINS.

A suíte combat inclui NPC/CLAS e comparação exaustiva das colunas numéricas/pesos
com exports buscados por FormID, reprodução canônica, reordenação FULL/LIGHT e
assinatura por record, cadeia por categoria, lacunas/ciclos/LVLN e recusa de
assinatura obsoleta. Fixtures ficam somente em _work/evidence/DS-2b/fix1.
O runtime npm test usa apenas AETHERIUS_TEST_DATABASE_URL (aetherius_test) e
GAMEPLAY_CORE_TEST_EXPORTS=_work/exports. O script de reprodução e as medições
antes/depois estão nesse mesmo diretório; não imprimem a URL.

Roteiro nativo atualizado inclui npcs/CLAS, sem executar servidor pelo implementador:

~~~powershell
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/real-host.ts . _work/evidence/DS-2b/fix1/real-host-opus <porta-udp-livre>
~~~

Porta e pasta explícitas, sem padrão e sem parar o servidor existente. Ainda exige
Opus fora do sandbox; nenhuma validação nativa ou em jogo é alegada nesta fix1.
Não há migration, opção de configuração, instalação ou ativação nova. Templates
WEAP/ARMO permanecem parados, sem nova tentativa de inferir semântica.

## DS-2d — gerar Template e effects

Esta seção supersede as notas anteriores que mantinham Template WEAP/ARMO
parado e ENCH ausente. Q15a do dono fixa a herança; não se presume semântica
do executável além dessa decisão. NPC/CLAS e os demais domínios não são regravados.

Da raiz do workspace:

~~~powershell
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/effects.ts _work/exports/combat-20261024 aetherius-server/build/dist/server/data/aetherius-loadorder.json AetheriusGameplayCore/catalog _work/evidence/DS-2d
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/verify.ts .
cd AetheriusGameplayCore
npm run typecheck --workspace @aetherius/catalog-tools
npm run build --workspace @aetherius/catalog-tools
npm test --workspace @aetherius/catalog-tools
npm run typecheck --workspace @aetherius/runtime
npm run build --workspace @aetherius/runtime
node --test runtime/tests/combat.test.mjs
~~~

O CLI effects.ts gera SOMENTE combat.json e effects.json, com os relatórios
completos combat-unsupported.json / effects-unsupported.json no quarto argumento
obrigatório. Combat continua aceitando build.ts ... combat. Não usar npcs.ts para
gerar esta ordem: seu CLI também regravaria npcs.json, fora da escrita DS-2d.
A geração combat exige WEAP/ARMO/AMMO/RACE/KYWD; effects exige MGEF/ENCH/ALCH/PERK,
com contagens, epoch e tipos conferidos. ENCH/ALCH depth 4 e MGEF depth 3 são os
artefatos da ordem. PERK fornece as entradas Q8, buscadas por FormID do plugin de
definição, nunca nome nem número de linha. Confira hashes contra MANIFESTO.txt.

Contrato e regra exata de recorte em catalog/README.md, EFFECT_RULES/physicalEffectRule,
WEAPON_COMBAT_FIELDS/ARMOR_COMBAT_FIELDS e EFFECT_FIELDS/CARRIER_EFFECT_COLUMNS.
O filtro começa nos carriers, não inclui todo MGEF de magia que modifica armadura.
A ausência de ligação a ENCH/ALCH não é prova de inexistência de outra fonte;
a seleção é o escopo desta ordem. Não interpretar os counts de fora como efeitos
ativos ou semanticamente implementados. Arrays posicionais reduzem o volume,
unsupported agrega por motivo e mantém a lista completa fora do bundle.

O runtime/build.mjs embute effects; loadDomain o aceita e o laço genérico de boot
o registra. Nenhuma configuração, migration ou sistema novo precisa ser ativado.
As assinaturas das definições herdadas incorporam valores efetivos/proveniência;
manifesto invertido não muda a geração. Os testes conferem todos os itens com
template e todos os efeitos selecionados contra o export pelo FormID; cadeias,
ciclos, ausência/tipo errado, flags desconhecidas e magnitude ausente usam fixtures
apenas em _work/evidence/DS-2d. Reordenação no contrato duplo não é teste nativo.

Aceite completo do runtime, com a URL de teste sem imprimir:

~~~powershell
node _work/evidence/DS-2d/run-runtime-tests.mjs
~~~

Esse launcher aceita somente aetherius_test, seleciona AETHERIUS_TEST_DATABASE_URL
de _work/db.env, define GAMEPLAY_CORE_TEST_EXPORTS=_work/exports e sanitiza a saída.
Não usa banco dev. npm test é executado integralmente, sem enfraquecer o script.
measure-initialize.mjs registra require()/três initialize() no harness existente,
sem servidor nativo; tamanhos antes/depois e saídas ficam na mesma evidência.

Ensaio nativo, EXCLUSIVO do Opus e não executado pelo implementador:

~~~powershell
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/real-host.ts . _work/evidence/DS-2d/real-host-opus <porta-udp-livre>
~~~

O roteiro compara os seis domínios e exige mudança de ID de equipamento com
template e de efeitos, além dos probes anteriores. Porta e pasta explícitas;
nunca para o servidor do dono. Nenhuma instalação no jogo ou MO2 é feita aqui.
