# D3 — Como o Core roda no servidor

Estado: **proposta**, com evidência do spike S1. Aguarda aprovação no gate G-ARQ.

## Contexto

O gamemode é JavaScript CommonJS puro, carregado pelo SkyMP a partir de `gamemode/phase0-basic.js`. Os módulos se registram em `core/module-registry.js` e são ligados por variáveis `ENABLE_*`. O Core tem código em TypeScript e em módulos ES, e não pode exigir `node_modules` próprio no servidor.

## Opções

1. Copiar o código do Core para dentro do gamemode.
2. Publicar o Core como pacote e instalar no gamemode.
3. Gerar um único arquivo CommonJS e carregá-lo por um descriptor do module-registry.

## Decisão proposta

Opção 3. O Core é compilado (esbuild) em `dist/aetherius-gameplay-core.cjs`, um arquivo sem dependência externa em runtime. Um descriptor `gameplay-core` em `phase0-basic.js`, sob `ENABLE_GAMEPLAY_CORE`, carrega o arquivo indicado em `GAMEPLAY_CORE_BUNDLE` e entrega a ele `{ mp, pg, env, log }`. Cada feature tem seu modo (`off`, `audit`, `shadow`, `canary`, `active`) dentro do Core.

## Consequências

- O corte no host é um descriptor de 46 linhas e duas linhas no `.env.example`. Não exige recompilar o C++ nem alterar o module-registry.
- Flag ligada com bundle ausente ou inválido é falha registrada, sem fallback; os outros módulos sobem.
- O host nunca chama `shutdownAll`, e recarrega o gamemode quando um arquivo muda. A fundação B1 precisa garantir que uma recarga não registre os ganchos do Core duas vezes.
- A suíte do gamemode já falha na base (541 de 561). Essa é a linha de referência.

## Evidência

Ordem A6-S1 e sua revisão: bundle de 1,8 KB sem `require` externo; ciclo ligar/desligar sem resíduo; `gameplay-core: ATIVO` no servidor compilado localmente.
