# Cliente B5b-fix1 — perks, sem veneno

O patch instalável `B5b-aa864cb.patch` contém só a B5b e a correção de
confirmação de remoção B5b-fix1. Base:
`aa864cbf0a7f026dd1b0c2d373640ddedf030369`. Não houve commit no clone.
Altera `client/src/index.ts`, `services/events/events.ts`,
`services/services/remoteServer.ts`, `sync/appearance.ts` e cria
`services/services/gameplayGrantService.ts`. `sync/inventory.ts` fica na base;
`gameplayWeaponPoison.ts` sai do cliente instalável.

Veneno suspenso por decisão do dono em 12/10/2026. O patch cumulativo
do Core `85b7066` foi preservado byte a byte em
`suspenso/B5b-mais-veneno-fix3-aa864cb.patch`. Ele permanece exclusivamente
como histórico e fonte dos testes de veneno; não instalar junto com este patch.
As seções D-P1 abaixo estão supersedidas por esta nota quanto à instalação.

## Aplicação e build

Na raiz de um clone limpo da base identificada:

```powershell
git apply --check "<Core>\integrations\client\B5b-aa864cb.patch"
git apply "<Core>\integrations\client\B5b-aa864cb.patch"
```

Em outra base, revisar conflitos com o mantenedor, preservando suas mudanças.
Não reaplicar o cumulativo sobre uma árvore já modificada. Se ainda houver
B5b + veneno, conferir a árvore contra o snapshot aprovado, conferir
`git apply --check -R` do patch suspenso, revertê-lo e aplicar este.
Não usar checkout, restore, reset, clean ou stash.

Na pasta `client`, com dependências já instaladas:

```powershell
$env:DEPLOY_PLUGIN='false'
$env:ZIP_PLUGIN='false'
node node_modules/typescript/bin/tsc --noEmit
node node_modules/webpack-cli/bin/cli.js --config webpack.config.js --output-path "<pasta de evidencia absoluta>" --output-filename skymp5-client.js --no-cache
Get-FileHash "<pasta de evidencia absoluta>\skymp5-client.js" -Algorithm SHA256
```

Bundle da entrega e SHA-256: `_work/evidence/B5b-fix1/build-final/` e
`_work/evidence/B5b-fix1/client-sha256.txt`. O build da B5b pura anterior à
correção reproduziu byte a byte o instalado EE6EF143294D; comparação em
`build-b5b-only-sha256.json`. A compilação escreve somente na evidência.
Instalação fica com o revisor, com o jogo fechado e backup do bundle anterior.

## Entrega e confirmação

Mesmo canal `aetherius.gameplay.grants`, versão 1 e formato do ACK da B5b.
O servidor decide os grants; o cliente relata presença. Serviço passivo até
hello/session → begin/cycle → challenge → ready. Preserva autoria atestada
pelo servidor e protege perks preexistentes. O perfil sem sweetpie deixa os
serviços sweetTaffy existentes inertes; não autoriza dois writers ativos.

A remoção de um perk presente é conferida em updates posteriores: até três
verificações ou 500 ms, o que vier primeiro, para o conjunto da entrega.
Se continua presente, relata FAILED e conserva autoria para reconciliar.
A próxima aplicação aguarda o envio do ACK anterior. Ordem dos itens,
replay exato, revisão, protocolo e ensure continuam como na B5b. Reset de
sessão/ciclo invalida verificações e fila. Se o jogo para de produzir updates,
o cliente não fabrica confirmação; o timeout do servidor é de 10 segundos.

A bridge da Platform aguarda chamadas não latentes. O atraso de visibilidade
da remoção é inferência da sessão real; o fonte não contém sua implementação
interna. Referências e limites: `_work/evidence/B5b-fix1/PARTE-2.md`.
ACK continua sendo evidência de entrega, sem certificação de efeitos de perks.

## Teste e reversão

A varredura automatizada deve registrar `ok=18 fail=0`, remoções exclusivas
confirmadas, `failed=0`, `unresolved=0`, restauração da classe original e
`delivery=CONFIRMED`. O revisor/dono repetem no servidor/jogo e guardam o log.
Nenhum servidor foi iniciado/interrompido nem porta aberta pelo executor.

