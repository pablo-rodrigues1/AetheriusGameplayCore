# D8 — Mudanças em server e client

Estado: **proposta**. Aguarda aprovação no gate G-ARQ.

## Contexto

`aetherius-server` e `aetherius-client` são mantidos por outra pessoa e recebem commits com frequência. O Core precisa de algumas capacidades que eles ainda não expõem. Painel, site, inventário e os serviços legados do gamemode estão fora do escopo.

## Decisão proposta

1. O Core só altera o host para expor capacidade: uma Host API pequena, por port. Regra de gameplay nunca vai para o host.
2. Nenhum serviço legado do gamemode é alterado. As mudanças no gamemode se limitam ao descriptor que carrega o Core.
3. Até o G-ARQ, as mudanças vivem na árvore de trabalho local, sem commit. Depois, em branch própria por repositório, sobre um commit identificado da base.
4. A entrega ao dev do servidor final é a branch, a série de patches equivalente e a lista de arquivos alterados, com instruções de build e de ativação por flag. Se a base tiver avançado, o rebase é nosso.
5. Toda capacidade nova é ligada por configuração e, desligada, deixa o comportamento idêntico ao de antes.

## Tamanho medido até aqui

| Mudança | Onde | Tamanho |
|---|---|---|
| Carga do Core | `server/gamemode/phase0-basic.js`, `.env.example` | 46 linhas e 3 linhas |
| Dano em shadow | `ScampServer.cpp`, `server/cpp/CMakeLists.txt`, mais 14 arquivos novos | 31 linhas em arquivos existentes |

## Host API ainda necessária, por prioridade

| Capacidade | Para quê | Tamanho estimado |
|---|---|---|
| Sinal de ator pronto após o spawn | reconciliar concessões sem temporizador | pequeno a médio |
| Caminho direto do ator para o perfil autenticado, com epoch | chave de personagem (D1) | médio |
| Aplicar e remover perks no cliente a partir do conjunto do servidor | classes e raças | grande |
| Confirmação de entrega da projeção | saber que o cliente aplicou | médio |
| Desligamento dos módulos na recarga do gamemode | não duplicar ganchos | pequeno |

## Consequências

- As mudanças precisam ser combinadas com o mantenedor da base antes da entrega, para não colidirem com o trabalho dele.
- O cliente passa a depender do servidor para perks; as listas embutidas no cliente saem.

## Evidência

Auditoria A1 (tabela de ports); revisões dos spikes S1, S2 e S3.
