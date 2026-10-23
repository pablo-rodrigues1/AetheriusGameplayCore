# D5 — Encaixe da fórmula de dano

Estado: **decidida em 22/10/2026** pelo dono do projeto, que aprovou o `PLANO_DAMAGE_SYSTEM.md` (workspace) com as decisões Q1–Q6. Substitui a versão de 07/10, que era uma proposta adiada pela prioridade de pedras, raças, classes e religião.

## Contexto

O servidor escolhe a fórmula de dano no boot, como uma cadeia de implementações de `IDamageFormula`. A fórmula vigente é a padrão do SkyMP (`TES5DamageFormula` com quatro decorações sem configuração). Ela usa arma, armadura vestida, os efeitos `DamageResist` do encantamento no record da armadura e a curva nativa (`fArmorScalingFactor`/`fMaxArmorRating`, vencedores do B&BArmorScaling). Multiplica o dano por flags vindas do cliente (ataque forte, bloqueio, furtivo) e não lê perks, skills, têmpera nem buffs. O spike S3 instalou no host a `AetheriusDamageFormula` com perfil neutro, em shadow e desligada.

Levantamento da DS-0: [FONTES_E_DONOS](../../../modules/damage-system/docs/FONTES_E_DONOS.md).

## Decisão

1. **Onde roda.** O cálculo físico roda em C++, no host, como implementação de `IDamageFormula`, sem I/O no hit. O Core (TypeScript) é dono da composição: monta o `CombatProfileProjection` de cada ator (skills, perks compiladas com origem, efeitos constantes, revisão) e o publica pela Host API com troca atômica. Um hit usa uma única revisão do perfil do atacante e da vítima.
2. **Modos por família**, configurados em `server-settings.json`: `off` monta exatamente a cadeia atual; `shadow` aplica a cadeia atual e registra o candidato; `active` aplica o candidato. O rollback é mudar a configuração e reiniciar.
3. **Skills (Q1):** o valor da skill é o do estágio da classe atual, sem bônus de raça. NPC: skill do record.
4. **NPCs (Q2):** entram na fórmula, com perfil do record vencedor (nível, skills, raça, perks e template).
5. **Ataque forte e furtivo (Q3):** o bônus vale quando o servidor confirma o ataque por evento de animação recebido pelo host. Sem confirmação, não há bônus. O ataque forte é confirmável pelo nome do evento (no jogador já guardado pelo host; no NPC exige mudança no host). O furtivo não é: o host não sabe se o alvo detectou o atacante, e agachado não é ataque furtivo. Pela própria regra da Q3, o bônus furtivo fica desligado até existir critério aprovado (pergunta Q9 em FONTES_E_DONOS).
6. **Constantes e curva (Q4):** escala de arma (+0,5 % por nível) e de armadura (+0,4 % por nível) pelos GMSTs vencedores; as perks (Vokrii e as demais) pela semântica do record vencedor, multiplicando-se à escala. A curva de armadura é absoluta: 500 → 80 %, 1000 → 90 %, teto de 90 %.
7. **Linha de base e entrega (Q5):** a comparação do shadow é contra a cadeia padrão do SkyMP. A entrega vai ao repositório do Core com o pacote de integração do host (ADR D8).
8. **Refino (Q6):** a fórmula consulta um `RefinementTierProvider` a cada cálculo e aplica o tier uma vez, na base elegível, sem consumi-lo. O provider instalado é neutro até existir identidade de instância de item.
9. **O que não muda nesta trilha:** dano e cura mágicos, procs ao acertar, stagger, durabilidade e veneno.

## Consequências

- Perks de classe, raça e pedra passam a mudar o dano aplicado pelo servidor, o que hoje não acontece. Perks que o jogador recebe só no cliente (lista do record do jogador, SPID) **não** entram por esta decisão: dependem de medição e da pergunta Q8.
- A contribuição que a linha de base já aplica (encantamento `DamageResist` da armadura) é preservada; perdê-la seria regressão.
- Efeitos que dependem de estado que só o cliente conhece (aparar e ataque direcional dos mods, distância, ângulo) ficam sem aplicar e aparecem na cobertura como `UNSUPPORTED`.
- Confirmar ataque forte de NPC exige que o host registre a animação dos atores hospedados, o que hoje não faz (mudança pequena no host, DS-5).
- O avaliador de condições do host trata condição desconhecida como verdadeira e não é reaproveitado; o DamageSystem traz o seu, restrito às funções certificadas.
- `OnChangeValues` aceita queda de vida informada pelo cliente; antes do `active`, a DS-0b mede se isso é uma segunda origem de dano.

## Evidência

Auditoria A1, itens 3, 6 e 11; spike S3 e sua revisão; ordem DS-0 (`_work\orders\DS-0-fundamentos-do-dano.md`) e as fontes listadas em FONTES_E_DONOS.
