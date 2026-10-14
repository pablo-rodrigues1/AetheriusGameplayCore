# 4. Fórmulas de combate e exemplos auditáveis

## 4.1 Escopo da prova

As fórmulas abaixo descrevem os helpers C++ da baseline, não uma promessa de equivalência universal ao Skyrim nem prova de integração em produção. O modo configurado permanece `enabled:false, mode:legacy`. O port nativo necessário está bloqueado por B02. Ataques power/sneak/bash, colisão, timing, enchantments e procs exigem contexto e implementação adicionais.

Fontes: [PhysicalDamagePipeline](../../modules/damage-system/server/server/cpp/server_guest_lib/aetherius_combat/physical/PhysicalDamagePipeline.h), [MagicDamagePipeline](../../modules/damage-system/server/server/cpp/server_guest_lib/aetherius_combat/magic/MagicDamagePipeline.h), [PerkRegistry](../../modules/damage-system/server/server/cpp/server_guest_lib/aetherius_combat/perks/PerkRegistry.h). Os parâmetros exatos da release devem acompanhar o manifesto e os testes.

## 4.2 Dano físico

Defina `B=weaponBase`, `F=flatItemDamage`, `I=itemMultiplier`, `S=weaponSkill`, `Pweapon` e `Pattack` como produtos dos handlers das duas entradas, `T=attackMultiplier` autorizado e `G=physicalMultiplier`.

Para a **integração futura do RefinementSystem**, resolva a instância autorizada da arma e seu tier persistente `R` (0/I/II/III), com `r(R) = 0/0.25/0.50/0.75`. O refinamento deve afetar **apenas a base elegível**: `B_refinado = B × (1 + r(R))`. O provider deve inserir no helper C++ essa base já refinada **ou** um fator equivalente uma única vez, sem dupla incidência; não há implementação final de item instances nessa baseline.

```text
B_refinado = B × (1 + r(R))           // conceito; tier da instância permanece intacto
normal = max(0, B_refinado + F) × max(0, I) × (1 + 0.005 × S)
normal = normal × Pweapon × Pattack × max(0, T)
critical = crítico_sorteado ? max(0, criticalBase) × Pcritical : 0
preDefense = (normal + critical) × G
final = max(0, preDefense × (1 - blockReduction) × (1 - armorReduction))
```

`criticalBase` vem do resolvedor autorizado da arma. O helper adiciona um componente crítico, não multiplica automaticamente todo o dano por dois. `criticalChance` não é recalculada pelo registry a partir de todas as perks instaladas; o contexto precisa fornecê-la com semântica validada. O multiplicador `T` também não é licença para aceitar qualquer número enviado pelo cliente.

`Nonnegative` rejeita valores não finitos e limita valores negativos a zero. Isso não dispensa validar limites superiores, tipos e a construção do contexto. `flatItemDamage` e `itemMultiplier` devem ter providers com origem explícita para evitar aplicar tempering, buffs ou manutenção duas vezes. **O tier é relido do snapshot autorizado em cada hit e nunca é uma carga consumível.** "Uma vez" significa não duplicar seu fator **dentro do mesmo hit**; no hit seguinte, ele deve ser considerado novamente com o mesmo valor, caso a instância ainda possua o mesmo tier. Se o provider entregar `weaponBase` já refinado, não aplicar `r(R)` novamente. Cargas e penalidades de manutenção pertencem ao DurabilitySystem, não ao RefinementSystem.

## 4.3 Armadura e bloqueio

Para cada peça, o helper calcula. Na integração futura, a base é a contribuição autorizada de Armor Rating daquela **instância** refinada, distinta de buffs e de flats:

```text
baseRefinada = base × (1 + r(tierDaInstancia))
rating = max(0, baseRefinada + flat) × max(0, itemMultiplier)
         × (1 + 0.005 × armorSkill) × Parmadura
pieceTotal = rating + hiddenArmorPerPiece
```

A política de quais slots/peças entram no total precisa ser resolvida antes da chamada. A contribuição refinada de armaduras e escudos elegíveis deve ser considerada novamente em **todo** evento de dano físico sofrido, mantendo o tier intacto. O tier não altera diretamente a redução própria de Block. O helper sozinho não descobre slots, armaduras sobrepostas, condições de set completo ou overlays. `hiddenArmorPerPiece` está zero na configuração auditada.

Curva configurada para armadura total `A`: até 0, redução zero; de 0 a 500, `A × 0.8/500`; de 500 a 1000, `0.8 + (A-500) × 0.1/500`; a partir de 1000, redução 0.9. São parâmetros do projeto auditado, não uma afirmação da fórmula vanilla.

|Armadura efetiva|Redução|Dano restante de 100|
|---:|---:|---:|
|0|0%|100|
|250|40%|60|
|500|80%|20|
|750|85%|15|
|1000|90%|10|
|1500|90%|10|

Se `blocked` for verdadeiro, `block = clamp((0.20 + 0.003 × BlockSkill) × Pblock, 0, 0.85)` na configuração auditada. A condição `blocked` precisa de orientação, janela e contexto confiáveis. A função não verifica sozinha que um escudo estava apontado para o atacante. Sem bloqueio autorizado, usar zero de redução.

