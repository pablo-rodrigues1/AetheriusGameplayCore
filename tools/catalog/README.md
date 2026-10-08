# Gerador e adapter do catálogo

Da raiz do workspace:

```powershell
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/build.ts _work/exports aetherius-server/build/dist/server/data/aetherius-loadorder.json AetheriusGameplayCore/catalog
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/verify.ts .
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/real-host.ts . _work/evidence/B2/real-host
```

O diretório de exports, o manifesto dos plugins e a saída são argumentos. Os JSONL
são lidos por streaming; manifesto, epoch e contagens são conferidos. Nenhuma consulta
ao houseCARL, nome localizado ou ID de runtime exportado participa da geração.

Os exports A2 não carregam metadados TES4, tamanho nem CRC dos plugins. O gerador
recebe explicitamente `plugins` do manifesto produzido por `sync-client-plugins.js`.
Só exige metadados dos plugins alcançados pelos domínios; a assinatura SHA-256
inclui epoch, conteúdo e fingerprints relevantes, sem posição ou assinatura global.
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
mínimas e logs ficam nas evidências. Confere UDP 7777 antes de cada processo,
nunca para outro servidor e não carrega gamemode, banco, bundle ou saves.
O relatório registra o método antes de sua execução e a falha de startup de rede
observada neste ambiente. A equivalência no servidor real continua pendente.
