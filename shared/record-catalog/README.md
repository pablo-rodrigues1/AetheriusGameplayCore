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

`unsupported` descreve vínculos/semânticas incompletos nos exports, separadamente
da saúde do boot. O spell de corrida do Corcel está presente como definição, mas
nunca entra na lista de concessões de uma pedra. C1 deve declarar essa limitação.

Os testes simulam respostas numéricas e objetos de record no formato do host real.
Os números são respostas opacas de dois hosts, sem gerar índices/slots no Core.
O ensaio real e sua limitação de execução ficam no relatório B2 e nas evidências.

Na pasta deste pacote:

```powershell
npm install --workspaces=false --cache .npm-cache --ignore-scripts
npm run typecheck --workspaces=false
npm test --workspaces=false
npm run build --workspaces=false
```

Node 22.14 é a baseline local. Os testes executam TypeScript com
`--experimental-strip-types`; o build fornece JavaScript e declarações em
`.build/shared/record-catalog/src/`. B1 pode importar os fontes em TypeScript pelo
bundler. Não foi feita ligação ao runtime/bundle nesta ordem.
