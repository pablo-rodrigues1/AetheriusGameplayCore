# D4 — Projeção de concessões no cliente

Estado: **proposta**, com evidência do spike S2. Aguarda aprovação no gate G-ARQ.

## Contexto

O servidor decide quais perks, feitiços e habilidades cada personagem tem. Para o jogador sentir o efeito, isso precisa chegar ao motor do jogo no cliente. O que existe hoje:

- Feitiços: o servidor guarda uma lista de feitiços aprendidos no save do SkyMP (por FormID de runtime) e a envia no spawn. O cliente remove todos os feitiços e reaplica a lista.
- Perks: o servidor não guarda nada. O cliente aplica perks por conta própria, a partir de listas embutidas.
- Não há noção de origem: não se sabe por que um personagem tem um feitiço.

## Decisão proposta

1. **A memória que manda é a do Core.** As tabelas do Core guardam os fatos; o conjunto de concessões é recalculado deles. A lista de feitiços do save do SkyMP passa a ser consequência, reconciliada a cada spawn.
2. **Toda concessão tem origem** (`CLASS`, `RACE`, `STANDING_STONE`, `RELIGION` e as demais dos contratos). Revogar uma origem não remove o que outra origem também concede.
3. **Um único `GrantProjectionPort`**, que recebe o conjunto completo por revisão e aplica só a diferença. Nunca "remover tudo".
4. **A reconciliação é disparada por um sinal do host** de que o ator está pronto depois do spawn, e não por temporizador.
5. **Perks precisam de caminho novo no cliente**: o cliente aplica e remove perks a partir do conjunto que o servidor envia, e deixa de usar listas próprias.

## Consequências

- A Host API da projeção é a maior do conjunto: sinal de ator pronto, aplicação de perks no cliente, confirmação de entrega. A auditoria a estimou como grande.
- Confirmação do cliente é evidência de entrega, não de resultado.
- Se o banco falhar depois de o servidor vetar a ação nativa (por exemplo, a ativação de uma pedra), o jogador precisa de retorno visível.
- Efeitos que dependem de um perk que nenhum record liga à origem ficam `UNSUPPORTED` até a ligação ser declarada. Primeiro caso: o bônus de corrida da pedra do Corcel, aplicado por perk do Mundus.

## Evidência

Auditoria A1, itens 4 e 5; spike S2 e sua revisão: caminho fechado em código com 8 testes contra PostgreSQL real; projeção pós-spawn dependente de temporizador de 3 segundos; evidência em jogo pendente.
