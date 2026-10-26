# Integração de runtime com o SkyMP

> [!WARNING]
> Este documento contém uma proposta de integração direta com callbacks do fork e deve ser lido como referência histórica. A implementação atual deve passar pelos Host Ports canônicos, especialmente `WorldSnapshotPort`, spawn capability e `NativeDeathPort`; não registrar um segundo owner global de `mp.onDeath` como solução final.

Este documento descreve como conectar o AetheriusEnemySystem ao fork do SkyMP para administrar spawn, morte e ciclo de geração das dungeons. O núcleo deste repositório permanece independente do host: o projeto definitivo de integração fornece os callbacks, a persistência e as operações concretas do servidor.

## Visão geral

```text
SkyMP
  |
  +-- jogador muda de célula
  |        |
  |        v
  |  DungeonLifecycleManager
  |        |
  |        v
  |  inicia ou reutiliza uma geração
  |        |
  |        v
  |  AetheriusEnemySystem resolve os inimigos
  |        |
  |        v
  |  SkyMP cria os atores e persiste o resultado
  |
  +-- onDeath(vítima, assassino)
           |
           v
     DeathBridge
           +-- atualiza o estado da dungeon
           +-- impede respawn automático dentro da mesma geração
           +-- publica evento para o AetheriusLevelingSystem
```

## 1. Inicialização

Ao iniciar o servidor, o módulo de integração deve carregar:

- catálogo de dungeons;
- catálogo de inimigos;
- resultados da análise das listas `LVLN`;
- regras de classificação e progressão;
- estado persistido das gerações;
- uma seed permanente e privada do servidor.

Também deve construir dois índices rápidos:

```ts
const cellToDungeon = new Map<CanonicalCellId, DungeonId>();
const runtimeActorToSpawn = new Map<RuntimeActorId, PersistedSpawn>();
```

Antes de aceitar jogadores, a integração deve confirmar que os snapshots de plugins, inimigos, listas e dungeons pertencem ao mesmo epoch do MO2. Deve verificar também a presença das autoridades configuradas e a igualdade da quantidade de plugins ativos entre os dois perfis. O sistema não deve persistir essa quantidade nem índices da load order.

Se uma autoridade, identidade ou referência crítica estiver indefinida, o conteúdo afetado deve permanecer bloqueado pelo comportamento fail-closed.

## 2. Identificação da dungeon

O fork já expõe `getActorCellOrWorld`, `getDescFromId` e `getIdFromDesc`. Uma primeira integração pode acompanhar periodicamente a célula dos jogadores conectados:

```ts
const actorId = mp.getUserActor(userId);
const runtimeCellId = mp.getActorCellOrWorld(actorId);
const canonicalCell = mp.getDescFromId(runtimeCellId);
const dungeonId = cellToDungeon.get(canonicalCell);
```

Quando o valor mudar, o host chama:

```ts
lifecycle.playerLeftDungeon(userId, previousDungeonId);
lifecycle.playerEnteredDungeon(userId, dungeonId);
```

Uma otimização futura pode adicionar ao fork um evento nativo `onCellChanged`, emitido apenas quando o servidor confirmar uma troca real de célula. Isso evita polling, mas não é necessário para o primeiro protótipo.

## 3. Estado e ciclo da dungeon

Cada dungeon possui uma geração compartilhada por todos os jogadores:

```ts
interface DungeonRuntimeState {
  dungeonId: string;
  generation: number;
  status: "DORMANT" | "ACTIVE" | "CLEARED" | "RESET_PENDING";
  playersInside: number[];
  liveSpawnIds: string[];
  deadSpawnIds: string[];
  resetAt: number | null;
}
```

O ciclo recomendado é:

```text
DORMANT
  | primeiro jogador entra
  v
ACTIVE
  | todos os inimigos gerenciados morrem
  v
CLEARED
  | tempo de reset terminou e não há jogadores dentro
  v
RESET_PENDING
  | remove atores, restaura loot e incrementa generation
  v
DORMANT
```

Regras multiplayer:

- jogadores na mesma dungeon compartilham a geração;
- um segundo jogador não provoca outro sorteio;
- sair, desconectar ou reconectar não reinicia a dungeon;
- abandonar a dungeon durante o combate não apaga seu estado;
- somente um reset confirmado incrementa `generation`;
- se ainda houver jogadores dentro, o reset é adiado;
- o loot original é restaurado somente na criação de uma nova geração ou em um reset explícito.

## 4. Resolução e criação de inimigos

### 4.1 Identidade e seleção (inalteradas)

Para cada referência de spawn `ACHR` gerenciada, o host consulta o resolvedor server-authoritative:

```ts
const resolution = spawnResolver.resolve({
  spawnStableIdentity,
  generation: dungeon.generation,
  dungeonId,
  profile,
  families,
  roles,
  bossPolicy
});
```

Uma decisão persistida para o mesmo ponto e geração é reutilizada. Uma nova decisão usa os pesos derivados das listas originais; candidatos sem peso comprovado não recebem probabilidade uniforme inventada.

