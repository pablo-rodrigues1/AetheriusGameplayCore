# C1 — Pedras guardiãs

Implementação sobre B1–B5a. O catálogo reconciliado é a única lista de pedras e
feitiços: os 13 ACTI de `catalog/standing-stones.json`, com grants de
`records[].data.spells`. Esta ordem supersede o spike como caminho recomendado;
o código e a flag do spike são preservados para o ambiente de desenvolvimento.

`0004_gc_standing_stone_choice.sql` adiciona `gc_standing_stone_choice`, com
`character_key`, `stone_key`, `revision` e `updated_at`. A identidade do fato é
`profile:<profile_id>` e a identidade da pedra é StableFormKey. Não grava actorId,
userId, epoch, índice de plugin ou FormID de runtime. Revogação substitui a origem
da pedra anterior; outras origens são preservadas pela composição completa.

O servidor concede; o motor do cliente calcula os resultados (`NATIVE_CLIENT`).
Corrida do Corcel (`mundus.esp|000818`) continua `UNSUPPORTED`, sem grant inferido.
As limitações do catálogo aparecem no CapabilityReport, junto com essa ownership.
Semântica de perks, condições e efeitos não foi certificada por C1.

## Comando e provider

`createStandingStoneCommands().choose({ binding, stoneKey, requestId })` valida o
catálogo e os vínculos antes de chamar B3 `executeCommand`. A trava por personagem,
o fato e o recibo pertencem à mesma transação. O binding completo e o modo são
conferidos antes da conexão, depois das esperas/queries e imediatamente antes do
COMMIT pelo adaptador `runtime/src/persistence-scope.ts`. Ele recebe o pool existente
e usa `SET LOCAL search_path`; não constrói, fecha nem muda permanentemente o pool.

Troca incrementa a revisão. Mesma pedra mantém o fato, a revisão e `updated_at`;
um requestId novo ainda grava seu recibo obrigatório em `gc_commands`. Repetir o
mesmo requestId/conteúdo não grava outro recibo, nem executa novamente o efeito.
Conteúdo diferente é conflito. Replay antigo depois de uma troca não reaplica a
escolha antiga: o runtime recompõe sempre o fato atual do banco.

`standingStoneGrants(catalog, fact)` é puro e devolve tipos `ability`, `power` ou
`spell` conforme SPEL, com `source.kind=STANDING_STONE`, `source.key=stoneKey` e a
revisão do fato. Vínculos explicitamente `UNSUPPORTED` são excluídos; vínculo
ausente/tipo desconhecido recusa a escolha. Nenhuma magnitude/skill/atributo é
calculada aqui. Mapa de pedras só existe nos dados, nunca na implementação.

## Runtime e projeção

O runtime registra o sistema automaticamente; o descriptor do gamemode continua
usando a factory existente. `core.chooseStandingStone(intent)` retorna o recibo do
comando mais o resultado da projeção, ou falha declarada com código sanitizado.
Esse método é interno ao servidor, não um endpoint de intenção do cliente.

Depois do commit, `ActorComposition.recompose(binding)` lê fatos dos providers
registrados sob a trava B3 e chama `ActorState.compose()`. A leitura e o envio
ficam em uma fila por personagem; o envio ocorre após fechar a transação. Não há
composição, ledger ou AddSpell paralelo no módulo de pedras. A composição usa o
somatório das revisões dos fatos para `facts` e `grants`, e reserva as dimensões
`equipment/effects=0`, `catalog=1` para este slice. Revisões precisam ser inteiros
seguros; mudanças futuras de catálogo/contrato exigem a política de revisão do
slice correspondente, não fallback para revisão zero.

Cada sistema seguinte registra `ctx.composition.register({id, read(tx,key)})`,
retornando grants do provider puro e a revisão de seus fatos. Depois do commit de
seu comando solicita `ctx.composition.recompose(binding)`. Não publica apenas seus
grants sobre o conjunto completo dos outros sistemas. C1 não conhece esses sistemas.

No sinal de ator pronto, C1 lê o fato novamente e recompõe. A fundação ainda usa
`ONLINE_DELAY_APPROXIMATION` de três segundos, não ACK de carga; C1 não adiciona
outro temporizador. O port B5a aplica só a diferença no host, preserva spells
externos, rejeita revisão antiga e retorna `delivery:UNCONFIRMED`. C1 não força
remove/add no reconnect. Jogo aberto e confirmação do cliente continuam pendentes.

