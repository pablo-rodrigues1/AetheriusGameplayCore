# D7 — Ordem de implementação

Estado: **proposta**. Reflete a prioridade fixada pelo dono do projeto em 07/10/2026. Substitui a seção 13 da arquitetura canônica e as fases F0–F12 do planejamento de 02/10.

## Contexto

A arquitetura de 05/10 ordenava as fases como F0 a F12 (com Enemy, Leveling, Durability e o cutover de dano antes de magia). O prompt de fundação propunha outra ordem. O dono do projeto fixou a prioridade: fazer funcionar o que o jogador usa diretamente.

## Decisão proposta

```text
Fase A  Arquitetura: auditoria, exports, contratos, spikes, ADRs      -> gate G-ARQ
Fase B  Fundação mínima: runtime, catálogo, persistência,
        ActorState, projeção de concessões                             -> gate G-FUND
Fase C  Sistemas do jogador, nesta ordem:
        C1  Pedras guardiãs
        C2  Raças
        C3  Classes, com os feitiços e perks que cada classe concede
        C5  Religião
Depois  Perks fora das classes (C4), feitiços fora das classes (C6),
        troca da fórmula de dano (trilha D)
Fase H  Homologação em jogo no servidor local, a cada gate
Fase E  Entrega: código e documentação ao dev do servidor final
```

Regras:

- Uma fase só começa com o gate anterior cumprido, e gate exige evidência gravada; evidência em jogo é do dono do projeto.
- Cada sistema percorre o mesmo caminho: fato durável, concessão com origem, projeção no cliente.
- O servidor é autoridade de quem tem o quê desde o primeiro slice. A autoridade sobre o resultado (dano, cura, custo) é assumida por família, depois, e o que não foi assumido fica declarado como calculado pelo cliente.
- Não há commit antes do G-ARQ.

## O que saiu

Port do gamemode para PostgreSQL, inventário, economia, painel e site; e, da ordem antiga, Enemy, Durability e Leveling como fases próprias. O Leveling só entra no que as classes precisarem (um único dono de XP e nível).

## Evidência

Plano de integração, seções 0, 0.1 e 5; classificação A3 (dos 5.284 perks e feitiços, cerca de 20% o motor resolve sozinho, 25% precisam de adapter e 32% dependem de Papyrus), que sustenta a separação entre concessão e resultado.
