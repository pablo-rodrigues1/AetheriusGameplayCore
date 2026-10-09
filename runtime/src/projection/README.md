# B5a — Projeção de SPEL

`SpellProjection` implementa o contrato fixo `GrantProjectionPort`. Publicar recebe
`GrantProjection` com o `GrantSet` completo de `ActorState.compose()`. O port usa
`effectiveSet()` internamente e une spell/ability/power pelo StableFormKey. As origens
continuam no conjunto completo, usado para validar conteúdo e revisão. Modifiers e
perks são UNSUPPORTED por item. Não calcula resultados de efeito.

O contexto de cada sistema recebe `ctx.projection`. Publicações só passam em active
ou canary autorizado, com binding atual. Audit/shadow/off não projetam. Reconciliação
automática também exige um sistema ativo disponível; o spike não ativa esse port.
Sem banco/migrations atuais, `capability()` e `publish()` declaram o motivo da
indisponibilidade. Não cria nem fecha pool: usa exclusivamente o injetado pelo host.

O recibo estende `ProjectionReceipt` com `state`, `items` e `delivery:UNCONFIRMED`.
Os estados por item são APPLIED_HOST, REMOVED_HOST, ALREADY_PRESENT, ALREADY_ABSENT,
UNSUPPORTED, FAILED e PENDING. Estados gerais: APPLIED_HOST, UNCHANGED, PARTIAL,
PENDING, REJECTED ou FAILED. Uma falha de host/banco/sessão retorna UNSUPPORTED
com motivo sanitizado e progresso disponível; o chamador decide repetição.
`onAck()` permanece sem eventos: o cliente atual não fornece confirmação.

## Registro durável e recuperação

A migration `0003_gc_spell_projection.sql` adiciona somente duas tabelas próprias:
`gc_spell_projection_heads` guarda o conjunto publicado e a conclusão; a revisão
fica dentro do conjunto. `gc_spell_projections` guarda personagem, StableFormKey,
DefinitionRef, RevisionVector, `owned` e `active`. Nunca grava FormID de runtime,
actorId, userId ou epoch. As tabelas não são fatos de domínio nem ledger de comandos.

O port valida conteúdo/revisão também contra o banco: revisão menor ou incomparável
é recusada; mesma revisão com outro conjunto é conflito. Mesma revisão concluída
não faz nenhuma chamada ao host, inclusive de leitura. Pendência antes do ator pronto
fica em memória, sem registrar aplicação no banco; a origem durável já foi gravada
pelo dono. Na reconexão o dono pode republicar o conjunto atualizado. Sem publicação
nova, o último conjunto registrado é reconciliado, e não inferido dos records/save.
O slice deve republicar fatos mais recentes que o último registro de projeção.

Cada personagem tem fila local e advisory lock de sessão PostgreSQL no namespace
exato da B3. A conexão permanece reservada, mas **não há transação aberta durante
chamada ao host**. Após cada item aplicado/preservado, uma transação curta da B3
registra esse item e o conjunto com `complete=false`. A última marca conclusão.
Uma falha após uma remoção não repete a remoção no retry. Concorrentes leem o
progresso sob a mesma trava. Personagens distintos não compartilham essa trava.
Não invocar o port dentro da transação do dono (a origem já deve estar commitada).
Itens fora dos kinds spell/ability/power têm resultado terminal UNSUPPORTED na
B5a e não impedem marcar conclusão dos itens SPEL; repetir essa revisão também
não chama o host. Lacunas de catálogo deixam a projeção incompleta para retentativa.

`identity.isCurrent` é conferido depois de cada await e antes de cada chamada ao
host/query de projeção. Shutdown cancela assinaturas e espera tarefas, sem revogar
grants no jogo. Rollback/unlock/release continuam mesmo após desconexão. Um comando
SQL já enviado não é cancelável: desconectar durante COMMIT pode deixar progresso
commitado, mas não autoriza operações posteriores. Retry reconcilia o registro.

## Feitiços externos e estado real