## Ativação e falhas

O host entrega `(referência colocada no mundo, ator)`, como em `ActivateEvent.cpp`.
Lê-se `baseDesc` dessa referência (`BaseDescBinding.cpp`) e usa-se o codec B2 para
comparar a identidade com as raízes catalogadas. Nunca compara a referência com
o FormID do ACTI. Quando o domínio está indisponível, as raízes entregues servem
somente para reconhecer e recusar a ação; não há grants de catálogo não reconciliado.

| Modo | Ativação | Banco/projeção |
|---|---|---|
| off | nenhum hook ou propriedade; ação nativa | nenhuma |
| audit/shadow | log `WOULD_CHOOSE`, sem veto | nenhuma |
| canary | age somente nos profiles listados | somente bindings atuais selecionados |
| active | veta pedra reconhecida antes da operação assíncrona | comando e projeção após commit |

`ENABLE_STANDING_STONE_SPIKE=true` junto com canary/active torna **o sistema C1**
indisponível por `STANDING_STONE_SPIKE_CONFLICT`. A flag e o funcionamento do spike
permanecem, sem dois writers novos ativos. Audit/shadow podem observar o spike.

Falha de banco ou catálogo em active mantém o veto: permitir a ação nativa após
essa falha criaria uma escolha fora da autoridade durável. Nada é concedido.
Antes de o ator ter binding atual, active também veta e registra a falha; sem
identidade confiável não envia mensagem para uma sessão presumida. Canary não age
nesses atores. Referência sem `baseDesc` reconhecível permanece nativa.

Notificação usa `gcStandingStoneNotice`, propriedade definida lazily pelo host,
visível somente ao dono. O updateOwner chama `ctx.sp.Debug.notification(message)`;
não depende do toast `browserModal`, comentado no HTML atual. Código baseado em
`ScampServer::MakeProperty/Get/Set`, `CustomPropertyBinding.cpp` e no mecanismo de
propriedades de `phase0-basic.js`. Não altera host, cliente, painel ou serviço legado.
Cada mensagem tem id para deduplicação e expira após 15 segundos. Recarregar o
gamemode pode redefinir a propriedade se `mp.clear` a tiver removido.

O jogador recebe "Pedra guardiã escolhida", "Você já escolheu esta pedra guardiã",
ou "Não foi possível escolher a pedra guardiã. Tente novamente". Fato commitado
com projeção pendente/falha é informado como salvo e pendente. COMMIT sem confirmação
é `COMMIT_UNCONFIRMED`, `committed:UNKNOWN`; pode haver fato salvo, mas nenhum grant
é enviado antes da confirmação. Repetir o requestId reconcilia o resultado. Como
em B3/B5a, desconexão depois do envio de COMMIT pode deixar fato/progresso gravado;
não se alega cancelamento de SQL já enviado. Reconnect recompõe esse fato.

Notificação é envio pela propriedade, não confirmação de visualização no jogo.
Se makeProperty/set falhar, registra `PLAYER_NOTICE_UNSUPPORTED`. CapabilityReport
declara feedback PARTIAL e entrega não confirmada. Evidência de tela é humana.

## Adoção do spike e operação local

Primeiro desligar os dois writers e desconectar o personagem que será adotado.
Não apagar tabelas `spike_` nem spells do save. Aplicar as quatro migrations com
o módulo `core/pg.js` do gamemode, em processo de manutenção separado. O revisor
carrega o ambiente de desenvolvimento do gamemode; a URL não vai para argumentos
ou logs. Sol executa esta ferramenta somente contra `aetherius_test`.

```powershell
# Raiz de AetheriusGameplayCore; ambiente do gamemode carregado pelo operador
npm run migrations:apply -- 'C:\Code\Aetherius - SkyMP\aetherius-server\build\dist\server\gamemode\core\pg.js'
node runtime/adopt-standing-stone.mjs 'C:\Code\Aetherius - SkyMP\aetherius-server\build\dist\server\gamemode\core\pg.js' 'C:\Code\Aetherius - SkyMP\aetherius-server\build\dist\server\data' profile:108549 public --development
```

