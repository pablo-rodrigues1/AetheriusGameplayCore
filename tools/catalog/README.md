# Gerador e adapter do catálogo

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
