# RecordCatalog — B2

O catálogo contém definições vencedoras geradas dos exports, com identidade por
plugin de definição e FormID local. Não executa nem certifica semântica de efeitos,
scripts ou condições. `RecordCatalogPort` é implementado sem alterar os contratos.

`src/codecs.ts` converte as quatro grafias, usando a validação de `identity.ts`.
É preciso informar `FULL` ou `LIGHT`; a extensão `.esp` não determina esse fato.
`encodeFormKey` pode receber a grafia original do filename dos metadados do plugin.

`loadDomain(data, host)` verifica a assinatura SHA-256 do conteúdo, os plugins
relevantes, seus tamanhos/CRC32/kind, os tipos dos records e a resolução no boot.
`getIdFromDesc` não prova existência: o host mínimo também inspeciona o record.
Qualquer falha de reconciliação deixa o domínio `UNSUPPORTED`, com todas as razões
e sem expor um catálogo parcial. Outro domínio continua independente. Erros ao
ler arquivos têm observações `UNSUPPORTED`; nenhum tamanho/CRC fictício é usado.

O retorno é imutável, separado dos objetos de entrada, com listas de roots e records,
buscas por chave e ID de runtime e os métodos `lookup`/`resolve` dos contratos.
Os mapas ficam em closures privadas. Depois do boot nenhuma consulta chama o host,
disco, rede ou banco. O ID numérico vive apenas no catálogo em memória.

Desde B2-fix1, há duas assinaturas SHA-256. `DomainData.signature` continua
protegendo o arquivo completo (incluindo as assinaturas dos records) e a
reconciliação de todos os plugins relevantes do domínio. `CatalogRecord.signature`
versiona apenas a definição: identidade, tipo, plugin de definição, kind, winner,
dados e tamanho/CRC32/kind do plugin de definição. Nomes de plugins são
normalizados para minúsculas no cálculo. Domínio, epoch, outros records e
fingerprints de outros plugins não entram na assinatura do record.

`DefinitionRef.catalogSignature` recebe `CatalogRecord.signature`.
`lookup(definition)` e `resolve(key, signature)` conferem essa assinatura do
record em memória; assinatura do domínio, de outro record ou antiga resulta em
`UNSUPPORTED`. O boot também recalcula cada assinatura de record e recusa
inconsistências. Um mesmo record gerado dos mesmos exports e fingerprints em
dois domínios produz referências iguais e pode compor no ActorState. Os
contratos permanecem iguais; dados antigos sem assinatura por record precisam
ser regenerados. O bundle deve ser recompilado depois da regeneração, pois
embute os dados e a implementação do catálogo.

`unsupported` descreve vínculos/semânticas incompletos nos exports, separadamente
da saúde do boot. O spell de corrida do Corcel está presente como definição, mas
nunca entra na lista de concessões de uma pedra. C1 deve declarar essa limitação.

Os testes simulam respostas numéricas e objetos de record no formato do host real.
Os números são respostas opacas de dois hosts, sem gerar índices/slots no Core.
O ensaio real e sua limitação de execução ficam no relatório B2 e nas evidências.

Na pasta deste pacote:

```powershell
npm run typecheck --workspaces=false
npm test --workspaces=false
npm run build --workspaces=false
```

Node 22.14 é a baseline local. Os testes executam TypeScript com
`--experimental-strip-types`; o build fornece JavaScript e declarações em
`.build/shared/record-catalog/src/`. B1 pode importar os fontes em TypeScript pelo
bundler. Não foi feita ligação ao runtime/bundle nesta ordem.

No aceite de B2-fix1, as dependências disponíveis eram as locais dos pacotes;
`node_modules` da raiz estava ausente. O typecheck foi executado diretamente
com `node shared/record-catalog/node_modules/typescript/bin/tsc --noEmit -p
shared/record-catalog/tsconfig.json` a partir da raiz do Core, sem instalação.
