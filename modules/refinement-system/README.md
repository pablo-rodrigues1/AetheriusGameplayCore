# Aetherius Refinement System

> [!IMPORTANT]
> Este módulo registra, nesta etapa, **apenas a definição conceitual** do sistema de refino pretendido para o Aetherius. Não constitui ainda um plano técnico de implementação, contrato de API, schema de banco ou especificação de código.

## 1. Papel do sistema

O `refinement-system` será responsável pelo **aprimoramento de equipamentos já existentes**, separadamente do processo de fabricação realizado pelo `crafting-system`.

A filosofia geral é:

- crafting cria o item-base;
- refinement aprimora uma instância específica desse item;
- a fabricação-base deve ser relativamente tolerante;
- o refino concentra a maior parte do risco, dificuldade mecânica e sensação de mastery artesanal.

O sistema será compartilhado, inicialmente, principalmente por **Ferreiro** e **Curtidor**, evitando duas implementações diferentes de refino.

## 2. Refino por instância

O refino não criará Forms separadas para cada tier.

Não haverá:

~~~text
SteelSword
SteelSword_Tier1
SteelSword_Tier2
SteelSword_Tier3
~~~

Uma única Form continuará representando o item-base. O nível de refino será um estado da **instância individual do item**.

Isso significa que duas Steel Swords idênticas em base poderão coexistir com tiers diferentes.

Esse estado deverá acompanhar o item quando ele:

- for equipado ou desequipado;
- for negociado;
- for colocado em container;
- for derrubado e coletado;
- permanecer após relog;
- mudar de proprietário.

## 3. Tiers

O sistema possui três níveis de aprimoramento além do estado original:

| Estado | Bônus sobre o valor-base |
|---|---:|
| Sem refino | 0% |
| Tier I | +25% |
| Tier II | +50% |
| Tier III | +75% |

Os bônus são calculados sobre o **valor-base autorizado do equipamento** e não são cumulativos entre tiers.

**O tier é um atributo persistente da instância, não uma carga ou efeito de uso único.** Enquanto um equipamento possuir Tier I, II ou III, o bônus correspondente permanece ativo em **todos** os golpes causados (armas) ou cálculos de dano sofrido em que sua armadura/escudo participar. Combate, bloqueios, equipar/desequipar, troca de proprietário e desgaste de manutenção **não consomem nem regridem o tier**.

Exemplo:

~~~text
Armor Rating base = 40

Tier 0   = 40
Tier I   = 50
Tier II  = 60
Tier III = 70
~~~

A progressão é estritamente sequencial:

~~~text
Tier 0 -> Tier I -> Tier II -> Tier III
~~~

Não é permitido pular tiers.

## 4. Atributos afetados

O refino deve atuar apenas sobre atributos estruturais definidos pelo sistema.

Conceitualmente:

- armas corpo a corpo: dano físico base;
- arcos/bestas: dano físico base;
- armaduras: Armor Rating;
- escudos: Armor Rating.

O refino não deve, por padrão, alterar automaticamente:

- peso;
- valor monetário;
- velocidade;
- encantamentos;
- magnitude de magia;
- outras propriedades não previstas.

## 5. Relação com o AetheriusDamageSystem

**Regra obrigatória: o DamageSystem deve consultar o tier persistido da instância de equipamento em todo cálculo físico pertinente e aplicar novamente seu bônus em cada evento; a consulta e o cálculo jamais consomem, gastam, decrementam ou regridem o tier.**

- **Arma:** em cada golpe físico autorizado, identificar a instância realmente utilizada e considerar seu Tier I/II/III na determinação do dano físico base efetivo.
- **Armadura:** em cada cálculo de dano físico recebido, considerar o tier individual de cada peça efetivamente incluída no Armor Rating do defensor.
- **Escudo:** considerar seu tier na contribuição de Armor Rating sempre que ele integrar o conjunto defensivo. Regras próprias de redução de bloqueio permanecem independentes; o tier não cria, por si só, multiplicador de Block.
- **Persistência:** o tier não muda com golpes, bloqueios, mortes, relog, movimentação de inventário, manutenção ou desgaste. Regressão na mecânica de refino ocorre **somente** após falha total numa tentativa de subir ao tier seguinte, conforme a seção 10; sucesso altera o tier para o novo valor.