## 4.4 Exemplo físico completo

Exemplo sintético para reproduzir a matemática do helper: arma base 20, flat 0, itemMultiplier 1, OneHanded 50, One-Handed Mastery aplicável, attackMultiplier 1, sem crítico, global 1, armadura da vítima 250 e BlockSkill 50. A vítima está bloqueando, sem mastery de Block.

|Etapa|Operação|Resultado|
|---|---|---:|
|Base com skill|`20 × (1 + 0.005×50)`|25|
|Mastery aplicável|`25 × (1 + 0.01×50)`|37,5|
|Armadura|`37.5 × (1-0.4)`|22,5|
|Bloqueio|`22.5 × (1-0.35)`|14,625|

Com Block Mastery aplicável no defensor, `Pblock=1.25`, redução de bloqueio `0.4375`, dano `12.65625`. Com penalidade hipotética de manutenção `itemMultiplier=0.7`, sem Block Mastery, o resultado fica `10.2375`. O fator 0.7 entra uma vez no componente do item, não novamente no dano final.

Se criticalBase=5 e a mastery crítica aplicável produzir `1+0.05×50=3.5`, o componente crítico vale 17.5. Com as condições originais do exemplo, preDefense=55 e final=21.45. A chance de esse ramo ocorrer é responsabilidade do RNG/contexto, não desta conta. Arredondamento visual não deve arredondar o estado persistido em cada etapa.

### Exemplo de persistência do tier entre eventos

Arma com dano-base 20 e Tier II: `20 × 1.50 = 30` como base refinada em todos os golpes físicos, enquanto esse tier estiver na mesma instância. Golpe 1, golpe 2 e golpe 100 usam a mesma base refinada 30; o resultado final pode mudar por skill, perks, bloqueio e armadura, mas o tier **não decresce**. Armadura com base 40 e Tier III contribui com base refinada 70 em cada dano físico recebido. Regressão não existe no pipeline de dano: só o RefinementSystem pode alterá-la por falha total ao tentar o próximo tier.

Estas contas descrevem a **regra desejada de integração**. O helper atual só multiplica entradas resolvidas pelo adapter e **não comprova que a identidade de instância e o provider de refino já estejam conectados**.

## 4.5 Magia

O helper atual sorteia absorção **uma vez por chamada**. Se passar, retorna `absorbed=true` e componentes zero. Para cada componente não absorvido:

```text
d = max(0, magnitude) × magicMultiplier
    × (1 - clamp(magicResistance, -1, magicCap))
    × (1 - clamp(elementResistance, -1, elementalCap))
```

O elemento seleciona Fire, Frost, Shock, Poison ou None; o recurso seleciona Health, Magicka ou Stamina. Os caps configurados de resistência mágica e elemental são 0.85. `Element::None` usa resistência elemental zero. No código, Poison também passa pelo fator de resistência mágica; isso deve ser confrontado com a regra pretendida de veneno, não apresentado como fidelidade garantida a todo record.

Exemplo: magnitude 100 de Fire, resistência mágica 25% e fogo 40% produz `100×0.75×0.6=45`. Dois caps de 85% deixam 2.25 de 100; não somar 85%+85%. Uma fraqueza elemental de−50% com resistência mágica 25% produz 112.5. O clamp inferior−1 limita o fator de cada fraqueza a 2 nesse helper.

Uma spell pode ter componentes em recursos diferentes; somá-los em HP perde drenagem de Magicka/Stamina. Absorção não é simplesmente resistência de 100%: possui decisão própria e pode ter efeitos colaterais que o helper não modela. Flags como exceção de absorção e condições específicas precisam ser compiladas ou a feature deve permanecer indisponível.

## 4.6 Duração, concentração e valor por segundo

`MagicDamageComponent` contém duração e concentração, mas a função `MagicDamage` não agenda ticks nem converte automaticamente magnitude em dano por segundo. Não chamar a função a cada frame com a mesma magnitude integral. O scheduler e a semântica do MGEF determinam pulsos, intervalo, duração, cancelamento e gasto de recurso.

O cálculo integrado de magia da baseline ainda tem caminho que lança erro de não implementação; ter este helper e testes unitários não significa magia autoritativa funcionando no servidor. [Magia e efeitos](05_MAGIA_EFEITOS.md) define como fechar essa diferença sem duplicar stores.

## 4.7 O que precisa constar em cada trace

Guardar identidade do evento e catálogo, attacker/target estáveis, revisions, arma/item instance, base, flat, multiplicadores e origem, skill, conditions decisivas, resultado de RNG, componentes antes/depois de defesa e versão aplicada. Respeitar limites e amostragem para não registrar toda CTDA de todo hit em produção. Na investigação de divergência, ativar trace focado em evento/ator por janela curta.

Critérios: valores finitos; nenhuma consulta síncrona ao banco no callback de dano; nenhum multiplicador duplicado; resultado estável em replay do mesmo snapshot; nenhuma transação aplicada por observador; nenhum packet com `damage=999999` capaz de substituir os providers autorizados.