O host lê os aprendidos em memória por Actor.GetSpellCount/GetNthSpell, síncronos.
GetNthSpell retorna `{type:'espm',desc:'<local>:<plugin>'}`; resolve-se o descriptor
no host, sem persisti-lo. Fonte: PapyrusActor.cpp:682–753, PapyrusUtils.h.
Não existe binding learnedSpells em PropertyBindingFactory.cpp, e HasSpell não está
registrado em PapyrusActor::Register. GetSpellCount/GetNthSpell excluem NPC/RACE
base; `AddSpell=false` também indica feitiço herdado ou já conhecido. Falha/formato
errado na leitura é UNSUPPORTED e impede mutação; não simula uma lista vazia.

Regra conservadora: `owned=true` somente quando AddSpell retorna true e o registro
é gravado, ou quando uma linha ativa já confirma essa autoria. Feitiço presente antes
do Core, herdado, ou encontrado após adição sem registro fica `owned=false`.
Revogar o Core muda sua linha para inativa, preservando o feitiço no host. Essas linhas
protegidas permanecem como tombstones para não serem reclamadas na próxima concessão.
Se faltar um feitiço protegido enquanto é concedido, ele é readicionado e continua
protegido. Registro ativo com autoria comprovada é removível; o resto nunca é removido.

Queda entre AddSpell e gravação perde a prova de autoria. A próxima reconciliação
converge ao conjunto desejado, mas conserva a adição incerta mesmo após revogação.
Não se pode distinguir essa adição de um grant externo somente pela lista nativa.
Um grant externo surgido **depois** de uma adição registrada do Core também não é
observável; serviços externos que compartilhem concessões precisam usar ActorState.
Essas limitações estão no CapabilityReport; não se inventa provenance a partir do save.

AddSpell/RemoveSpell alteram `MpChangeForm.learnedSpells` (MpActor.cpp:194–205) e
enviam snippets sem retorno ao cliente (PapyrusActor.cpp:559–644, SpSnippet.cpp).
O save do SkyMP continua como consequência nativa. No spawn, MpActor.cpp:378 envia
learnedSpells, e remoteServer.ts:458,584,1000 remove/reaplica a lista após update e
loadGame. O port não modifica esse código. Se o host tem o feitiço mas o cliente
perdeu a aplicação no carregamento, a enumeração nativa não detecta isso.

O único sinal disponível continua PARTIAL/ONLINE_DELAY_APPROXIMATION da B1.
Reconciliação reaplica só o que falta **no host**; não usa remove/add para forçar
reenviar algo já presente. Não certifica entrega no jogo. O spike mantém seu caminho
provisório separado até C1; nenhuma das suas fontes ou flags foi alterada.

## Aceite do revisor e B5b

Na raiz do Core, fora do sandbox, com somente AETHERIUS_TEST_DATABASE_URL:

```powershell
node runtime/review-projection.mjs <workspace> <nova-pasta-de-evidencia> <porta-UDP-livre-exceto-7777> <FormID-local:plugin-da-cell-ou-world>
```

O harness verifica a porta antes de iniciar, usa pasta nova, schema isolado de
aetherius_test, pool real `core/pg.js`, addon real e catálogo reconciliado. Cria um
ator isolado pela API nativa (identidade controlada de teste, sem fingir login),
projeta, repete, troca, preserva grant externo e confere pelo próprio host. Remove
ator/schema ao terminar. Não testa cliente/jogo. Apenas sintaxe foi executada por Sol.

B5b precisa de mudanças pequenas nestes pontos, mantendo contrato e feature flag:

- Server: `server_guest_lib/MpActor.{h,cpp}` e `MpChangeForm`/serialização: conjunto
  gerenciado de perks, ranks, revisão e geração de spawn, envio inicial e deltas.
- Server: `addon/ScampServer.{h,cpp}` e `property_bindings/`: API de projeção de perks
  e evento de readiness/ACK validado. Uma leitura HasSpell nativa que inclua base
  simplificaria a enumeração, mas não resolve autoria externa.
- Server: mensagens/protocolo e `server_guest_lib/ActionListener.{h,cpp}`: validar
  remetente, ator associado, geração de spawn e revisão exata antes de expor ACK.
- Client: `client/src/services/services/remoteServer.ts`, mensagens e
  `client/src/sync/spell.ts`: sinal após aplicação de spawn/loadGame e grants,
  confirmação do conjunto/revisão, rejeição de deltas antigos; preservar spells
  externos ao gerenciado quando substituir o removeAllSpells histórico.
