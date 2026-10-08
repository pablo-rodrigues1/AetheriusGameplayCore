# Dados gerados — B2

`standing-stones.json`: 13 ativadores, 15 definições SPEL e seus MGEF.
Os grants saem de `records[].data.spells` dos ACTI. A definição de corrida do
Corcel (`mundus.esp|000818`) está em `unsupported`, sem vínculo inventado.

`races.json`: 10 raças jogáveis do export, com os atributos `Starting` e todas as
entradas `ActorEffect` dos winners, acompanhadas dos records SPEL/MGEF alcançados.

Cada arquivo é JSON canônico determinístico, com `schemaVersion`, `exportEpoch`,
`domain`, `signature`, `dependencies`, `roots`, `records` e `unsupported`.
Cada record declara `signature`, `stableFormKey`, `recordType`, `definingPlugin`, `pluginKind`,
`winnerPlugin` e dados do domínio. `FULL`/`LIGHT` descreve o plugin de definição.
Os fingerprints mantêm CRC32 com sinal. IDs de runtime não são persistidos aqui.

Desde B2-fix1, `signature` no topo continua sendo a assinatura do domínio e
protege o arquivo completo. `records[].signature` depende somente do conteúdo
daquele record e do tamanho/CRC32/kind do plugin de definição, sem domínio,
epoch, records vizinhos ou outros plugins. Essa assinatura por record é usada
em `DefinitionRef.catalogSignature`, `lookup` e `resolve`. As definições e
concessões das 13 pedras e 10 raças permanecem iguais ao catálogo B2.

Fonte e comandos de reprodução: `../tools/catalog/README.md`. Dados de semântica
esparsos refletem o depth dos exports; não certificam condições/scripts ou efeitos.
