# Aetherius ActorState — composição de concessões (B4)

Compositor puro de `GrantSet` a partir das saídas dos providers. Reutiliza os
contratos de [shared/contracts](../../shared/contracts/src/index.ts), sem banco,
arquivo, rede, host, relógio ou RNG. Não mantém store interno. O ledger de grants
é o array imutável do snapshot, reconstruído a partir dos fatos dos owners.

O README anterior descrevia somente o scaffold. Esta implementação B4 substitui
essa descrição; fatos duráveis, skills/atributos efetivos e integração de projeção
continuam nos slices e na B5. A referência é a
[arquitetura](../../docs/architecture/AETHERIUS_GAMEPLAY_CORE_ARCHITECTURE.md) e o
[ADR D4](../../docs/architecture/adr/D4-projecao-de-grants.md).

## API

Exporte de `src/index.ts`:

| Função/tipo | Comportamento |
|---|---|
| `GrantProvider<Facts>` | Função pura `(facts) => readonly Grant[]`; o owner lê seus próprios fatos e resolve suas definições antes. |
| `compose(characterKey, providerOutputs, revision)` | União determinística, profundamente imutável e sem referências mutáveis do chamador. Não invoca providers nem lê fatos. |
| `effectiveSet(set)` | Um item por `(kind, recordType, stableFormKey)`, com `sources` ordenadas; rank de perk é o maior rank ativo. |
| `diff(previous, next)` | `added`, `removed` e `changed`. Cada mudança inclui os itens `previous`/`next` e `rankChanged`. |
| `applyDiff(previousEffectiveSet, diff)` | Reproduz o próximo conjunto efetivo, incluindo origens e vetor de revisão; recusa base divergente e operações conflitantes. Não publica nada. |
| `revokeSource(set, source, nextRevision)` | Remove exatamente `(source.kind, source.key)` e retorna novo `GrantSet`. O owner fornece a revisão. |
| `compareRevisions(left, right)` | Relação de left para right: `equal`, `before`, `after`, `incomparable`. |
| `explain(set, characterKey, definition)` | Origens únicas que sustentam a definição exata, inclusive assinatura, em todos os kinds. Ausência retorna `[]`; personagem/definição divergente é erro. |

`EffectiveGrant` é uma transformação dos tipos `Grant` dos contratos: remove os
campos de origem individual/revisão individual e acrescenta a lista de origens.
`CharacterKey`, `StableFormKey`, `DefinitionRef`, `GrantSource` e `RevisionVector`
são os tipos compartilhados, sem uma segunda representação de chave ou grant.

## União e validação

A identidade de um grant é `(kind, definição estável, source.kind, source.key)`.
Tipo de record participa da identidade; assinatura, revisão e rank são estado.
Uma mesma chave estável tem que concordar em tipo e assinatura no snapshot.
Tuplas serializadas evitam colisões se uma sourceKey contiver separadores.
Ordenação usa comparação lexical explícita, sem locale.

Cada saída de provider rejeita repetição da mesma identidade, mesmo se rank ou
revisão diferir. Entre providers, entradas completamente iguais são unidas uma
vez; entradas com a mesma identidade e estado diferente dão `CONFLICTING_GRANT`.
Origens distintas permanecem separadas. Assinaturas/tipos conflitantes dão
`CONFLICTING_DEFINITION`; modifiers da mesma identidade efetiva com owners
diferentes dão `CONFLICTING_OWNER`. Não há escolha por ordem de entrada.

Entradas com campos ausentes/extras, origem inválida, chave não canônica ou nula,
tipo incompatível, rank fora de `1..255`, revisão não inteira/negativa/insegura,
array esparso e assinatura vazia são recusadas com `TypeError` e código/caminho.
Definições são validadas pelo codec compartilhado, sem normalizar silenciosamente.

`DefinitionRef` não carrega `PluginKind`. ActorState verifica a forma canônica
do contrato e o limite de `.esl`; não pode determinar se um `.esp`/`.esm` é leve,
provar presença, winner ou semântica. Essas provas são do RecordCatalog B2 e do
provider. Definição ausente ou não certificada deve produzir `UNSUPPORTED` no
owner antes da composição, nunca um grant inventado. Assinatura não vazia não
prova validade do catálogo instalado.

## Ranks e diferenças

Perks usam `max(ranks ativos)`. Cada origem é um entitlement ao rank declarado;
somar origens criaria ranks que nenhuma delas concede. Ao retirar a origem que
sustenta o maior rank, a concessão desce para o maior rank restante. Ao retirar a
última, sai do conjunto efetivo. O ledger conserva cada rank/revisão original.

