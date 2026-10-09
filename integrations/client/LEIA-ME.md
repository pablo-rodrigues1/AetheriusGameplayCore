# Cliente B5b

Patch `B5b-aa864cb.patch`, gerado com `git diff --binary --full-index` contra
`aa864cbf0a7f026dd1b0c2d373640ddedf030369` mais o diff de criação do serviço.
Esse commit compila byte a byte como o v0.13.0 distribuído, SHA-256
`9FF147FB05A900CDB7D1C4AF8496971C54C4FD3465D197ED43E3E774F71F2DCD`.
Não houve commit no clone. A instalação no jogo/MO2 cabe ao revisor.

Na raiz de um clone limpo e atualizado do cliente:

```powershell
git apply --3way "<Core>\integrations\client\B5b-aa864cb.patch"
```

Revisar conflitos com o mantenedor, preservando mudanças posteriores.
O `--3way` pode atualizar o index; isso não autoriza commit. O pacote altera
somente `index.ts`, `services/events/events.ts`, `remoteServer.ts`,
`sync/appearance.ts` e cria `gameplayGrantService.ts`.

Na pasta `client`, com dependências já instaladas:

```powershell
$env:DEPLOY_PLUGIN='false'
$env:ZIP_PLUGIN='false'
node node_modules/typescript/bin/tsc --noEmit
node node_modules/webpack-cli/bin/cli.js --config webpack.config.js --output-path "<pasta de evidencia absoluta>" --output-filename skymp5-client.js --no-cache
Get-FileHash "<pasta de evidencia absoluta>\skymp5-client.js" -Algorithm SHA256
```

Saída: `<pasta de evidencia>\skymp5-client.js`, nunca jogo ou MO2. Conferir o
SHA-256 da entrega em `_work/evidence/B5b/client-sha256.txt`. Destino de teste
existente: mod `AETHERIUS - MERIDIAN - COMPATIBILIDADE`, `Platform/Plugins`,
instância oficial `C:\Modding\MO2`. O revisor preserva o arquivo anterior,
instala com o jogo fechado e confere o arquivo vencedor do VFS. `PluginsDev`
é um destino distinto; as flags acima impedem deploy automático.

No Core, aplicar as migrations pelo CLI existente (0008 está em
`runtime/src/projection/migration.ts`, incluída pelo CLI e pelo bundle).
Ligar `GAMEPLAY_CORE_CLIENT_PERKS_MODE=canary` e configurar personagens de teste;
classes também precisam de seu modo habilitado. O padrão é `off`.
O serviço cliente é passivo até hello do servidor. Servidor antigo não recebe
mensagens nem mutações novas; cliente antigo mantém a aproximação de três segundos.
O perfil oficial não contém plugin `sweetpie`; os dois serviços existentes são
inertes e não foram alterados. Se outro perfil o habilitar, esta entrega não
autoriza ativar o novo writer junto deles.

Canal: `aetherius.gameplay.grants`, versão 1. Hello/session → begin/cycle →
challenge → ready → perks/id/revision/items → ack exato. Identidades de record
são plugin de definição + id local, com assinatura do catálogo. O cliente usa
`Game.getFormFromFile`; presença é verificada antes/depois. A autoria durável
confirmada no servidor é restaurada no reconnect; perk preexistente permanece
protegido. ACK é evidência de entrega, não prova de resultado de combate.

Para reverter a implantação: desligar `GAMEPLAY_CORE_CLIENT_PERKS_MODE`,
recarregar o Core conforme o procedimento do operador, e restaurar o bundle
anterior no mod de teste. Isso mantém perks já aplicados; não os remove em massa.
Para tirar só este patch da árvore, conferir `git apply --check --reverse` e
usar `git apply --reverse` em um clone sem trabalho posterior nos trechos.
Não usar restore/reset/clean. Não apagar tabelas ou registros de autoria.

Harness do addon, somente revisor (porta obrigatória e diferente de 7777):

```powershell
node "<Core>\runtime\harness\client-packet.mjs" --port <porta-isolada> --work-dir <pasta-isolada> --addon "<build>\dist\server\scam_native.node" --settings "<build>\dist\server\server-settings.json"
```

Usa o bot nativo para o retorno CustomPacket autenticado. A API do bot não expõe
recepção: observa saída após a chamada nativa sendCustomPacket. Não certifica
o recebimento dentro do jogo, a aplicação de perks ou o save. Nunca executado
pelo Sol; apenas conferência de sintaxe.
