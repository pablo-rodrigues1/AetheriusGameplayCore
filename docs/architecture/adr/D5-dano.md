# D5 — Encaixe da fórmula de dano

Estado: **proposta**, com evidência do spike S3. **Adiada** pela prioridade de 07/10/2026: não há novas etapas até pedras, raças, classes e religião funcionarem em jogo.

## Contexto

O servidor escolhe a fórmula de dano no boot, como uma cadeia de implementações de `IDamageFormula`. A fórmula vigente multiplica o dano por três valores que vêm do cliente (ataque forte, bloqueio, furtivo) e não lê perks. O Core tem uma fórmula própria em C++, que não estava compilada no servidor.

## Decisão proposta

A fórmula Aetherius entra como mais uma implementação de `IDamageFormula`, ligada por configuração. Primeiro em shadow: um decorator devolve sempre o resultado da fórmula vigente e registra, em memória, o que a candidata calcularia. A troca efetiva só acontece depois, por família de dano, com rollback por configuração.

## Consequências

- O corte no host é pequeno: 31 linhas em arquivos existentes. Não toca `MpActor`, `PartOne` nem `ActionListener`.
- O custo do shadow é de cerca de 0,2 microssegundo por golpe.
- As duas fórmulas ainda não são comparáveis: a candidata roda com perfil neutro (sem skills, perks, raça) e ignora os valores do cliente. A comparação só passa a significar algo quando o ActorState publicar o perfil de combate, o que depende de raças e classes.
- O avaliador de condições do host trata condição desconhecida como verdadeira e não pode ser reaproveitado.
- O servidor não enumera armas e armaduras; a cobertura de equipamento depende do catálogo (D6).
- Os mods de combate do cliente (For Honor, Reforged Directional Combat, SCSI, Sekiro, DynamicBlockHit) têm parte da semântica em DLL, invisível ao servidor. Cada um precisa de classificação antes de qualquer troca.

## Evidência

Auditoria A1, itens 3 e 11; spike S3 e sua revisão: 140 verificações, boot do servidor local com shadow ligado.