O harness mantém os argumentos: `node runtime/harness/class-sweep.mjs --port
<porta-isolada> --work-dir <pasta-isolada> --addon <scam_native.node> --settings
<server-settings.json>`. Execução exclusivamente pelo revisor. Sua imitação
efetiva remoções no update seguinte e usa o serviço real corrigido.
Os 22 testes de veneno leem o patch suspenso por `suspended-client.mjs`;
nenhuma asserção de comportamento do veneno foi removida.

Para desfazer a implantação, o operador segue a seção 8 do documento de
ativação e repõe o bundle anterior preservado. Desligar o protocolo não apaga
perks do save nem autoria do banco. Não remover em massa.

## D-P1-fix2 — intenção de veneno e convergência (histórico)

**Correção da arma supersedida pela D-P1-fix3 abaixo.** O protocolo de intenção
continua vigente. A reconstrução foi reprovada em jogo em 10/10/2026.

O **mesmo** `B5b-aa864cb.patch` foi regenerado: inclui toda a B5b e a D-P1-fix2,
contra a mesma base aa864cb. Aplicar apenas uma vez em clone da base; quem já
aplicou a B5b deve revisar o delta com o mantenedor, não reaplicar a parte antiga.
Não há segundo patch cumulativo concorrente. Acrescenta `gameplayWeaponPoison.ts`
e altera `sync/inventory.ts` por meio do leitor existente e de um hook limitado
a diferenças de veneno. O delta desta ordem **não** altera remoteServer nem sua
cadência de cinco segundos. Lista linha a linha em
`_work/evidence/D-P1-fix2/linhas-tocadas.md`, SHA do bundle em
`_work/evidence/D-P1-fix2/client-sha256.txt`.

A extensão usa o canal/session/cycle/challenge existentes. O host anuncia
`weaponPoisonCapability` apenas quando sua opção está ligada; o cliente observa
ExtraPoison em cada update e envia `weaponPoison/id/weaponId/poisonId/hand`, reliable,
uma vez por aplicação observada. Esses ids são evidência de runtime somente: não
há máscara de índice de plugin, configuração com slots ou identidade persistida.
O remetente e a sessão oficial são verificados pelo Core, e o binding
`aetheriusWeaponPoisonIntent` valida a arma da mão no host. Só o servidor decide
consumo e cargas. `weaponPoisonResult` atualiza a projeção pcInv existente.

Correções de veneno removem todas as cópias da base e adicionam as cópias do host,
com a equipada por último, evitando a seleção por uma lista de extras fabricada.
Para bases que passaram por essa correção, a comparação de multiconjunto evita o
+1/-1 de getDiff após esgotar. Sem diferença de veneno e sem correção anterior,
a operação segue o caminho do mantenedor. O serviço de perks conserva seu protocolo.

Diagnóstico: no `skymp5-client-settings.txt` vencedor dos diretórios de plugins,
acrescentar a chave JSON `"aetheriusWeaponPoisonTrace": true`. Ausente/false é o
padrão; reiniciar o cliente. Capturar `[AETHERIUS poison]` equip, unequip,
extra-changes, intent, result e replace-base durante aplicação, fechamento do menu
e três ciclos de cinco segundos. Retirar/false e reiniciar para desligar.
Isso é procedimento para revisor/dono: o executor não instalou nem alterou MO2/jogo.

Harness novo, somente revisor, sem OnEquip de veneno:

```powershell
node "<Core>\runtime\harness\weapon-poison-client-native.mjs" --port <porta-isolada> --work-dir <pasta-isolada> --addon "<build>\dist\server\scam_native.node" --settings "<build>\dist\server\server-settings.json" --fixture "<workspace>\_work\evidence\D-P1-fix1\session-fixture.json"
```

Usa addon e bot reais, identidade oficial da implementação upstream com token
exclusivo do harness, e o código real do cliente com a imitação documentada da API
do jogo. Nenhum banco/login real; a saída é observada após sendCustomPacket nativo,
não dentro do jogo. A fixture vem da sessão do dono e remapeia todos os StableFormKeys
pela API do host. Só a sintaxe foi conferida pelo executor: **não executado, exige
servidor local**. O roteiro completo e os limites estão em
`_work/evidence/D-P1-fix2/PARTE-1.md` e na seção 5 de
`docs/operations/ATIVACAO_DOS_SISTEMAS.md`.

