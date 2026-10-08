# B1 — Runtime do GameplayCore

Este documento substitui as instruções de ciclo de vida do README A6-S1. O spike
A6-S2 continua em `spike-standing-stone/`, até C1. Os ADRs D1–D4 e D6 permanecem
as fontes de arquitetura; esta ordem não certifica resultados de efeitos.

**Atualização C1 (08/10/2026):** pedras estão registradas por padrão na factory e
continuam off por padrão. O caminho recomendado usa `modules/standing-stone-system`,
`ActorComposition`, migration 0004 e o port B5a; o spike permanece intacto como
opção legada de desenvolvimento. C1 canary/active recusa iniciar com o spike ligado.
Operação local, adoção, ownership, falhas, feedback privado e roteiro humano:
[`../modules/standing-stone-system/README.md`](../modules/standing-stone-system/README.md).
Essa documentação supersede abaixo as referências a C1 como implementação futura.

Na raiz do Core, com Node >=22.14 e npm 10:

```powershell
npm ci
npm run typecheck
npm run build
npm test
```

Um comando instala as dependências de todos os workspaces, incluindo os pacotes
novos de `modules/*`. O lockfile da raiz foi reconciliado offline; instalação
limpa pela rede fica com o revisor. Scripts agregados descobrem os pacotes a cada
execução. Pacotes sem comando de build são fonte puro; typecheck usa tsc quando
há tsconfig. Todos os testes disponíveis são executados, e falha retorna exit 1.
Os fontes de shared/tools/modules são copiados para `runtime/.packages/Core`;
compilação, sync-data e fixtures geradas escrevem somente nessa cópia. As ferramentas
vêm das dependências declaradas no Core. Em instalação com dependências hoisted,
o runner fornece a ponte exigida pelos tsconfigs históricos de B3/B4.

Para testes, fornecer `AETHERIUS_TEST_DATABASE_URL`, exclusivamente de banco local
`aetherius_test`, sem imprimir a variável. Os testes B2 também precisam dos cinco
JSONL originais em `_work/exports` e dos plugins reais e manifesto no Data do host.
Esses artefatos não são substituídos por records fabricados. Caminhos alternativos:
`GAMEPLAY_CORE_TEST_EXPORTS` e `GAMEPLAY_CORE_TEST_DATA_DIR`. As junções de fixtures
são somente para leitura pelos testes B2. O teste `npm test` completo contém um caso
B3 que abre brevemente um socket local. Por padrão esse caso executa; somente
`GAMEPLAY_CORE_SKIP_LOCAL_SOCKET_PROBE=1` o pula no sandbox, preservando todos os
demais testes de integração PostgreSQL. O revisor executa sem essa variável.
`npm test -- --unit` exclui explicitamente a integração B3; a integração B1
contra PostgreSQL continua obrigatória, assim como os 12 casos do spike. O subconjunto
`npm run test:foundation` executa shared/tools/runtime, sem os módulos históricos.
Nenhum destes subconjuntos equivale à suíte completa.

O build incorpora os JSON dos domínios B2 e todas as migrations SQL B3 no arquivo
`dist/aetherius-gameplay-core.cjs`. Não há dependência de npm em runtime: apenas
módulos internos do Node. O host injeta o seu pool existente por `pg.init()`;
o runtime não constrói nem fecha pools e não lê URL de banco.

O descriptor existente permanece compatível com `{ mp, pg, env, log }` e com os
métodos `initialize`, `shutdown`, `healthCheck`, `info`. A factory não inicia nada.
`initialize` serializa boot e substituição por uma coordenação guardada em `process`
com Symbol.for, inclusive quando o require cache foi apagado. A nova instância
aguarda shutdown da anterior. Shutdown aborta o signal dos sistemas, remove os hooks
que ainda possui, cancela os timers e desliga sistemas em ordem inversa. Retentativa
no mesmo objeto reconstrói as dependências. Falha de sistema libera seu próprio scope.
Operações assíncronas de um sistema devem verificar `signal` e `identity.isCurrent`
depois de cada await antes de projetar; o runtime não pode cancelar um comando SQL
que já foi enviado pelo domínio.

