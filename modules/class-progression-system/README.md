# ClassProgressionSystem — classes, perks e atributos (C3a–C3d)

Este módulo implementa os **fatos e comandos autoritativos de classe**, as concessões de perks por marcos e a distribuição de pontos de atributo. Faz parte do runtime consolidado do [AetheriusGameplayCore](../../README.md), e não deve ser confundido com a baseline de interface/grupos em `modules/class-system/`.

## Responsabilidades e contratos

- `src/index.ts`: `classes.set` e leitura de classe, com `CharacterKey`, `SessionEpoch`, `StableFormKey`, persistência idempotente e ledger de comandos compartilhado.
- `classGrants` fornece à composição única os perks de origem `CLASS` dos marcos alcançados. As 18 classes têm 9 marcos cada, nos níveis 1/5/10/15/20/25/30/35/40: **162 marcos e 350 entradas de perks** no [catálogo](../../catalog/classes.json). Não concede automaticamente pré-requisitos ou ranks anteriores.
- [`docs/classes/PERKS_POR_CLASSE.md`](../../docs/classes/PERKS_POR_CLASSE.md) mostra, por classe e nível, os perks e os links `HasPerk` observados; gerar com `node tools/catalog/perks-per-class.mjs`. O rank é um record distinto da cadeia `NextPerk`, não o número de ranks de um único record.
- `src/attributes.ts`: `attributes.allocate`, validação, saldo derivado e leitura autoritativa. O módulo **não** fornece outra fonte de XP, não substitui ActorComposition e não implementa a execução das condições/efeitos dos perks.

## Nível, troca de classe e pontos

`LevelingSystem` é o **único escritor** de XP, nível e fadiga, com adapter em [`modules/leveling-system/src/integration/durable.ts`](../leveling-system/src/integration/durable.ts). O comando de classe consulta o nível existente; `core.awardLevelingXp(input)` é o ponto interno para receber XP provado pelo servidor e solicitar refresh após mudança de nível. **Não existe, nesta entrega, fonte de mortes/XP conectada**: ainda é preciso definir confirmação de abate e destinatários autoritativos.

A regra vigente **C3d substitui a antiga C3a**: trocar realmente de classe **zera XP, nível e pontos distribuídos**, na mesma transação; repetir a mesma classe não zera. Fadiga, ciclo e limite diário são preservados.

Cada nível depois do primeiro concede **15 pontos** (`15 × (nível − 1)`, máximo de 585 no nível 40), distribuíveis em vida, magia e vigor. O comando exige incrementos não negativos inteiros, múltiplos de 5, com soma positiva, disponíveis para gasto; cada ponto soma 1 ao máximo correspondente. A tabela `gc_attribute_allocation` (migration 0009) guarda os gastos e a revisão; o saldo é sempre calculado. Leituras inválidas não se autocorrigem. O contrato de UI, erros e entrega ao host está em [`docs/classes/ATRIBUTOS_C3d.md`](../../docs/classes/ATRIBUTOS_C3d.md).

## Persistência, composição e entrega

- `0006_gc_character_class.sql`: classe escolhida e revisão.
- `0007_gc_leveling_progress.sql`: XP/nível/fadiga pertencentes ao Leveling.
- `0008_gc_perk_projection.sql` (runtime): autoria e entrega confirmada de perks por personagem.
- `0009_gc_attribute_allocation.sql`: distribuição de pontos; nenhuma alteração em tabelas legadas.
- `gc_commands`: recibos idempotentes. `classes.set`, `attributes.allocate` e eventos de XP usam seus respectivos caminhos duráveis, com identidade da sessão oficial.

B5b envia os perks necessários ao cliente por `CustomPacket` e exige ACK antes de confirmar a autoria; diferencia concessões de classe, raça e outras fontes, e evita remover perks anteriores que não pertençam à projeção. A fila atual admite **uma entrega por personagem/ciclo em voo**. Confira [`runtime/src/projection/DELIVERY.md`](../../runtime/src/projection/DELIVERY.md). Confirmação de entrega **não prova execução de efeito nativo**.

A propriedade de host `aetheriusAttributeBonuses` publica os bônus de máximo sobre os records nativos e reidrata em conexão/prontidão; ausente, o resultado é `UNSUPPORTED` (não um valor simulado). O estado/contrato da UI e os detalhes de deploy estão no [guia de instalação](../../integrations/INSTALL.md).

## Varredura DEV e verificação

A varredura **C3b/C3c** exercita as **18 classes / 162 marcos** num ator do ambiente de desenvolvimento; exige opções DEV autorizadas, modo compatível e confirmação da entrega ao cliente. Ela usa nível transitório e não deve ser habilitada no servidor oficial. Rejeita personagens que tenham XP ou pontos gastos com `SWEEP_WOULD_RESET_PROGRESS` para evitar que a troca apague progresso real.

A documentação de [instalação](../../integrations/INSTALL.md) registra **revalidação local em jogo, em 12/10/2026**, com 162/162 passos `OK`, restauração `OK` e `delivery=CONFIRMED` após a correção da fila. Isso valida o protocolo de entrega — **não** cada perk em combate. A implementação C3d tem testes de código e ensaios nativos registrados, mas **a tela de atributos e a implantação oficial ainda exigem homologação**.

Comandos úteis na raiz do monorepo:

```bash
npm ci
npm run typecheck
npm test
npm run build
node tools/catalog/perks-per-class.mjs
```

Os testes de aceitação dependentes de PostgreSQL devem usar apenas o banco descartável `aetherius_test` conforme a configuração de teste. O requisito de Node.js do monorepo é **>=22.14.0**. Esses comandos são instruções, **não** uma afirmação de que foram executados nesta atualização.

Para operação com servidor parado, consulte `runtime/set-character-class.mjs`, `runtime/allocate-attributes.mjs` e `runtime/explain-character.mjs`, sempre seguindo [`docs/operations/ATIVACAO_DOS_SISTEMAS.md`](../../docs/operations/ATIVACAO_DOS_SISTEMAS.md).

> **Histórico:** a baseline C3a inicialmente não possuía entrega B5b nem reset de XP na troca. Essas limitações foram superadas por B5b e C3d; por isso não se deve usar o antigo estado de C3a como comportamento atual.