O NPC-base escolhido é resolvido contra a load order atual na borda do host:

```ts
const runtimeBaseId = mp.getIdFromDesc(
  toSkyMpFormDesc(resolution.resolvedNpcStableIdentity)
);
```

A identidade escolhida e o local de nascimento são fatos independentes: **o resolvedor de seleção não escolhe nem inventa a posição física**.

### 4.2 Preflight obrigatório de coordenadas (23/10/2026)

As posições de `spawnRefs` vêm dos registros vencedores `ACHR` extraídos pelo houseCARL. O catálogo preserva `cellIdentity`, `position: {x,y,z}` e `rotation: {x,y,z}`. A borda do SkyMP recebe `pos: [x,y,z]` e `rot: [x,y,z]`; enviar os objetos originais diretamente a `mp.set('locationalData')` é incompatível com o contrato nativo.

O módulo `src/spawning/location.mjs` implementa `validatePlacedSpawnLocation(spawnRef)` e `prepareSkyMpSpawnLocation(spawnRef, resolveCellOrWorldDesc)`. O `SkyMpIntegrationAdapter` expõe `prepareSpawnLocation(spawnRef)` e `spawnAtPlacedReference({spawnRef, ...context})`.

Validações sem fallback:

- O registro deve ser `ACHR`, com identidade e `cellIdentity` canônicas válidas.
- Posição e rotação devem conter `x`, `y`, `z` finitos, numéricos e explícitos; zero é válido quando presente no record original, mas ausência não é zero.
- O host **deve** resolver a célula do `ACHR` para um `cellOrWorldDesc` aceito pelo SkyMP. Para exterior, o descriptor pode ter de representar a `WRLD` original em vez da `CELL` exterior. A função injetada `resolveCellOrWorldDesc` deve usar o mundo/célula do registro original e a load order ativa, nunca a localização atual do jogador.
- Ausência do callback, referência malformada, descriptor vazio ou falha de resolução retornam `FAILED` e **não chamam o hook de spawn**.
- O novo preflight do `readiness` registra `DUNGEON_SPAWN_LOCATION_INVALID` para referências com dados espaciais inválidos, além do erro já existente de dungeon sem referências. Isso bloqueia o `readyForProduction`.
- A resolução do descriptor precisa de conferência no host: este módulo não implementa a ligação nativa com o SkyMP nem prova que o descriptor se refere ao worldspace correto.

### 4.3 Criação pelo host (contrato de integração, não implantação ativa)

Exemplo ilustrativo da interface que a integração concreta **deverá fornecer**. `resolveFromOriginalAchr` é um callback a implementar no host, não uma função pronta do SkyMP:

```ts
const adapter = new SkyMpIntegrationAdapter({
  resolveCellOrWorldDesc: resolveFromOriginalAchr,
  onServerSpawn({ runtimeBaseId, spawnRef, location }) {
    const actorId = mp.place(runtimeBaseId);
    mp.set(actorId, 'locationalData', location);
    mp.set(actorId, 'spawnPoint', location);
    mp.set(actorId, 'private.aetherius.spawnId', spawnRef.identity);
    return { actorId };
  }
});

const created = adapter.spawnAtPlacedReference({
  spawnRef: spawn, // entrada ACHR do catálogo, com suas coordenadas originais
  runtimeBaseId
});
if (created.status === 'FAILED') {
  // Não criar o ator por outro caminho; registrar referência e motivo.
}
```

O `mp.place(baseId)` do SkyMP original cria inicialmente na origem de Tamriel e publica a referência antes de atualizar a posição. O exemplo acima é transitório: **para produção deve-se preferir uma capacidade nativa `placeAt(baseId, location)` ou equivalente, que já crie o ator na célula correta, sem aparição inicial no local errado**. Tal capacidade não foi implementada por este commit e depende de mudança separada no host.

O host também deve impedir a materialização simultânea do `ACHR` nativo e do ator dinâmico gerenciado. `locationalData` e `spawnPoint` precisam receber a mesma localização autorizada. Depois da criação, comparar a posição/célula reais do ator com a referência original e registrar discrepâncias; não corrigir por aproximação à posição do jogador.

**Escopo desta correção:** contratos, bloqueios de dados inválidos, adapter callback e testes locais; sem alteração no algoritmo de seleção, pesos `LVLN`, nível, economia, distribuição de encontros, pontos originais nem código binário do SkyMP. Não há alegação de teste em jogo ou cutover do EnemySystem.

## 5. Referências originais

Os `ACHR` originais não podem permanecer ativos ao mesmo tempo que os atores gerados. Cada `ACHR` gerenciado funciona como identidade lógica e fonte do ponto de spawn.

A primeira implementação pode resolver o runtime FormID do `ACHR`, desativar a referência original e criar o ator dinâmico correspondente. Para produção, recomenda-se um filtro nativo antes da materialização:

```cpp
bool ShouldAttachPlacedNpc(FormDesc achr, FormDesc cell);
```