A CLI exige modo de desenvolvimento, banco local aetherius_test/aetherius_dev,
spike desligado e C1 off. Confere os arquivos reais dos plugins relevantes e as
assinaturas do catálogo/records; só monta uma visão offline das definições, sem
FormIDs simulados. Não inicia addon ou servidor. O runtime reconcilia os endereços
nativos no boot seguinte. A CLI lê escolha e projeção do spike, recusa discrepância
ou estado gc_ preexistente, e grava fato, registros `owned=true,active=true` e head
`complete=false` na mesma transação/ledger B3. Replay, inclusive depois de uma troca
no Core, não sobrescreve fatos. O import não prova entrega ao cliente. Não apaga
nem altera dados do spike e não adota feitiços só porque aparecem no save.

Para ligar C1 no servidor local, depois da adoção pelo revisor:

```text
ENABLE_GAMEPLAY_CORE=true
ENABLE_STANDING_STONE_SPIKE=false
GAMEPLAY_CORE_MODE_STANDING_STONES=active
GAMEPLAY_CORE_DATABASE_SCHEMA=public
GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV=false
```

Token/login do host permanecem como estão. Somente se o ambiente já estiver em
offlineMode: `GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY=true`, opção de desenvolvimento
que não certifica autenticação. Para canary trocar o modo e fornecer
`GAMEPLAY_CORE_CANARY_CHARACTERS=profile:108549`. Revisor/dono reinicia ou recarrega
o gamemode para capturar essas variáveis; este agente não para nem sobe seu servidor.
Rollback operacional: C1 off, preservar fatos/projeções. Não reativar o spike como
migração reversa: suas tabelas continuam na escolha antiga e não acompanham o Core.

## Aceite e roteiro humano

Com dependências já instaladas na raiz, usar `npm run typecheck`, `npm run build` e
`npm test`. Testes exigem AETHERIUS_TEST_DATABASE_URL, GAMEPLAY_CORE_TEST_EXPORTS e
GAMEPLAY_CORE_TEST_DATA_DIR. No sandbox, `GAMEPLAY_CORE_SKIP_LOCAL_SOCKET_PROBE=1`
pula somente o caso B3 que abre um socket de escuta; por padrão ele executa.
Suíte C1: provider, 13 pedras, duas concessões do Aprendiz, Corcel, modos, falhas,
commit indeterminado, projeção pendente, dois atores, concorrência real, binding
obsoleto sob trava, outra origem, reconnect, processo novo, adoção e CLI.
Simulados citam o código nativo em `runtime/tests/standing-host.mjs`; não substituem
o aceite do addon ou a observação em jogo.

Fora do sandbox, Opus executa:

```powershell
node runtime/review-standing-stones.mjs 'C:\Code\Aetherius - SkyMP' 'C:\Code\Aetherius - SkyMP\_work\evidence\C1\reviewer-native' <porta-UDP-livre-exceto-7777> <cell-ou-world-local:plugin>
```

O harness usa porta obrigatória, pasta nova, banco/schema isolado, pool real e addon
compilado. `mp.place` cria uma referência ACTI; `ObjectReference.Activate(ator,false)`
executa o caminho de evento nativo. Confere escolha, repetição e troca pela enumeração
real de spells, mais o envio da propriedade privada. Binding/readiness controlados
do harness não simulam login nem confirmam tela. Não chama destroyActor, que abortou
o processo em B5a. Executar adoção no banco de desenvolvimento também é do revisor.

O dono do projeto registra data, bundle/build e observações em jogo:

1. Conectar após adoção e conferir que o efeito de Mago foi mantido.
2. Ativar Guerreiro: observar a mensagem e os atributos/efeitos esperados.
3. Repetir Guerreiro: mensagem de escolha já existente e nenhuma soma de bônus.
4. Trocar para Ladrão e Mago: verificar que sai o efeito anterior e entra o novo.
5. Sair/reconectar; depois, em reinício autorizado pelo dono, conferir persistência.
6. Testar Corcel: bônus ligado pelo catálogo, sem alegar corrida suportada.
7. Com o revisor em ambiente isolado, indisponibilizar o banco: mensagem de falha,
   nenhuma troca/novo efeito; recuperar e repetir. Não derrubar o banco/servidor do dono.

C1 somente passa o gate após parecer independente e essa evidência humana.
