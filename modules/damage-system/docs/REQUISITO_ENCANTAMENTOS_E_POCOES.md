# Requisito para encantamentos e poções: magnitude no próprio item

> **Leia antes de implementar encantamento, alquimia ou qualquer item/poção criado por jogador no servidor.**
> O DamageSystem foi desenhado ASSUMINDO o comportamento descrito aqui. Ele ainda não existe: este documento é o requisito que a
> implementação dos encantamentos e das poções deverá cumprir para que o dano funcione. Decisões do dono do projeto em 24/10/2026
> (Q15 e Q16 em `PLANO_DAMAGE_SYSTEM.md` §6, no workspace de integração).

## 1. Situação atual

- A funcionalidade de encantar itens e criar poções **não está desenvolvida no servidor**. Não se sabe ainda como ela se comporta no
  contexto do SkyMP.
- O que já foi observado: o host guarda, por item no inventário, o **código do encantamento** (`enchantmentId`, visto na sonda de
  combate). **Não está confirmado** se ele guarda a **magnitude** do efeito.
- Criação de itens e poções (crafting) é de outro domínio e fica fora do escopo do DamageSystem. O DamageSystem só **lê** o que esse
  domínio guardar.

## 2. O cenário que o DamageSystem assume (cenário ideal, decisão do dono: opção A)

A força de um encantamento ou de uma poção **não é fixa**: depende de quem a criou (skill de Encantamento ou Alquimia, perks, gema de
alma). Um "Fortify One-handed" pode valer 12% num anel e 31% em outro. Por isso:

1. **A magnitude real fica no próprio item ou poção**, guardada pelo servidor no inventário autoritativo, por instância, no momento em
   que o item é criado (ou ao vir pronto de um record vencedor: loot, vendedor).
2. **O servidor calcula sozinho** a partir desse dado. Nunca usa um valor enviado pelo cliente (AGENTS.md §3.1: o cliente envia
   intenção e evidência, nunca valor final).
3. **Nunca usa valor estático** de record ou da descrição do mod quando o item foi criado por jogador.

## 3. O que a implementação dos encantamentos e das poções DEVERÁ fazer

Para que o dano funcione, quem implementar encantamento/alquimia no servidor precisa garantir:

- **Persistir por instância de item/poção**: o encantamento ou a lista de efeitos, e para cada efeito a família (MGEF/ActorValue), a
  **magnitude real**, a duração (poções) e a área, na forma estável (StableFormKey para records; instância criada com identidade
  persistente, nunca FormID de runtime).
- **Expor esse dado ao DamageSystem** por uma porta de leitura (somente leitura), para que o estado de combate do ator possa somar os
  efeitos ativos.
- **Sinalizar quando o efeito entra e sai**: vestir/tirar item encantado (o host já sabe o equipamento), consumir poção e fim da duração.
- **Não confiar no cliente** para a magnitude nem para a duração.

## 4. Como o DamageSystem usa (já desenhado)

- Cada família de efeito de combate físico é **uma variável no estado de combate do ator**: bônus de dano com uma mão, com duas mãos,
  com arco, desarmado, em ataque forte, em golpe de escudo, bônus de armadura, de bloqueio e as resistências do escudo ao bloquear
  (lista filtrada na Q15).
- Quando um efeito entra em vigor, a magnitude real da instância é **somada** à variável; quando sai, é **subtraída**. A fórmula lê só
  a variável: não há número fixo na fórmula.
- Enquanto o dado de magnitude não existir no item, a família fica **UNSUPPORTED declarada** (sem fallback, sem valor inventado).
  Itens e poções que vêm prontos de records vencedores (ENCH/ALCH) podem usar a magnitude do record.

## 5. Arma e armadura encantadas: dano base

Arma ou armadura encantada tem o **mesmo dano/rating base** da versão não encantada (o item de template). O encantamento é só um efeito
extra aplicado depois (Q15a). O catálogo usa os valores do item base.