Quando a referência pertence a uma dungeon administrada, o SkyMP não materializa o NPC original. Isso evita duplicação ou uma aparição breve antes da desativação. NPCs únicos autorizados como bosses são criados explicitamente pelo sistema, sem colocá-los nos pools genéricos.

## 6. Morte e bloqueio do respawn automático

O fork publica `onDeath(actorId, killerId)`. Deve existir um único roteador para não sobrescrever handlers de outros sistemas:

```ts
mp.onDeath = (victimId: number, killerId: number) => {
  const spawn = runtimeActorToSpawn.get(victimId);

  if (!spawn) {
    return true; // comportamento original para um ator não gerenciado
  }

  const result = deathBridge.publish({
    victimId,
    killerId,
    enemy: spawn.enemyDescriptor,
    progressionContext: spawn.progressionContext,
    respawnGeneration: spawn.generation,
    deathGeneration: spawn.deathGeneration
  });

  if (!result.duplicate && result.errors.length === 0) {
    persistence.markDeadIfAlive(
      spawn.spawnStableIdentity,
      spawn.generation,
      result.event.eventId
    );
    lifecycle.enemyDied(spawn.dungeonId, spawn.spawnStableIdentity);
    levelingBridge.consume(result.event);
  }

  return false;
};
```

No SkyMP atual, uma morte aceita pelo gamemode executa `DeathEvent::OnFireSuccess` e agenda `RespawnWithDelay`. Para atores gerenciados, o handler retorna `false`: o inimigo permanece morto e somente o `DungeonLifecycleManager` pode substituí-lo em uma nova geração. Para atores não gerenciados, o handler retorna `true` e preserva o comportamento original.

O `killerId` igual a zero continua significando que não há assassino atribuível. A deduplicação usa uma identidade de evento derivada do spawn e das gerações, e não apenas do NPC-base.

## 7. Reset

Quando o reset for permitido, o host:

1. destrói os atores dinâmicos vivos ou mortos;
2. remove os runtime IDs dos índices transitórios;
3. incrementa `generation` de forma atômica;
4. restaura a composição original do loot;
5. muda a dungeon para `DORMANT`;
6. cria a próxima população quando um jogador entrar novamente.

```ts
for (const actorId of dungeon.runtimeActorIds) {
  mp.destroyActor(actorId);
}

const nextGeneration = await persistence.beginNextGeneration(dungeonId);

adapter.resetDungeon({
  dungeonId,
  generation: nextGeneration
});
```

O runtime actor ID pode mudar entre gerações e reinicializações do servidor. Ele nunca é a identidade persistente do spawn.

## 8. Persistência

O armazenamento permanente deve registrar pelo menos:

```ts
interface PersistedSpawn {
  spawnStableIdentity: string;
  dungeonId: string;
  generation: number;
  resolvedNpcStableIdentity: string;
  status: "ALIVE" | "DEAD";
  eventId?: string;
}
```

As operações críticas devem ser atômicas:

```ts
markDeadIfAlive(spawnId, generation, eventId);
beginNextGeneration(dungeonId);
```

Isso impede que dois relatos da mesma morte concedam XP duas vezes e evita que duas entradas simultâneas iniciem gerações diferentes.

## 9. Componentes do projeto definitivo de integração

Estrutura sugerida:

```text
integration/aetherius-enemy/
  bootstrap.ts
  SkyMpEnemyHost.ts
  SkyMpDeathRouter.ts
  DungeonLifecycleManager.ts
  DungeonOccupancyTracker.ts
  repositories/
    DungeonStateRepository.ts
    SpawnStateRepository.ts
```

O projeto deve ligar essas implementações às portas existentes em `src/adapters/skymp-adapter.mjs`, `src/persistence/spawn-state.mjs`, `src/events/event-hub.mjs` e `src/loot-integration/policy.mjs`.

## 10. Pré-requisito de dados

O catálogo global identifica as dungeons de toda a load order e o estágio de enriquecimento incorpora seus `ACHR`, bases `NPC_` ou `LVLN`, candidatos alcançáveis, posição, rotação, célula, papel e proveniência. A associação usa identidades canônicas de célula ou localização e recusa snapshots de epochs diferentes.

O runtime deve permanecer fail-closed para qualquer perfil sem `spawnRefs` ou com bases/famílias não resolvidas. O relatório de enriquecimento registra quantas dungeons receberam atores, quantas evidências permaneceram sem resolução e quantos candidatos de inimigos foram associados.

## 11. Validação multiplayer

A integração deve ser validada com:

- NPCs fixos, dinâmicos e baseados em template;
- listas `LVLN` simples e aninhadas;
- bosses únicos e Dragon Priests;
- jogadores entrando simultaneamente na mesma dungeon;
- saída, desconexão, reconexão e reinício do servidor;
- mortes simultâneas e prevenção de eventos duplicados;
- reset e nova geração;
- equipamento, inventário, magias e efeitos dos NPCs criados;
- restauração de loot e containers esvaziados.

O runtime só deve ser considerado pronto quando os snapshots estiverem no mesmo epoch, as referências críticas estiverem resolvidas e essa matriz tiver sido executada no servidor real.
