# C2 — Raça observada, concessões entregues pelo record

O host é dono da raça. O sistema lê `mp.get(actorId, 'appearance').raceId`, resolve
esse ID efêmero contra as dez raízes reconciliadas do catálogo `races` e grava
somente a cópia observada em `gc_race_observation`: identidade estável, status,
motivo de ausência, instante da observação e revisão. Nenhum ID de runtime é
persistido. O sistema não altera aparência, raça, sessão, actor values ou grants
no host; não veta o gancho nem envia propriedades/mensagens ao jogador.

`onUpdateAppearanceAttempt(actorId, appearance, isAllowed)` é emitido depois de
`SetAppearance` em `ActionListener.cpp:219-227`. O observador ignora os dois últimos
argumentos e relê a propriedade já armazenada. Uma tentativa negada não vira raça
válida. Alterações de aparência feitas diretamente por outro gamemode via `mp.set`
não emitem esse gancho; serão vistas na próxima readiness/reconexão ou por
`core.observeRace(binding)`. A readiness continua a aproximação de três segundos
da B1, sem confirmação de carga do cliente.

Raça não jogável, não resolvida, catálogo ausente e aparência ausente são
`UNSUPPORTED`, com log por personagem. Quando o banco está disponível em active,
a observação unsupported tem `race_key=null`, substitui a cópia anterior e não
compõe concessões raciais. Não há inferência pela raça do NPC base nem por nome.
Falha de banco ou sessão obsoleta não grava um fato válido. A revisão cresce ao
mudar raça/status/motivo; observar o mesmo estado renova o instante, preservando
a revisão. Observações são comandos internos com UUID no ledger B3, sob trava
por CharacterKey e checagem do binding antes do commit. A repetição de uma entrega
de um comando é tratada pelo mecanismo idempotente da B3; não existe outro ledger.

## Composição e entrega

`raceGrants` é puro. Usa os ActorEffect do winner e segue SPEL → MGEF →
`PerkToApply` → PERK. Origem é `RACE` + StableFormKey da raça; cada definição tem
sua assinatura própria. Perk aplicado por efeito é representado no primeiro rank,
sem transformar `NumRanks` (limite do record) em ranks concedidos.

O provider participa do mesmo `ActorComposition` das pedras. Após observar, o
runtime chama `inspect`, que compõe sem publicar no port: a raça não solicita
entrega de nenhuma origem. A escolha de pedra continua usando `recompose` e o
port habitual, com a composição completa e suas origens.

No limite de entrega, `portGrantSet` exclui todos os records com origem RACE,
inclusive outras origens do mesmo record. O conjunto completo permanece no
registro da projeção e na explicação. A transição também protege os records
raciais do conjunto anterior. Antes de reconciliar uma cabeça antiga no reconnect,
o port consulta os records nativos da aparência atual através do runtime. Isso
evita chamar AddSpell para uma habilidade agora racial antes de o fato observado
ser atualizado. Se existia bookkeeping de autoria do Core para esse record, ele
é abandonado sem RemoveSpell. Não há reimplementação da semântica racial.

Fontes nativas: `MpActor.cpp:845-882` guarda só learnedSpells na enumeração;
`IsSpellLearnedFromBase` consulta o NPC base e a raça desse NPC, sem consultar
a aparência atual. `PapyrusActor.cpp:585-598` recusa AddSpell quando a verificação
de herança já diz que o spell é conhecido; caso contrário adiciona learnedSpell
e envia snippet ao cliente. `GetSpellCount/GetNthSpell:682-751` excluem os spells
herdados do base. Por isso nem enumeração nem AddSpell constituem um método seguro
de observar concessões da raça escolhida. Este sistema não os usa para concedê-las.

`initialRaceAttributes` expõe Health, Magicka e Stamina de `Starting` como consulta.
O Nord exportado tem 50/50/50; isso não é uma afirmação sobre os valores finais
do ator. Os 150/100/100 observados em jogo incluem a composição nativa e a pedra.

## Ownership e dados

`ownership.json` é gerado, com 37 vínculos de habilidades e seis perks, por raça.
Todos têm grantOwner e resultOwner `NATIVE_CLIENT`. `classification/spells.jsonl`
da A3 é entrada obrigatória: classe, família, confiança e motivo são preservados.
Detalhes do MGEF distinguem efeito do motor, script cliente e marcador Script
sem script, cuja semântica continua não certificada. Não se presume equivalência
de um marcador com o bônus descrito por texto localizado.