Todos os hooks de propriedade mp passam pelo broker. Ele chama o handler anterior
e os sistemas e preserva um veto síncrono `false`. Não restaura sobre um handler
posterior escrito por outra pessoa. `mp.on` não expõe unsubscribe no C++ atual:
um único bridge de disconnect por host permanece no processo e mantém somente os
assinantes atuais. Shutdown remove os assinantes, e recarga não adiciona outro
listener nativo. Isto é diferente de um handler vivo da instância anterior.

Identidade lê `mp.get(0, 'onlinePlayers')` e `mp.get(actorId, 'profileId')`, nunca
varre userIds ou perfis. Profile positivo gera as chaves `profile:<profile_id>`.
O host precisa declarar `offlineMode: false`; modo offline/contexto desconhecido
fica UNSUPPORTED. Para desenvolvimento local somente, a opção explícita
`GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY=true` aceita esse perfil, sem alegar que foi
autenticado. `getUserByActor` associa o ator ao evento nativo disconnect, inclusive
userId zero, e cada nova ligação recebe UUID como epoch. Sem esse par de APIs, só
a observação periódica detecta desconexões; reconexões invisíveis entre dois polls
não são certificadas. O port verifica o binding completo e a presença online.

`actor-ready` é PARTIAL, `ONLINE_DELAY_APPROXIMATION`, `certified:false`: disparado
uma vez por binding, três segundos após a primeira detecção online. O temporizador
fica somente em `actors.ts`. Não é ACK do cliente. O host envia learnedSpells no
spawn, mas não confirma que remoteServer.ts terminou removeAllSpells/learnSpells.
Mudança mínima para sinal certo: ACK do cliente após aplicar o spawn/learnedSpells,
validado no host contra ator, conexão e geração de spawn; expor callback ao gamemode.
Até B5, o runtime não declara a entrega da projeção como certificada.

B5a acrescenta `ctx.projection`: port comum de feitiços/habilidades/poderes por
diferença, com registro PostgreSQL e reconciliação no sinal aproximado da B1.
Somente declara aplicação no host; ACK e perks continuam pendentes de B5b.
Contrato, política de feitiços externos, recuperação de falhas e harness nativo:
[`src/projection/README.md`](src/projection/README.md). Este documento supersede a
instrução provisória de consumir B5 como peça futura no exemplo abaixo. O spike
permanece separado e não usa o novo port antes de C1.

Configuração por sistema: `GAMEPLAY_CORE_MODE_STANDING_STONES`, `_RACES`, `_CLASSES`,
`_RELIGION`, `_SPELLS`, `_PERKS`, `_DAMAGE` e qualquer novo ID transformado em maiúsculas
com hífens trocados por underscores. Valores: off/audit/shadow/canary/active; padrão off.
Valor inválido gera aviso e off. Canary recebe a lista explícita, separada por vírgula,
`GAMEPLAY_CORE_CANARY_CHARACTERS=profile:108549`. `canMutate(binding)` permite somente
active ou personagem selecionado em canary, com binding atual. Um sistema deve usar
essa guarda antes de enviar comandos ao dono do fato; possuir um contexto audit/shadow
não autoriza mutação. A persistência é API interna confiável, não uma barreira de segurança
contra código malicioso. O flag histórico `ENABLE_STANDING_STONE_SPIKE=true` permanece
independente destes modos e aparece separado no relatório.

`capabilityReport()` lista por sistema modo, disponibilidade de dependências, domínio,
limitações de links do catálogo, migrations requeridas, instrução de manutenção e provas.
`registered`/`started` distinguem dependências disponíveis de código de sistema ligado.
SUPPORTED nessa lista é disponibilidade das dependências do runtime, não semântica de
perks/feitiços nem certificação de resultado. B2 só entregou standing-stones e races;
classes/religion/spells/perks/damage ficam UNSUPPORTED até seus catálogos existirem.

