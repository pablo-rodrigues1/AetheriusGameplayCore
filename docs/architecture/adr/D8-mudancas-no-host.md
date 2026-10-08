# D8 — Mudanças em server e client, e como o pacote é instalado

Estado: **decidida** pelo dono do projeto em 07/10/2026.

## Contexto

`aetherius-server` e `aetherius-client` são os repositórios oficiais do servidor, mantidos por outra pessoa, e recebem commits com frequência. O Core precisa de algumas capacidades que eles ainda não expõem. Painel, site, inventário e os serviços legados do gamemode estão fora do escopo.

O dono do projeto determinou: as mudanças podem ser feitas localmente; no momento do commit na `main` do `AetheriusGameplayCore`, precisa estar explícito e documentado o que fazer para instalar o pacote completo, sem perder as alterações mais recentes que existirem no `aetherius-server` e no `aetherius-client` oficiais.

## Decisão

1. **O Core só altera o host para expor capacidade.** Uma Host API pequena, por port. Regra de gameplay nunca vai para o host. Nenhum serviço legado do gamemode é alterado.
2. **Nada é commitado nos repositórios oficiais por este trabalho.** As mudanças em server e client são desenvolvidas localmente e viajam dentro do `AetheriusGameplayCore`, como um pacote de integração.
3. **O pacote de integração é aplicado por cima do estado oficial mais recente.** Ele não substitui arquivos inteiros do host: aplica alterações pequenas e localizadas sobre o que estiver no GitHub oficial no dia da instalação. O que o mantenedor tiver mudado desde então é preservado.
4. **O commit na `main` do Core só acontece com o guia de instalação completo e testado.** Sem o guia, não há commit.
5. **Toda capacidade nova é ligada por configuração** e, desligada, deixa o comportamento do servidor idêntico ao de antes.

## Forma do pacote

No `AetheriusGameplayCore`:

```text
integrations/host/
  INSTALL.md                 guia passo a passo, do zero ao servidor rodando
  install.ps1                aplica o pacote e confere o resultado
  verify.ps1                 confere uma instalação existente
  server/
    patches/NNNN-*.patch     uma alteração por arquivo do host, na ordem de aplicação
    new-files/               arquivos novos, copiados como estão
    BASELINE.txt             commit oficial sobre o qual o pacote foi testado
  client/
    patches/, new-files/, BASELINE.txt
dist/aetherius-gameplay-core.cjs   o Core compilado
database/migrations/               o schema do Core, versionado
```

## O que o `INSTALL.md` precisa conter

1. Pré-requisitos e versões exatas do toolchain (incluindo o ajuste do Visual Studio descoberto na ordem A8).
2. Como obter o estado **mais recente** dos dois repositórios oficiais, e que o pacote é aplicado sobre ele, não sobre uma cópia antiga.
3. A execução do `install.ps1`, que para cada patch:
   - tenta aplicar sobre o estado atual (`git apply --3way`);
   - se o arquivo do host mudou no trecho tocado, para e mostra o conflito, o patch e a explicação do que aquela alteração faz, para resolução manual;
   - nunca sobrescreve um arquivo do host por inteiro.
4. A lista de cada ponto tocado no host, com o motivo, para o caso de aplicação manual.
5. Como compilar o servidor e o cliente depois de aplicar.
6. Como aplicar as migrations do Core no banco, conferir e reverter. Nenhuma migration altera tabela que já existe.
7. Como ligar cada sistema por flag, na ordem recomendada, e como desligar.
8. Como conferir que a instalação funcionou (`verify.ps1` e o roteiro em jogo).
9. Como atualizar depois: o que fazer quando o oficial recebe commits novos (reaplicar o pacote) e quando o Core recebe versão nova.

## Como o pacote resiste a mudanças no host

- Os pontos de contato são poucos e pequenos. Medido até aqui: 46 linhas em `phase0-basic.js` para carregar o Core, 3 no `.env.example`, e 31 linhas em arquivos C++ existentes para o dano em shadow. O resto são arquivos novos, que não colidem com nada.
- Cada patch toca um arquivo e vem com a descrição do que faz, de modo que um conflito possa ser resolvido por quem não escreveu o código.
- A cada versão do pacote, o `BASELINE.txt` registra o commit oficial sobre o qual ele foi testado, e a aplicação é testada de novo sobre o commit oficial mais recente antes de qualquer commit no Core.
- O precedente no próprio repositório é `integrations/ui-runtime-changes`, que já guarda alterações de server e client como patches sobre baselines. O pacote novo segue a mesma ideia, com instalador e guia.

## Host API ainda necessária, por prioridade

| Capacidade | Para quê | Tamanho estimado |
|---|---|---|
| Sinal de ator pronto após o spawn | reconciliar concessões sem temporizador | pequeno a médio |
| Aplicar e remover perks no cliente a partir do conjunto do servidor | classes e raças | grande |
| Confirmação de entrega da projeção | saber que o cliente aplicou | médio |
| Desligamento dos módulos na recarga do gamemode | não duplicar ganchos | pequeno |

O caminho do ator para o `profile_id` já existe no host (`mp.get(actorId, 'profileId')`) e foi usado no teste em jogo.

## Consequências

- O cliente oficial instalado pelo launcher pode ser mais novo que o repositório (em 07/10 a versão v0.13.0 instalada diferia do último commit público). O guia precisa dizer sobre qual fonte o cliente é compilado.
- O launcher reescreve a configuração do cliente; isso só afeta o ambiente de teste local, não a instalação oficial.
- A aprovação das mudanças pelo mantenedor da base continua sendo recomendável antes da instalação no servidor oficial.

## Evidência

Auditoria A1 (tabela de ports); revisões dos spikes S1, S2 e S3; sessão em jogo de 07/10/2026.
