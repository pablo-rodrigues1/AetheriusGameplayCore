# D2 — Banco

Estado: **decidida** pelo dono do projeto (06/10/2026, revista em 07/10/2026).

## Contexto

O gamemode do `aetherius-server` usa dois bancos: MySQL nos serviços legados (`database.js`) e PostgreSQL nos mais novos (`core/pg.js`, usado pela sobrevivência). O login em TypeScript do host tem um pool PostgreSQL próprio. Chegou-se a planejar o port de todo o gamemode para PostgreSQL; em 07/10 isso foi tirado do escopo.

## Decisão

- Os fatos novos dos sistemas de efeitos (pedra escolhida, classe, devoção, feitiço aprendido e semelhantes) são gravados no PostgreSQL, em tabelas novas e próprias do Core.
- O Core usa o pool que o gamemode já tem (`core/pg.js`, obtido por `init()`), e constrói sobre ele o suporte a transação. Não cria outro pool.
- O gamemode legado não é portado. O Core não lê nem escreve tabela legada, nem as do site e do painel.
- Desenvolvimento e teste usam somente o PostgreSQL local. Nenhuma conexão ao banco oficial.

## Consequências

- Não existe transação que envolva dados do Core e dados legados. Isso é aceitável porque nenhum sistema do escopo depende de inventário, ouro ou economia.
- As migrations do Core são a única fonte do seu schema e precisam subir um banco vazio do zero; são entregues ao dev do servidor final com instruções de aplicação e reversão.
- `core/pg.js` só expõe `query`. O helper de transação (fundação B3) usa `init().connect()` (spike S1, nota 3; spike S2).

## Evidência

Auditoria A1, item 1; revisão do spike S1; spike S2 (transação com trava por personagem sobre o pool existente, 8 testes contra PostgreSQL real).
