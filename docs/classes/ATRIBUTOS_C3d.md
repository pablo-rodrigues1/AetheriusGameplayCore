# Pontos de atributo — contrato C3d

Contrato para o integrador do AetheriusUI Core, atualizado pela C3d-fix1 em 12/10/2026. Código e testes do Core entregues; compilação do host e harness nativo aguardam o revisor. A tela e a homologação serão feitas no servidor oficial pelo desenvolvedor responsável. Não houve ativação no ambiente local. O bloqueio da entrega parcial está supersedido por esta retomada; seu relatório histórico permanece em _work/orders/C3d-pontos-de-atributo.result.md.

## Intenção e leitura

A tela solicita `core.attributeState(binding)` e envia `core.allocateAttributes({binding, requestId, health, magicka, stamina})`. Os três valores são acréscimos de pontos: inteiros não negativos, múltiplos de 5, soma positiva. Um ponto acrescenta uma unidade ao máximo. A tela nunca fornece nível, saldo ou máximos finais. O adaptador do servidor obtém o binding autenticado atual; não aceita um binding escolhido pelo cliente. O transporte da tela será integrado depois e não muda o protocolo de grants existente.

Reutilize requestId ao repetir a mesma intenção após perda de resposta. Se alterar os acréscimos, use outro requestId. O comando é serializado pelo lock de CharacterKey e lê nível/saldo dentro da mesma transação.

A leitura contém:

| Campo | Significado |
|---|---|
| classId | classe escolhida, ou null |
| level / levelOrigin | nível efetivo e origem LEVELING, LEVELING_DEFAULT ou DEV (apenas no desenvolvimento autorizado) |
| earned | 15 × (level − 1); nível 1: 0; nível 40: 585 |
| spent / spentTotal | pontos acumulados em health, magicka e stamina / soma |
| available | earned − spentTotal, calculado; não é coluna no banco |
| revision | revisão da distribuição |
| applicable / reason | se a distribuição pode ser aplicada e motivo da recusa |
| maximum / baseMaximum | máximo esperado / máximo dos records do host, incluindo offsets do NPC |
| maximumOrigin | CLASS_ADDITIVE, RECORDS ou DEV |
| host | status e máximo/origem observados no host; entrega pode ainda estar pendente |

Sem propriedade nativa ou sessão oficial, status é UNSUPPORTED, maximum/baseMaximum são null e host.reason identifica a ausência. A ferramenta offline não calcula máximos apenas da raça, porque faltariam offsets do NPC. Com distribuição inválida ou acima do ganho, a leitura é UNSUPPORTED; com host disponível, maximum mostra os records sem bônus e host.maximum informa separadamente o valor observado.

## Resultado e recusas

A resposta do comando distingue `committed`, `receipt` durável e `projection/state`. Aceitação durável não certifica entrega ao jogo: confira projection.status e state.host.status mesmo quando committed=true. Uma falha depois do commit pode retornar UNSUPPORTED com committed=true; repetir o mesmo requestId recupera a receipt e tenta projetar novamente. Epoch antigo não publica.

| Motivo | Ação da tela/integrador |
|---|---|
| ATTRIBUTE_POINTS_INVALID | corrigir intenção: inteiros não negativos, blocos de 5, soma positiva |
| ATTRIBUTE_POINTS_INSUFFICIENT | reler saldo; nunca reduzir pedido automaticamente |
| CLASS_REQUIRED | escolher classe antes de distribuir |
| ATTRIBUTE_ALLOCATION_INVALID | distribuição persistida inválida; não aplicar bônus nem corrigir dados silenciosamente; encaminhar ao responsável |
| ATTRIBUTE_ALLOCATION_EXCEEDS_LEVEL | gastos maiores que o ganho atual; não aplicar bônus; preservar distribuição e saldo derivado negativo |
| REQUEST_ID_REUSED | requestId já pertence a outro conteúdo; não repetir com conteúdo alterado |
| MODE_OR_STALE_BINDING | obter binding atual; respeitar modo active/canary |
| DEV_SWEEP_IN_PROGRESS | aguardar término da varredura de desenvolvimento |
| ATTRIBUTE_NATIVE_PROPERTY_UNAVAILABLE / ATTRIBUTE_NATIVE_DELIVERY_UNAVAILABLE / OFFICIAL_SESSION_REQUIRED | capacidade ou sessão ausente; apresentar indisponibilidade explícita |

O banco usa `0009_gc_attribute_allocation.sql`: text PRIMARY KEY para character_key, integer NOT NULL para os três gastos, bigint NOT NULL para revisão. Sem CHECK, pela política fixa das migrations. O único writer attributes.allocate valida os valores e a leitura também verifica integridade (inclusive revisão positiva). Uma linha inválida não é alterada pela leitura.

## Classe e host

Troca efetiva de classe zera XP e nível pelo Leveling e apaga a distribuição na mesma transação. A mesma classe e replay não zeram. Fadiga, ciclo e limite diário são preservados. Isso supersede a regra C3a de preservar XP ao trocar. Varredura de desenvolvimento recusa começar com XP ou distribuição gravados (SWEEP_WOULD_RESET_PROGRESS), antes de qualquer comando.

Propriedade nativa transitória `aetheriusAttributeBonuses`: setter recebe {health, magicka, stamina} ou null; getter retorna {base, maximum, origin}. Máximo normal = records + bônus. O host recebe após commit, no vínculo, pronto, renascimento/reconexão; limpeza no desvínculo/shutdown. Hit e tick leem memória. Ausência da propriedade declara UNSUPPORTED e nunca grava substituto customizado. DEV-A1 aceito conserva o override absoluto; bônus normal não se soma.

O host entrega os três máximos ao cliente pelo Actor.SetActorValue existente e publica porcentagens depois dos três ACKs. ACK confirma chamadas; só a homologação confirma as três barras. Regeneração e fórmula de dano não foram alteradas.

## Staff e homologação oficial

`node runtime/allocate-attributes.mjs <pg.js> <profile:id> <vida delta> <magia delta> <vigor delta> [schema] [requestId]` usa o pool do gamemode e o mesmo comando de domínio. É offline: só persiste e retorna delivery=NOT_SENT; reentrada/pronto reidrata. `explain-character.mjs` mostra nível, origem, ganho, gastos, disponível e motivo, sem afirmar máximo/entrega atuais.

O desenvolvedor oficial instala o host recompilado e o bundle revisto, aplica a 0009 pelo runner e integra a tela usando este contrato. Com personagem de teste e nível real suficiente, aloca 5/5/5, confere state e máximos do host, reconecta, confere barras, troca classe e verifica nível 1, XP zero, distribuição vazia e retorno aos records. Definir novamente a mesma classe preserva o estado. Todas as opções DEV devem estar ausentes no oficial; sem fonte de XP certificada, preparar o personagem pelo procedimento autorizado do responsável, sem inventar prêmio de cliente.
