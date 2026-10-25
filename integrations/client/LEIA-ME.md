# Pacote atual do cliente — DOC-2, 25/10/2026

A baseline suportada é `31566e83fc5f991aaa29f6ee0e868f8a558fe2ad` do repositório aetherius-client. O delta de produção `changes.patch` tem SHA-256 `007d8c3f71964a79b536b4c2ca309b21ff9acaf62be9d95e366804aa43068755`. O [manifesto](manifest.json) registra os arquivos e hashes; [INSTALL](../INSTALL.md) tem o roteiro completo.

## Conteúdo

- `changes.patch` contém a integração normal: inicia observação de NPCs hospedados no cliente e trata correções de posição indexadas enviadas pelo servidor, com validação de identidade. O cliente envia evidência; não escolhe, cria, substitui ou controla spawn.
- O patch de produção altera 2 arquivos-fonte e inclui 3 testes Meridian. Os testes não são assets do bundle.
- `diagnostico/npc-hit-trace.patch` é separado do patch de produção e altera 2 caminhos: `hitService.ts` e um teste. Ele acrescenta logging diagnóstico pelo `logTrace` ao filtro existente; não acrescenta fields ou canais de pacote e falha de diagnóstico não muda o filtro. **Não aplique no cliente oficial.**
- `files/` guarda os 7 arquivos integrais representados no manifesto, inclusive o arquivo diagnóstico. Use essas cópias para revisão e conferência de hash; não copie por cima do mantenedor.
- `APPLIED` no log do indexedTeleport significa que a chamada nativa retornou, não que o motor convergiu para a posição.

As fontes do pacote estão incluídas: [index.ts](files/client/src/index.ts), [npcObservationService.ts](files/client/src/services/services/npcObservationService.ts), [remoteServer.ts](files/client/src/services/services/remoteServer.ts), [hitService.ts diagnóstico](files/client/src/services/services/hitService.ts).

## Aplicação

Use clone limpo no commit-base exato. Rode primeiro `git apply --check` e só então aplique o patch:

~~~powershell
git apply --check "<Core>/integrations/client/changes.patch"
git apply "<Core>/integrations/client/changes.patch"
~~~

Se a base divergir, pare para revisão do diff. Não substitua arquivos do mantenedor com `files/`. DOC-2 provou aplicação e hash em clone limpo: os 5 caminhos do patch de produção bateram com o manifesto. O patch diagnóstico passou em etapa separada e teve 2/2 hashes conferidos. Evidência: registro interno do workspace (não incluído), `_work/evidence/DOC-2/package-proof-r2-retry.txt`.

Para investigar trace em build privado e com ordem aprovada:

~~~powershell
git apply --check "<Core>/integrations/client/diagnostico/npc-hit-trace.patch"
git apply "<Core>/integrations/client/diagnostico/npc-hit-trace.patch"
~~~

Não instale esse patch no servidor oficial. Ele não é gate de combate nem prova de hit único.

## Build e limites

O pacote não acrescenta dependências. O repositório do cliente define `npm run build` como webpack no `client/package.json`. Compile conforme a toolchain do mantenedor e revise o artefato gerado antes de distribuir. DOC-2 não executou build, teste de comportamento, instalação em jogo ou validação oficial.

O patch antigo `historico/B5b-aa864cb.patch` foi preservado byte a byte, com SHA-256 `938db4ae01b1a7fff133fd67d52327cdf0e0e27540f02d19fd873b12044a33f2`; sua base `aa864cbf0a7f026dd1b0c2d373640ddedf030369` está supersedida pela atual. Não aplique esse histórico sobre a baseline atual; veja [nota de supersessão](historico/README.md). O pacote cumulativo suspenso de veneno está em [suspenso](suspenso/B5b-mais-veneno-fix3-aa864cb.patch) e não deve ser instalado.

Na sessão local de 24/10, houve observações de NPC aceitas; em DS-0i a sessão registrou chamada de correção como `APPLIED`. Esses registros não provam convergência do motor nem validação no servidor oficial. As sessões DS-0g/DS-0i são registros internos do workspace (não incluídos).