Perks preservam pontos de entrada, valores, operação, rank, prioridade e notas
das condições exportadas. A profundidade do export não trouxe todos os campos
internos dessas condições; nenhum predicado é inventado ou avaliado. Entry points
de dano e magnitudes relacionadas ficam `NOT_VERIFIED_MULTIPLAYER_SERVER_HIT_DAMAGE`:
não verificado no multiplayer, pois o dano de golpe é calculado pelo servidor.
Os demais entry points e dependências de quest/script também ficam não verificados.
Nenhuma linha racial declara `AETHERIUS_SERVER`.

Da raiz do workspace:

```powershell
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/build.ts _work/exports aetherius-server/build/dist/server/data/aetherius-loadorder.json AetheriusGameplayCore/catalog
node AetheriusGameplayCore/modules/race-system/tools/ownership.mjs AetheriusGameplayCore/catalog/races.json _work/exports/classification/spells.jsonl AetheriusGameplayCore/modules/race-system/ownership.json
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/verify.ts .
```

O catálogo inclui também perks alcançados por efeitos das pedras, como definição;
seu provider e seus grants projetados não mudam. Os records que não mudaram mantêm
assinatura. A regeneração não modifica os plugins do jogo. Depois, na raiz do Core,
rodar `npm run typecheck`, `npm run build`, `npm test` com os argumentos de ambiente
do runtime. O build embute catálogo, migration e ownership no bundle CommonJS.

## Modos, banco e ferramenta de explicação

`GAMEPLAY_CORE_MODE_RACES` tem padrão off. Em audit e shadow o sistema observa e
registra em log, sem escrever fatos/ledger/projeção. Em active escreve observações
e participa da composição; canary faz isso somente para personagens selecionados
em `GAMEPLAY_CORE_CANARY_CHARACTERS`. Nenhum modo altera o personagem no host.

A migration 0005 é aditiva e usa a gramática restrita da B3; validação de
status, identidade, vínculos e revisão acontece no módulo. Aplicar pelo runner
existente e pelo único pool `core/pg.js`. A ausência somente da 0005 deixa races
UNSUPPORTED, preservando o sistema de pedras que já tem as migrations 0001–0004.
Nenhuma migration foi aplicada ao banco de desenvolvimento por esta ordem.
O operador/revisor aplica a 0005 antes de habilitar active e recarrega o gamemode
somente em momento autorizado pelo dono do servidor.

Com o servidor parado, ambiente do gamemode já configurado, na raiz do Core:

```powershell
node runtime/explain-character.mjs <caminho-absoluto-gamemode/core/pg.js> profile:108549 [schema]
```

A ferramenta usa o pool existente, abre uma transação REPEATABLE READ READ ONLY,
lê somente os fatos gc_ de pedra/raça e imprime concessões, origens, delivery,
ownership e atributos iniciais. Não aplica migrations, não escreve projeções e
não lê credenciais de arquivo. Consulta assinaturas dos artefatos offline; não
alega conferir a load order de um host parado. Ausência de raça é UNSUPPORTED.

## Aceite reservado ao revisor

Não executado pelo Sol: exige servidor local. Com AETHERIUS_TEST_DATABASE_URL
local já fornecida, fora do sandbox e em diretório novo:

```powershell
node runtime/review-races.mjs <workspace> <nova-pasta-evidencia> <porta-UDP-livre-exceto-7777> <cell-ou-world-local:plugin> <raca-local:plugin>
node --experimental-strip-types tools/catalog/real-host.ts <workspace> <outra-pasta-nova> <porta-UDP-livre-exceto-7777>
```

O primeiro harness cria ator isolado com aparência de uma raça do catálogo,
chama diretamente os ganchos registrados, confere o fato, a explicação e a
enumeração nativa antes/depois, contando zero chamadas de mutação do sistema.
Somente o setup do harness escreve aparência. Não usa ativação Papyrus nem
destruição de ator; o ator morre com o processo separado. A porta é argumento
obrigatório; 7777 é recusada. O segundo harness existente compara os domínios
regenerados em duas load orders, incluindo as assinaturas dos novos perks.

O dono do projeto continua responsável pela observação em jogo. Não há evidência
nova em jogo desta ordem e nenhum resultado racial foi certificado no multiplayer.
