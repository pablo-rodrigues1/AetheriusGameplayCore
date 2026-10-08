# A6-S1: bundle CommonJS (spike descartável)

Este runtime testa D3 antes do G-ARQ. `createGameplayCore({ mp, pg, env, log })`
expõe `initialize`, `shutdown`, `healthCheck` e `info`. A versão vem do package.json
da raiz. As sete features permanecem em `off`; nenhum serviço do host é usado.
O único registro é um listener de diagnóstico no `process`, no evento
`aetherius:gameplay-core:health-check`. Shutdown remove exatamente esse listener.
O ciclo é idempotente, inclusive ao inicializar duas vezes sem shutdown.
Isso não certifica listeners nativos de jogo nem capacidades de gameplay.

Na raiz do Core:

```powershell
Push-Location runtime
npm.cmd ci --workspaces=false
Pop-Location
npm run typecheck:runtime
npm run build
```

As dependências de build ficam em `runtime/node_modules`; o build gera apenas
`dist/aetherius-gameplay-core.cjs`, sem dependências externas em runtime. A entrada
`default` de `@aetherius/contracts` aponta ao fonte TS para resolução pelo bundler.
Ela não promete executar TypeScript diretamente pelo Node 22 sem um loader.

No servidor final, o dev aplica o descriptor de `gameplay-core` de
`phase0-basic.js`, distribui o `.cjs`, recopia o gamemode para o diretório de
execução e configura em `gamemode/.env`:

```dotenv
ENABLE_GAMEPLAY_CORE=true
GAMEPLAY_CORE_BUNDLE=C:/deploy/aetherius-gameplay-core.cjs
```

Caminhos relativos são resolvidos contra `process.cwd()` do servidor, não contra
o arquivo temporário usado pelo SkyMP. O registry registra falha se o caminho,
a factory ou os quatro métodos estiverem ausentes; os outros módulos continuam
o boot. A flag desligada dispensa o bundle. O pool injetado é o wrapper existente
`core/pg.js`; não se cria pool nem se faz consulta neste spike.

O registry oferece shutdown, mas `phase0-basic.js` não o conecta ao encerramento
do host. O aceite verifica a chamada explícita de `shutdownAll` e o reinício
no mesmo processo. Integrar o encerramento/reload automático pertence ao B1.

O verificador da ordem fica em `_work/evidence/A6-S1/verify.cjs` na raiz do
workspace. Usa o gamemode copiado por `run-local-server.ps1 -Refresh`, fora do
SkyMP, com `mp` indefinido, e as dependências já instaladas nessa cópia.
