# DS-5a — bloqueio do contrato de deduplicação

25/10/2026. Levantamento do executor Sol 6.1; não é parecer de revisão nem decisão de arquitetura. Nenhum código de produção da DS-5a foi implementado.

A ordem exige deduplicar o mesmo hit, mas `HitData` é um alias de `HitMessage::Data`. O contrato serializa apenas aggressor, target, source, projectile e quatro flags. Não há identidade, sequência ou identificador do evento. `IDamageFormula::CalculateDamage` recebe esse contrato e os dois atores.

Em `ActionListener::OnWeaponHit`, a proteção existente é temporal: cooldown específico por alvo na janela de splash e `CanHit` pela velocidade da arma fora dela. O host calcula o dano, aplica a vida e só então atualiza `SetLastHitTime`. Isso não fornece à fórmula identidade do golpe original. Depois da janela, dois golpes legítimos com os mesmos campos e uma retransmissão são indistinguíveis nessa interface. Esta é uma conclusão sobre o contrato, não prova de replay ou exploração em execução.

Um cache pelo conteúdo/tempo implementaria uma heurística e poderia rejeitar um golpe novo legítimo ou aceitar uma repetição tardia. Um identificador criado a cada chamada distinguiria chamadas, sem vincular a retransmissão ao golpe original. Nenhum desses mecanismos foi implementado ou declarado como deduplicação completa.

Para retomar, o orquestrador/dono precisa definir a identidade e a janela/semântica de deduplicação, com os caminhos de entrada/aplicação necessários autorizados, ou limitar explicitamente o requisito desta ordem ao comportamento dos cooldowns existentes. `ActionListener.cpp/.h` e `messages/HitMessage.h` não estão nos caminhos de escrita da DS-5a; o cliente é contrato fixo. Não se pressupõe que alterar só um desses arquivos resolva o problema de protocolo.

As pontes A/B continuam decisões da ordem, sem implementação nesta entrega: tabela de combate preparada pelo Core no boot e snapshot de perfil por ator/revisão. O host já expõe campos brutos dos winners por `lookupEspmRecordById`, permitindo estudar a leitura dos GMSTs no boot sem alterar catálogos fixos. A consulta houseCARL nesta sessão confirmou a instância `C:\modOrganizer`, perfil AETHERIUS - GRAFICO - QUALIDADE, epoch `e2-771486e30fc46d2a`; nenhuma instância foi trocada. Não houve alteração/instalação de records.

Evidência reproduzível: `node _work/evidence/DS-5a/audit-boundary.mjs`, saída em `boundary-audit.log`, hashes e verificações em `boundary-audit.json`, trechos em `boundary-source-excerpts.txt`. Build, testes funcionais, casos dourados, benchmark e servidor local não foram executados nesta entrega. Nenhuma família muda de owner, modo, comportamento ou gate. A fórmula vigente permanece intacta.

## Resolução pelo revisor — Adendo 1 (25/10/2026)

**resolvido para a DS-5a pelo adendo 1; pendente para a DS-7**. A parada acima é histórica. A DS-5a não implementa deduplicação própria: reutiliza splash/CanHit; shadow nunca aplica o candidato. Não se afirma unicidade no trace. Identidade real (id/sequência) no HitMessage, com mudança no protocolo do cliente, é pré-requisito da DS-7. As pontes e o cálculo sem perks são descritos na §14 de FONTES_E_DONOS.md.
