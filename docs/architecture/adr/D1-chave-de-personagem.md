# D1 — Chave de personagem

Estado: **decidida** pelo dono do projeto em 07/10/2026: a identidade usada pelo jogo é o `profile_id`.

## Contexto

Todo fato durável do Core (pedra, classe, devoção) precisa de uma chave de personagem que sobreviva a sessão, reconexão e reinício. O que o host oferece hoje:

| Identificador | De onde vem | Limite |
|---|---|---|
| `userId` | posição da conexão | vale só durante a conexão |
| `profileId` | login por token (`users.profile_id`); no modo offline, informado pelo cliente | identifica a conta, não o personagem |
| `actorId` | o spawn reaproveita o primeiro ator do perfil ou cria um | FormID de runtime |
| id de personagem | whitelist, no MySQL legado | fora do escopo deste trabalho |

O spawn nativo trabalha com um ator por perfil. O modo local de desenvolvimento fabrica um personagem com id igual ao perfil. Tabelas de conta, personagem e whitelist pertencem ao site e ao painel e não podem ser alteradas.

## Referência da plataforma

A documentação da API do Aetherius (`referencia\ARCHITECTURE.md` e `referencia\API_REFERENCE.md` no workspace) confirma o modelo: a tabela `users` tem `id` (UUID) e `profile_id` (número, por exemplo 104), e é o `profile_id` que o login devolve e que o servidor de jogo usa. Existe também uma tabela `characters` (fichas de personagem, com id próprio), que a API de administração lista por usuário. O servidor de jogo, porém, não usa essa tabela: o spawn trabalha com um ator por `profile_id`.

## Opções

1. **Usar o perfil como chave**, com prefixo: `profile:<profileId>`.
2. **Usar o id de personagem do MySQL legado**, somente para leitura.
3. **Criar uma tabela de personagens própria do Core.**

## Decisão

Opção 1, com o nome que a plataforma usa. A identidade é o `profile_id`; nos dados do Core ela é gravada como `profile:<profile_id>`, obtida por um `IdentityPort` que só a entrega depois do login validado pelo host e que amarra a sessão a um epoch.

- A opção 2 faz o Core depender de um banco e de tabelas que estão fora do escopo.
- A opção 3 cria um segundo cadastro de personagens, em conflito com o do painel.
- O prefixo deixa a porta aberta: se o servidor passar a ter mais de um personagem por conta, entra uma chave `character:<id>` e uma migration que reatribui os fatos, sem ambiguidade com as chaves antigas.

## Consequências

- Enquanto houver um personagem por conta, os fatos seguem o personagem corretamente.
- No modo offline, o `profileId` vem do cliente. O `IdentityPort` precisa marcar essa sessão como não autenticada, e as features decidem se a aceitam; no servidor oficial, só sessão validada por token.
- O spike S2 descobriu a chave varrendo perfis de 1 a 50, o que não serve para produção. O port precisa de um caminho direto do ator para o perfil; a auditoria estimou essa Host API como média.
- Os contratos já separam `ProfileKey` de `CharacterKey` no tipo, então a troca futura de chave não se espalha.

## Evidência

Auditoria A1, item 1; revisão da A1 (seção D1); contratos da A5; spike S2 (nota 3 da revisão).