- Client: reconciliador de perks/ranks e cutover dos writers `sweetTaffy*Perks` e
  `clientPerkApplier` somente quando o novo writer estiver ativo. B5b certifica
  entrega, nunca dano/cura/custo/resultado de efeitos.
# Atualização C2

Concessões RACE descrevem entrega pelo record e não geram AddSpell/RemoveSpell.
O conjunto completo conserva suas origens; `portGrantSet` exclui os records
nativos e todas as outras origens desses records. Records raciais da cabeça
anterior também são preservados na transição. O runtime fornece os vínculos da
aparência atual antes da reconciliação no reconnect, para proteger uma nova raça
ainda não persistida. Bookkeeping anterior de autoria do Core é abandonado sem
remover o spell quando ele passa a ter entrega racial. A observação racial usa
`ActorComposition.inspect` e não solicita entrega ao port. Contratos e ActorState
permanecem os da fundação. Detalhes em `modules/race-system/README.md`.

## Atualização B5b (supersede as pendências de perks/readiness acima)

O mesmo `SpellProjection` continua sendo a única implementação de
`GrantProjectionPort`. Seu adaptador interno `PerkDelivery` usa `CustomPacket`
existente; SPEL mantém o caminho nativo B5a. Nenhum contrato compartilhado,
writer de actor values, inventário ou cálculo de dano foi alterado.

`GAMEPLAY_CORE_CLIENT_PERKS_MODE=off` é o padrão. `active` e `canary` habilitam
a conversa, somente depois da migration 0008. `audit`/`shadow` não publicam.
Cliente antigo conserva `ONLINE_DELAY_APPROXIMATION`, explicitamente parcial.
Cliente que envia begin passa a depender exclusivamente do ready desafiado.
O ACK certifica as chamadas conhecidas de spawn, nunca o estado físico do motor.

Protocolo e operação: [integração do cliente](../../../integrations/client/LEIA-ME.md)
e [ativação](../../../docs/operations/ATIVACAO_DOS_SISTEMAS.md).
O ACK do port informa apenas itens PERK; `reason` declara isso explicitamente.
A entrega dos feitiços continua `UNCONFIRMED`. Nenhum ACK sintético é emitido.

O registro `gc_perk_projections` contém CharacterKey, StableFormKey, definição,
revisão, autoria e atividade. Só um ACK exato e atual confirma aplicação e grava
autoria, numa transação do pool existente. Não contém epoch, userId, actorId,
desafio, índice de plugin ou FormID runtime. Um item preexistente é protegido
permanentemente; registros sem autoria nunca autorizam remover. No reconnect,
autoria confirmada pelo servidor permite recuperar o conjunto gerenciado do save;
presença sozinha nunca concede autoria. Adição sem ACK seguida de restart é
preservada como externa, mesmo que deixe um perk antigo no save.

Cada publicação leva conjunto completo de ensures e remoções autorizadas;
o cliente realiza só a diferença. Rank > 1 requer a ocorrência auditada do record
distinto em classes.json. Não repete AddPerk para fabricar rank. RACE e perks
aplicados pelos MGEF das pedras são suprimidos na entrega separada, mesmo quando
outra origem também lista o record. A composição conserva todas as origens.

`ClientDelivery` valida JSON UTF-8 até 65536 bytes, canal/versão/forma exatos,
usuário do callback nativo, mapa bidirecional usuário/ator, binding e identidade
oficial atuais, ciclo, desafio, id da publicação, revisão completa e cada item.
São até 512 itens, quatro begins por dez segundos e 256 ciclos por binding.
Um listener nativo permanente com assinantes descartáveis evita duplicação em
reload. Novo begin/respawn/desvínculo invalida readiness e publicação anteriores.
Timeout de ACK: 10 segundos; permanece `SENT_UNCONFIRMED`, e a próxima
reconciliação envia novo id. Confirmação repetida/expirada/fora de ordem não grava.
Sem gatilho de reconciliação não há retry automático em laço.

Limites observáveis: concessões externas posteriores à adição do Core são
indistinguíveis na API; post-load, ranks esparsos e persistência real no save
precisam de jogo. Load local que não pertence ao spawn instrumentado invalida o
ciclo e deixa readiness indisponível até novo spawn, pois suas tarefas são desconhecidas.