## D-P1-fix3 — veneno na arma existente

O mesmo `B5b-aa864cb.patch` foi regenerado contra aa864cb; inclui B5b e as
correções de veneno. Não reaplicar cumulativamente sobre a fix2. Nesta ordem,
`remoteServer.ts`, o protocolo e o servidor não recebem delta.

A correção chama `callNative('PO3_SKSEFunctions', função, null, actor, ...)`.
Requer **powerofthree's Papyrus Extender** funcional em cada cliente; o perfil
oficial habilita esse mod. As assinaturas instaladas estão na evidência
`D-P1-fix3/platform-api.txt`. SKSE WornObject não oferece os setters necessários.
Chamadas usadas: `ApplyPoisonToEquippedWeapon` quando não há revestimento,
`SetEquippedWeaponPoisonCount` para cargas, `SetEquippedWeaponPoison` para trocar
ou limpar o veneno, e getters para conferir o resultado. Limpar significa
ponteiro de veneno nulo e zero cargas; o node ExtraPoison pode permanecer e
0/0 é normalizado apenas na comparação. Não se remove nem recria a arma.

A Platform aceita chamadas globais nativas com parâmetros explícitos.
A semântica do modelo foi conferida no [fonte do Papyrus Extender](https://github.com/powerof3/PapyrusExtenderSSE/blob/master/src/Papyrus/Functions/Actor.cpp).
É uma inferência sobre a DLL instalada: registro VM e efeito no jogo aguardam
conferência do dono. API ausente, retorno false, leitura divergente ou identidade
ambígua deixam a arma bloqueada para reconstrução e registram UNSUPPORTED com
trace ligado. Não há fallback para remover/adicionar/equipar. Uma tentativa
falha não se repete enquanto estados local e autoritativo permanecerem iguais.

A correção aguarda a arma local do record esperado na mão indicada, após o
caminho normal do mantenedor. Duas chamadas de inventário na entrada, separadas
por 0,3 s, não duplicam a correção. Para bases envolvidas com veneno, compara
multiconjuntos dos extras relevantes e preserva as duas cópias e suas mãos.
Diferenças de quantidade/outros extras nessas bases são UNSUPPORTED; cópias não
empunhadas com divergência de veneno não têm API de instância certificada nesta
ordem. Demais bases seguem o fluxo existente. Sem a opção do host, uma coating
local também pode ser limpa pela projeção autoritativa; isso não envia intenção.

Com `aetheriusWeaponPoisonTrace=true`, capturar `correct-in-place` com `before`,
`after` e `functions`, além de equip/unequip/extra-changes/intent/result. Não deve
haver `replace-base`. Usar o comando webpack acima com saída absoluta de evidência;
SHA e linhas tocadas estão em `_work/evidence/D-P1-fix3/`.

O harness mantém os argumentos documentados acima, permanece exclusivo do
revisor e agora afirma zero remove/add/equip para a arma, gasto/esgotamento,
entrada já envenenada com atraso 0,3 s e 100 ciclos sem correções repetidas.
Ele usa uma **imitação** do motor do cliente: não comprova chamadas PO3 reais.
O executor conferiu sua sintaxe, sem iniciar servidor nem abrir porta.

Roteiro em jogo: com o jogo fechado, revisor instala o bundle preservando o
anterior e confere o SHA. Entrar com a adaga já envenenada; guardar o trace da
entrada e de três ciclos; atacar repetidamente e verificar mão, animação e som.
Aplicar uma dose nova com uma arma, conferir uma dose consumida e sete cargas;
com duas armas, conferir recusa e devolução da dose. Usar adicionalmente um
veneno de família coberta para conferir gasto até zero (Potent Corrosion Poison
continua UNSUPPORTED para resultado). Reconectar com coating persistida. Não há
validação em jogo nesta entrega; gates e instalação dependem do revisor/dono.