A expressão **"aplicar o bônus uma única vez"** significa **uma única incidência sobre o valor-base autorizado dentro de CADA cálculo**, evitando double-dip, e **não** uma aplicação única na vida útil do item.

```text
bonus(0) = 0.00; bonus(I) = 0.25; bonus(II) = 0.50; bonus(III) = 0.75
baseEfetiva = baseAutorizadaDaInstancia * (1 + bonus(tierDaInstancia))

Exemplo, arma base 20 com Tier II:
Golpe 1 -> baseEfetiva 30; tier permanece II
Golpe 2 -> baseEfetiva 30; tier permanece II
Golpe N -> baseEfetiva 30; tier permanece II

Exemplo, armadura base 40 com Tier III:
Dano recebido 1 -> contribuição-base de Armor Rating 70; tier permanece III
Dano recebido 2 -> contribuição-base de Armor Rating 70; tier permanece III
```

Essas bases efetivas ainda passam pelas etapas normais de skill, perks, outros modificadores, bloqueio e curva de armadura do DamageSystem. Valores finais podem variar entre golpes por outras condições; **o bônus de refino permanece o mesmo até uma alteração autorizada do tier**.

A integração precisa evitar **double-dip**, especialmente se o cliente Skyrim apresentar tempering ou valores modificados localmente. O servidor não deve aplicar o tier sobre um valor-base que já o inclua, nem aceitar tier, dano ou Armor Rating fornecidos pelo cliente. Se houver modificadores flat, de manutenção ou de buffs, sua ordem e origem devem ser explícitas para não reforçar propriedades fora do escopo do refino.

O `damage-system` não conhecerá os minigames, materiais ou regras econômicas do refino: receberá, pelo snapshot/contrato autoritativo apropriado, a identidade de instância e seu tier ou sua contribuição base já refinada, sem duplicar o multiplicador. **Não deve realizar escrita/transação de consumo ou decremento de tier por hit.** Em caso de mudança autorizada após sucesso/falha de refino, a projeção/cache de equipamento deverá ser invalidada ou revisionada antes dos próximos cálculos, sem consulta síncrona ao banco a cada golpe.

Esta seção define **comportamento obrigatório para a integração futura**; não afirma que o provider experimental do DamageSystem já lê tiers persistidos de inventário.

## 6. Filosofia de dificuldade

A dificuldade mecânica do equipamento artesanal ficará concentrada principalmente no refino.

Enquanto o crafting-base prioriza:

- acesso por rank;
- custo de materiais;
- disponibilidade;
- economia;
- recipes;
- conteúdo desbloqueado;

o refino deve representar:

- precisão;
- risco;
- investimento;
- possibilidade de regressão;
- domínio mecânico do jogador.

Assim, possuir rank profissional maior não significa que fabricar o item-base se torna frustrantemente mais difícil. A exigência mecânica cresce principalmente quando o jogador decide aprimorar um equipamento.

## 7. Molde de refino

Antes de uma tentativa, o jogador deverá preparar um molde correspondente ao target tier.

Conceitualmente:

| Target Tier | Custo-base do molde |
|---|---:|
| Tier I | 1 unidade de couro |
| Tier II | 2 unidades de couro |
| Tier III | 3 unidades de couro |

O molde:

- não possui minigame próprio;
- é comprometido na tentativa;
- pode existir apenas como estado econômico/server-side;
- não deve ser confundido com moldes utilizados durante crafting-base.

Os materiais adicionais da tentativa dependem do equipamento, material e target tier.

## 8. Minigame de refino

Cada tentativa será dividida em ciclos compostos por duas etapas:

~~~text
Ajustar a peça ao molde
        |
        v
Executar sequência aleatória de teclas
        |
        v
Novo ciclo
~~~

### Ajuste da peça

O jogador deverá posicionar e rotacionar visualmente a peça até se aproximar do molde-alvo.

O servidor define:

- posição-alvo;
- rotação-alvo;
- tolerâncias;
- desafio vigente.

### Sequência de teclas

Após um ajuste válido, o jogador recebe uma sequência aleatória de teclas.

Cada sequência terá **5 segundos** para ser concluída.

Os desafios deverão ser gerados **just-in-time**, evitando que toda a tentativa seja conhecida antecipadamente.