Migrations nunca são aplicadas por padrão. Em banco ausente, hash diferente ou migration
pendente, o runtime mantém healthCheck=true e indisponibiliza os dependentes do banco.
O catálogo de raça ainda pode estar disponível. Aplicação de desenvolvimento no boot:
`GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV=true`; schema opcional
`GAMEPLAY_CORE_DATABASE_SCHEMA`, padrão public. Manutenção explícita:

```powershell
npm run migrations:apply -- <caminho-absoluto-do-gamemode/core/pg.js> [schema]
npm run migrations:status -- <caminho-absoluto-do-gamemode/core/pg.js> [schema]
```

O comando de manutenção usa e fecha o wrapper do gamemode somente no processo CLI.
Ele não cria um pool adicional. Credenciais e causas de erros não entram nos logs.

Registro mínimo (antes de initialize):

```ts
core.register({
  id: 'races', domain: 'races', requiresDatabase: false,
  start(ctx) {
    const unsubscribe = ctx.actors.onReady(({ binding }) => {
      if (ctx.signal.aborted || !ctx.identity.isCurrent(binding)) return;
      // Consumir catálogo, compor com o dono do fato e chamar ctx.projection.publish.
      // Mutação só se ctx.canMutate(binding), com revisão/epoch conferidos após await.
    });
    return unsubscribe;
  }
});
await core.initialize();
```

Específico do spike: tabela fixa de pedras/feitiços, três tabelas spike_, ledger e
lock próprios provisórios, Papyrus AddSpell/RemoveSpell direto, snapshot de projeção,
reset remove/add pós-spawn, identidade provisória no handler de ativação e flag dedicada.
No bundle B1 seu hook passa pelo broker. A reidratação provisória do spike permanece independente do IdentityPort, inclusive em offlineMode, atrás da mesma flag.
O spike preserva seu polling e delay legados, isolados no seu arquivo, para manter A6-S2;
esses timers são rastreados e cancelados em shutdown. C1/B5 substituem essas peças.

Verificação no host nativo pelo revisor, fora do sandbox, sem tocar UDP 7777:

```powershell
node runtime/review-host.mjs <workspace> <evidence-dir-B1-reviewer> <porta-UDP-livre>
```

O harness nativo de pedras segue a mesma regra de porta livre e é executado pelo
revisor fora do sandbox. `runtime/review-standing-stones.mjs` coloca uma referência
real com `mp.place` e invoca diretamente o handler `onActivate` que o próprio
sistema registrou. Assim verifica veto síncrono, persistência, composição e
aplicação nativa dos feitiços sem chamar `ObjectReference.Activate` por Papyrus
(essa reentrada aborta o addon) ou usar `mp.set` para `worldOrCellDesc` (API não
implementada). O harness não cobre o trecho C++ do cliente que encaminha a
ativação ao gancho; isso só é exercitado em jogo. O comando e os argumentos estão
no cabeçalho do script.

O aviso privado cria `gcStandingStoneNotice` antes da primeira escrita. Não se
deve testar sua existência com `mp.get`: no host, uma leitura de propriedade
custom ainda não registrada escreve um erro no log antes de lançar a exceção.

O script exige `AETHERIUS_TEST_DATABASE_URL`, rejeita 7777, confere a porta, usa
`core/pg.js` real, schema isolado e o addon real. Verifica boot, catálogo, migrations,
health listener único, substituição de bundle após `mp.clear` e require sem cache,
e reinitialize. Somente sua sintaxe foi conferida nesta ordem. Não executa o watcher
do TS nem login/jogo: o relatório contém o roteiro adicional da recarga efetiva de
`phase0-basic.js` numa cópia separada do servidor completo.