Perder uma origem de spell mantendo outra produz `changed` com
`rankChanged: false`, **não** `removed`. A lista de origens precisa mudar para
auditoria, mesmo que nenhuma operação no jogo seja necessária. Ranks alterados
produzem `changed` com `rankChanged: true`; troca de assinatura ou owner também
fica explícita em `changed`. O consumidor B5 distingue essas mudanças e aplica
as regras da família certificada. ActorState não aplica efeitos nem certifica
transição de ownership. Spell/ability/power continuam kinds distintos, conforme
o contrato; classificar o subtipo SPEL é responsabilidade do catálogo/provider.

`applyDiff(effectiveSet(old), diff(old, next))` reproduz `effectiveSet(next)`.
O helper não reconstrói ranks/revisões individuais do ledger, pois o conjunto
efetivo contém somente rank máximo e origens. Ele exige o mesmo personagem,
mesmo vetor de base e que cada remoção/mudança corresponda ao item anterior.

## Revisões

A comparação é componente a componente nos cinco contadores do contrato. Next
pode ser igual ou maior em todos os componentes. Se menor em algum e maior em
outro, a revisão é incomparável; a projeção precisa obter um snapshot coerente do
owner, não somar ou escolher vetores. `diff` e `revokeSource` recusam revisões
anteriores (`STALE_REVISION`) e incomparáveis (`INCOMPARABLE_REVISION`). Vetor igual
exige ledger igual (`REVISION_CONTENT_CONFLICT`), inclusive ranks, provenance,
revisões de grants e assinaturas. A ordem dos inputs não muda essa igualdade.

ActorState carrega o vetor recebido; não incrementa contadores nem inventa vínculo
numérico entre revisão de um grant e os componentes do vetor. O runtime/owners
entregam esse snapshot coerente. Alterar apenas a revisão, mantendo grants,
é válido e o replay atualiza o vetor mesmo sem operações sobre itens.

## Exemplo de provider para C1

O slice lê o fato e os vínculos de SPEL no RecordCatalog reconciliado. Só após
resolver todas as definições, pode chamar este provider; erro de catálogo deve
ser devolvido como `UNSUPPORTED` antes desse passo.

```ts
import type { DefinitionRef } from '../../shared/contracts/src/index.ts';
import type { GrantProvider } from './src/index.ts';

type StoneFacts = {
  readonly spells: readonly DefinitionRef<'SPEL'>[];
  readonly revision: number;
};
const stoneProvider: GrantProvider<StoneFacts> = facts => facts.spells.map(definition => ({
  kind: 'spell', definition,
  source: { kind: 'STANDING_STONE', key: 'standing-stone-choice' },
  revision: facts.revision
}));
// O owner fornece characterKey e vector coerentes.
// compose(characterKey, [stoneProvider(facts), classGrants], vector);
```

Sem escolha, o owner entrega lista vazia. Trocar a escolha substitui somente a
saída desse provider: se classe ou raça sustentar o mesmo spell, ele continua.
Este exemplo não implementa a regra da pedra, nem inclui o perk sem vínculo do
Corcel que B2 declara `UNSUPPORTED`.

## Executar e revisar

Na máquina desta entrega, Node `22.14.0` e TypeScript `5.9.3` já estão instalados
no Core. Apenas lemos `runtime/node_modules/typescript`, como a B3; não instalamos
dependências nem alteramos runtime ou package.json de raiz/shared. A dependência
de desenvolvimento está declarada neste pacote; a instalação central e os
scripts de workspace ficam para B1/empacotamento. Não há dependências de produção.

```powershell
cd 'C:\Code\Aetherius - SkyMP\AetheriusGameplayCore\modules\actor-state-system'
npm run typecheck
npm test
```

O typecheck inclui as provas de brands/readonly. Testes Node carregam TS com
`--experimental-strip-types` (aviso experimental esperado). Não geram build nem
escrevem em outro pacote. Os testes de pureza inspecionam o AST de todo o grafo
de imports de produção, exercitam a guarda com dependências proibidas e executam
com relógio/entropia bloqueados. O uso de `fs` e TypeScript existe só no teste.

Os testes de propriedade usam seeds fixas: 120 conjuntos, todas as seis ordens
de três providers e três embaralhamentos por ordem; todas as permutações de uma
fixture pequena; 240 pares para replay exato; 100 conjuntos com revogação
sequencial de três origens. Também cobrem explicação, ranks e cópias imutáveis.

B4 não tem aceite que suba servidor local. A integração com host/cliente,
reconnect/restart e duas sessões é da B5/G-FUND: **não executado: exige servidor
local**, além das integrações futuras. O revisor primeiro executa os comandos
acima; no ensaio futuro deve usar outra pasta de trabalho e porta fornecida por
argumento, preservando o servidor do dono na UDP 7777. Não há servidor simulado
ou harness de rede neste módulo puro.