## 9. Ciclos e tolerância a falhas

A estrutura conceitual é:

| Target Tier | Ciclos | Falhas toleradas |
|---|---:|---:|
| Tier I | 5 | 3 |
| Tier II | 10 | 2 |
| Tier III | 15 | 0 |

Interpretação:

- Tier I: a tentativa termina na 4ª falha;
- Tier II: termina na 3ª falha;
- Tier III: a primeira falha encerra a tentativa.

O target tier aumenta o risco.

A complexidade tecnológica do equipamento também pode influenciar tolerâncias e tamanho das sequências, conforme seu rank profissional de origem.

## 10. Falha total

Quando a tentativa exceder o limite permitido:

- o molde permanece consumido;
- os materiais da tentativa permanecem consumidos;
- não existe reembolso;
- o item não é destruído;
- o item regride um tier em relação ao estado anterior.

Exemplos:

~~~text
Tier 0 tentando Tier I
falha -> permanece Tier 0

Tier I tentando Tier II
falha -> regride para Tier 0

Tier II tentando Tier III
falha -> regride para Tier I
~~~

A regressão é a principal camada de risco econômico do sistema. **Nenhuma atividade de combate ou uso normal do item constitui tentativa de refino, portanto não pode disparar regressão de tier.** Os consumos descritos nesta seção referem-se exclusivamente ao **molde e aos materiais da tentativa**, nunca ao bônus de tier por golpe.

## 11. Sucesso

Quando todos os ciclos forem concluídos sem exceder o limite de falhas:

~~~text
newTier = targetTier
~~~

O novo estado deverá ser persistido na instância específica do equipamento. Essa é uma das únicas transições normais do tier (a outra é a regressão por falha total do refino); o estado resultante continua ativo sem limite de golpes e precisa atualizar os snapshots/providers de combate.

## 12. Autoridade

Todo resultado econômico é server-authoritative.

O cliente/CEF nunca decide:

- tier atual;
- target tier;
- sucesso final;
- regressão;
- materiais consumidos;
- valor efetivo;
- tolerância real;
- RNG;
- resultado de sequência.

A interface apenas apresenta o desafio e envia inputs.

## 13. Relação com profissões

Ferreiro e Curtidor utilizam o mesmo core de refino.

O `profession-system` continua responsável por:

- profissão;
- rank;
- Vigor;
- XP;
- gates.

O `refinement-system` será responsável por:

- elegibilidade do item;
- tier atual;
- target tier;
- materiais/moldes;
- sessão de refino;
- desafio;
- sucesso/falha;
- regressão;
- persistência do tier por instância.

Não deve existir duplicação de regras de refino dentro dos módulos específicos de Ferreiro ou Curtidor.

## 14. Perks vanilla

Smithing perks vanilla não serão a authority de:

- autorização de refino;
- target tier;
- resultado;
- progressão do sistema.

O acesso e a lógica do refino serão controlados pelos sistemas próprios do Aetherius.

## 15. Configurabilidade de balanceamento

Embora este documento seja apenas conceitual, os valores numéricos aqui descritos também deverão ser externalizados quando o sistema for implementado.

Isso inclui:

- +25/+50/+75% por tier;
- 1/2/3 couros de molde;
- 5 segundos por sequência;
- 5/10/15 ciclos;
- 3/2/0 falhas toleradas;
- custos e materiais adicionais.

Esses números representam o baseline conceitual atual e devem ser fáceis de rebalancear sem reescrever a lógica do RefinementSystem.

Ver `docs/architecture/AETHERIUS_BALANCE_CONFIGURATION_POLICY.md`.

## 16. Estado atual

Esta documentação define somente **o conceito do sistema desejado**.

Ainda precisarão ser especificados posteriormente:

- contratos;
- Host Ports;
- modelo final de persistência;
- locks de item;
- integração de inventário;
- detalhes de CEF;
- recovery/reconnect;
- antifraude;
- schemas;
- testes;
- rollout;
- testes de invariância do tier em golpes sucessivos, armadura/escudo sob dano repetido, troca/equipamento/relog e regressão exclusivamente em falha de refino;
- invalidação/revisão do snapshot do DamageSystem após sucesso/falha de refino.

Esses pontos não devem ser considerados definidos por este documento.
