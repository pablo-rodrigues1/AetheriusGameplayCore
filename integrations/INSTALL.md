# Guia de integração do AetheriusGameplayCore

**DOC-2 · 25/10/2026 · guia vigente.** Esta edição substitui o guia de 12/10; o histórico daquela versão permanece no commit anterior. O código do Core desta entrega é o merge `a2f0517` na `main` (integra os nove commits do outro desenvolvedor); o commit seguinte só preenche esta referência. A aplicação dos patches em clones limpos não prova build, boot, load order oficial ou comportamento no jogo.

> **Nota de 02/11/2026:** os pacotes deste guia já foram aplicados no `aetherius-server` (`b84ce03`) e no `aetherius-client` (`9a8cdf8`), que passaram a ter o código vivo do host e do cliente. O que mudou lá depois (DS-5c, DS-7) e voltou para este repositório está em [SINCRONIZACAO_SERVIDOR_20261102](../docs/operations/SINCRONIZACAO_SERVIDOR_20261102.md).

## Resumo para o mantenedor

- **Entrega:** patch do host com 35 arquivos e patch de produção do cliente com 5 arquivos; há ainda um patch de trace separado, só diagnóstico. Os patches passaram em clones limpos nas bases declaradas e todos os hashes do manifesto bateram. A prova não incluiu build nem servidor oficial. Os pacotes e limites estão em [host](host/LEIA-ME.md) e [cliente](client/LEIA-ME.md).
- **Estado inicial:** todos os modos do Core e todas as famílias da fórmula ficam `off`; veneno e sondas ficam desligados. O host continua sendo o owner do resultado de dano aplicado.
- **Ordem:** [1 · host](#passo-1-host) → [2 · PostgreSQL](#passo-2-postgresql) → [3 · catálogos](#passo-3-catlogos) → [4 · bundle](#passo-4-bundle) → [5 · .env](#passo-5-env) → [6 · settings](#passo-5-settings) → [7 · cliente](#passo-6-cliente) → [8 · ativação](#passo-7-ativao-e-conferncia).
- **Não faça:** não copie arquivos integrais sobre trabalho do mantenedor; não ligue domínio se a verificação do catálogo falhar; não use índices de load order ou nomes localizados como identidade; não aplique o trace diagnóstico no cliente oficial; não use `100` como multiplicador neutro (`100` significa 100×).

## 1. Escopo e autoridade

O servidor decide concessões, persistência e projeções. O cliente envia intenção e evidência, nunca dano, cura, XP, skill, atributo, grant, duração ou abate final. O Core usa o pool PostgreSQL único do gamemode, `server/gamemode/core/pg.js`; cria tabelas próprias com prefixo `gc_` e não lê nem escreve MySQL legado, tabelas do painel, contas, sessões, inventário, ouro ou economia. Não crie outro pool, ledger, inventário ou `ActorCombatState`. Fontes: [ADR D8](../docs/architecture/adr/D8-mudancas-no-host.md), [runtime](../runtime/src/index.ts), [runner de migrations](../runtime/migrations.mjs). Os limites de escopo também constam do registro interno do workspace (não incluído), AGENTS.md, seções 1, 3 e 5.

Records persistidos usam `StableFormKey`: plugin de definição mais FormID local. Personagens persistidos usam `CharacterKey`; `actorId` e `userId` só valem em `SessionBinding` com epoch. Não use nome localizado, índice de plugin, FormID de runtime ou posição na load order como identidade. Falta de record, capability ou contexto é `UNSUPPORTED`, sem fallback. Fonte: [ADR D5](../docs/architecture/adr/D5-dano.md), [contratos](../shared/contracts/src/index.ts), [adapter de catálogo](../tools/catalog/host.ts).

Concessão e resultado têm owners separados. O host (`NATIVE_SERVER`) mantém o resultado de combate aplicado; DS-5 calcula um candidato `AETHERIUS_SERVER` somente em shadow. Não aplique os dois. `EnemySystem` escolhe spawn, listas niveladas, respawn e substituição de NPC. `DamageSystem` pode observar a criatura para dados de combate de NPC não gerenciado; **DamageSystem não decide spawn** (Q13). Fontes: [owners de dano](../modules/damage-system/docs/FONTES_E_DONOS.md), [integração e autoridade de spawn](../modules/damage-system/docs/INTEGRACAO_HOST_E_AUTORIDADE_DE_SPAWN.md), [DS5A](host/DS5A.md), decisão Q13 no registro interno do workspace (não incluído).

## 2. Situação atual por sistema

“Confirmado em jogo” abaixo significa sessão registrada pelo dono no servidor local; não significa homologação oficial. “Só automatizado” não é confirmação de gameplay.

| Sistema | Confirmado em jogo | Só automatizado | Não confirmado | Desligado, suspenso ou dev | Fontes |
|---|---|---|---|---|---|
| Pedras guardiãs | Sessão C1, 08/10: escolha, troca, repetição, reconexão e mensagens observadas no servidor local. | Provider e persistência têm testes do Core. | Servidor oficial e resultado de gameplay pelo novo owner. | Modo começa `off`. | [runtime](../runtime/src/index.ts); sessão C1 de 08/10, registro interno do workspace (não incluído). |
| Raças | Sessão C2, 08/10: raça observada e grants registrados localmente; foram observadas 3 habilidades e 1 perk `RACE`. | Provider/ownership e contrato têm testes. | Efeitos raciais em combate multiplayer e servidor oficial. | Modo começa `off`; os resultados raciais continuam `NATIVE_CLIENT`. | [ownership de raças](../modules/race-system/ownership.json); sessão C2 de 08/10, registro interno do workspace (não incluído). |
| Classes e perks de classe | Sessão B5b, 12/10: 162/162 marcos em 18 classes; entrega de perks `CONFIRMED`, revalidada às 23:02. Isso prova entrega/presença, não efeito de cada perk. | Protocolo, composição, idempotência e fila têm testes. | Efeito de cada perk e homologação oficial. | Modo de classes e `GAMEPLAY_CORE_CLIENT_PERKS_MODE` começam `off`; varredura/overrides são somente dev. | [fila de entrega](../runtime/src/projection/DELIVERY.md); [perks](../runtime/src/projection/perks.ts); sessões B5b/C3c, registro interno do workspace (não incluído). |
| Pontos de atributo C3d | Não testados em jogo; o dono reservou a homologação para o servidor oficial. | Contrato de alocação e persistência passaram pelos aceites automatizados. | Tela, três máximos e reconexão no oficial. | Requer classes, migration 0009 e propriedade nativa do host; sem suporte declara `UNSUPPORTED`. | [contrato C3d](../docs/classes/ATRIBUTOS_C3d.md); [sistema de atributos](../runtime/src/attribute-system.ts); sessão C3d, registro interno do workspace (não incluído). |
| Catálogos `combat`, `npcs` e `effects` | Não confirmam efeito de gameplay. | DS-2d real-host `PASSED` para seis domínios, incluindo plugins reordenados. | Load order oficial atual. | Verifique os arquivos atuais antes de usar; catálogo não ativa efeito nem certifica owner. | [geração/verificação](../tools/catalog/README.md); [verificador](../tools/catalog/verify.ts); parecer DS-2d, registro interno do workspace (não incluído). |
| Perfil de combate DS-4 | Não confirmado em jogo. | Perfil, fontes de perks e limpeza foram testados/revisados. | Consumo do perfil por cálculo de hit no oficial. | Perfil é projeção, não resultado de dano. | [owners de dano](../modules/damage-system/docs/FONTES_E_DONOS.md); pareceres DS-4/fix2/fix3, registro interno do workspace (não incluído). |
| Observação de NPC DS-0g e correção de posição DS-0i | Sessão local de 24/10 recebeu observações e registrou `indexedTeleport APPLIED`. Esse status prova retorno da chamada nativa, não convergência do motor. | Harness e código têm testes. | Load order oficial e convergência final no motor. | Cliente relata evidência; não escolhe, cria, substitui ou move spawn por autoridade própria. | [observação no cliente](client/files/client/src/services/services/npcObservationService.ts); [correção indexada](client/files/client/src/services/services/remoteServer.ts); sessões DS-0g/DS-0i, registro interno do workspace (não incluído). |
| Arma de NPC após respawn e conversão CNTO DS-0k | Sessão em jogo pendente. Os crashes vistos depois não tiveram causa atribuída. | Testes nativos de equipamento passaram; harness com host real foi inconclusivo. | Respawn hostil no oficial: owner nativo ou `EnemySystem`, e se a reequipagem continua necessária. | Limites de LVLI estão registrados; DS-0k não autoriza DamageSystem a escolher spawn. | [host: observação/equipamento](host/files/server/cpp/server_guest_lib/aetherius_combat/NpcObservation.h); pareceres DS-0k/fix3 e registro de crash de 25/10, registros internos do workspace (não incluídos). |
| Fórmula física DS-5a/DS-5b | Não confirmada em jogo; não há sessão shadow. | Dourados DS-5b: 26 `PASS`, 0 `FAIL`, 10 `PENDING`; revisão aprovou a entrega parcial. | Recalcular dano em jogo e qualquer promoção para `active`. | `families` ausente ou `off` preserva o resultado atual; `active` bloqueia com `ACTIVE_REQUIRES_DS7`. | [host DS5A](host/DS5A.md); [host DS5B](host/DS5B.md); parecer DS-5b, registro interno do workspace (não incluído). |
| XP de Leveling por abate | Não conectado: falta uma fonte de morte confirmada pelo servidor. | O entry point de XP tem testes de domínio. | Evento/owner confiável de morte e XP. | `GAMEPLAY_CORE_MODE_LEVELING=off`. | [runtime](../runtime/src/index.ts); decisões de Leveling, registro interno do workspace (não incluído). |
| Religião, feitiços e perks fora de classes, dano mágico, procs, durabilidade, refino real e perks SPID (função 26) | Não confirmados; não entregues neste pacote. | Não se infere cobertura a partir de catálogos ou documentos. | Implementação e owner certificados. | Modos `off`; sem fallback. | [owners de dano](../modules/damage-system/docs/FONTES_E_DONOS.md); [configuração de modos](../runtime/src/index.ts). |
| Veneno em arma | Suspenso pelo dono do projeto. | Histórico/testes não retiram a suspensão. | Reativação depende de nova decisão. | `aetheriusCombat.weaponPoison` ausente ou `false`; patch cumulativo suspenso. | [ativação](../docs/operations/ATIVACAO_DOS_SISTEMAS.md); [patch suspenso](client/suspenso/B5b-mais-veneno-fix3-aa864cb.patch). |
| Sonda e trace de hit | Não são evidência de gameplay. | Ferramentas de diagnóstico registram dados; não mudam o filtro de hit. | Uso operacional no oficial não foi autorizado. | `aetheriusCombat.probe`, `GAMEPLAY_CORE_DEV_COMBAT_PROBE*` e patch `npc-hit-trace` ausentes no oficial. | [sonda do host](host/files/server/cpp/server_guest_lib/aetherius_combat/CombatProbe.h); [patch diagnóstico do cliente](client/diagnostico/npc-hit-trace.patch); [código de hit](client/files/client/src/services/services/hitService.ts). |

As sessões acima e pareceres de revisão são registros internos do workspace (não incluídos neste repositório). A conferência fonte por fonte de cada linha está em `_work/evidence/DOC-2/source-checklist-r2.md`.

## 3. Bases, pré-requisitos e identidade

### Baselines dos pacotes

- Host aetherius-server: 6181abf1774c31a4e93206f71b784af5b13f10ae.
- Cliente aetherius-client: 31566e83fc5f991aaa29f6ee0e868f8a558fe2ad.
- Core: `main` a partir do merge `a2f0517` (entrega de 25/10/2026; o commit seguinte só preenche esta referência). O guia foi revisado sobre d2e79ae3ee3eef5c49c0d992c6676fca4a527e64. A main remota tinha nove commits do outro desenvolvedor (EnemySystem e DurabilitySystem), integrados nesse merge; testes desses módulos passaram depois do merge (enemy-system 82/82, durability-system 13/13). EnemySystem pertence a esse desenvolvedor. Não remova nem substitua esses commits. Registro interno do workspace (não incluído): ordem DOC-2 e Adendo 1.
- O patch do host tem SHA-256 ad62636998ce7e7aedb68364ebb77a942a0c7afe657fa3c93df0fadb5a8c1d2f e 35 arquivos (17 modificados, 18 adicionados). O patch de produção do cliente tem SHA-256 007d8c3f71964a79b536b4c2ca309b21ff9acaf62be9d95e366804aa43068755; são 5 arquivos de produção. Cada patch foi aplicado em clone limpo de sua base e comparado ao manifesto; host 35/35 e cliente 5/5. O patch diagnóstico separado do cliente foi provado à parte, 2/2. Prova DOC-2, registro interno do workspace (não incluído).

### Ambiente e load order

O Core requer Node.js >=22.14.0; use npm 10. A versão PostgreSQL do servidor oficial não foi verificada; o banco local de desenvolvimento usa PostgreSQL 18. Confirme a versão operacional com o mantenedor. Não use MySQL. Fonte: [package.json do Core](../package.json); informação de versão local, registro interno do workspace (não incluído).

Os catálogos entregues foram gerados a partir da instalação do launcher MO2 `C:/modOrganizer`, perfil `AETHERIUS - GRAFICO - QUALIDADE`. Em 25/10, o verificador passou nos seis domínios contra a cópia de dados disponível em `aetherius-server/build/dist/server/data` no workspace; o manifesto local tinha data de 22/10. Essa leitura offline não prova que os mesmos arquivos estejam atualmente implantados no servidor oficial. Antes de ativar qualquer domínio, rode o passo 3 contra os arquivos do deployment oficial do mantenedor.

A identidade do record é o plugin de definição mais FormID local; resolva FormID runtime no boot com a load order carregada. Não fixe índices, slot, contagem de plugins ou números de FormID de runtime em código, configuração ou persistência. A lista efetiva de plugins vem da instalação oficial e pode mudar. Fontes: [D5](../docs/architecture/adr/D5-dano.md), [catálogo](../tools/catalog/README.md).

## 4. Instalação passo a passo

Esta é uma instrução para o mantenedor. A ordem DOC-2 não aplicou os patches nos repositórios oficiais, não compilou host ou cliente, não acessou banco, não mudou settings e não iniciou servidor. Fez provas de patch/hash em clones temporários e uma verificação offline dos catálogos contra a cópia de dados do workspace, não contra um servidor ao vivo. Os detalhes operacionais preservados por sistema e as notas históricas estão em [ATIVACAO_DOS_SISTEMAS.md](../docs/operations/ATIVACAO_DOS_SISTEMAS.md).

<a id="passo-1-host"></a>
### 1. Aplicar e compilar o host

Use clone de integração e confira que o HEAD é exatamente a baseline. Se ela divergir, pare para revisão. Primeiro rode `git apply --check`, depois aplique o delta. Nunca copie `host/files/` por cima do mantenedor; essas cópias servem para revisão. O manifesto lista os 35 arquivos e seus hashes. Fonte: [pacote do host](host/LEIA-ME.md), [manifesto](host/manifest.json).

~~~powershell
git apply --check "<Core>/integrations/host/changes.patch"
git apply "<Core>/integrations/host/changes.patch"
~~~

Reconfigure e compile com o toolchain, o gerador, a arquitetura e as opções que o servidor oficial já usa. A receita versionada no repositório do servidor é aetherius-server/cmake_server_build.txt; ajuste somente caminhos locais ao ambiente do mantenedor. Forma do comando registrado nessa receita:

~~~powershell
Set-Location "<aetherius-server>\build"
cmake .. -G "Visual Studio 17 2022" -A x64 -DCMAKE_TOOLCHAIN_FILE="../vcpkg/scripts/buildsystems/vcpkg.cmake" -DVCPKG_TARGET_TRIPLET=x64-windows-sp -DVCPKG_OVERLAY_TRIPLETS="../overlay_triplets" -DSKYRIM_DIR="<caminho do Skyrim SE mantido pelo operador>" -DBUILD_SKYRIM_PLATFORM=ON -DSIMPLEINI_INCLUDE_DIRS="$PWD/vcpkg_installed/x64-windows-sp/include" -DCMAKE_INCLUDE_PATH="$PWD/vcpkg_installed/x64-windows-sp/include"
cmake --build . --config Release --target skymp5-server
~~~

Os fontes novos entram pelos globs do CMake. Use a rotina de deploy do mantenedor e revise o server-settings.json do diretório de execução depois de sincronizar plugins; não copie settings locais junto com o build. DOC-2 não executou CMake, build ou boot. Fontes: [LEIA-ME do host](host/LEIA-ME.md), [pacote espelhado](host/files/server/cpp/server_guest_lib/aetherius_combat/ds5a/Host.h).

<a id="passo-2-postgresql"></a>
### 2. Aplicar e conferir migrations PostgreSQL

Execute da raiz do Core, usando o arquivo core/pg.js do gamemode e a conexão já configurada no processo do servidor. Não imprima nem registre a URL. Schema padrão: public; schema customizado precisa existir antes e deve ser igual no runner e em GAMEPLAY_CORE_DATABASE_SCHEMA.

~~~powershell
npm run migrations:apply -- "<caminho absoluto>/server/gamemode/core/pg.js" [schema]
npm run migrations:status -- "<caminho absoluto>/server/gamemode/core/pg.js" [schema]
~~~

Hoje são nove migrations, numeradas e aplicadas em ordem:

| Versão | Tabela(s) gc_* |
|---|---|
| 0001 | `gc_schema_migrations` |
| 0002 | `gc_commands` |
| 0003 | `gc_spell_projection_heads`, `gc_spell_projections` |
| 0004 | `gc_standing_stone_choice` |
| 0005 | `gc_race_observation` |
| 0006 | `gc_character_class` |
| 0007 | `gc_leveling_progress` |
| 0008 | `gc_perk_projections` |
| 0009 | `gc_attribute_allocation` |

0001–0007 e 0009 são arquivos SQL em database/migrations/; 0008 é declarada em [migration.ts](../runtime/src/projection/migration.ts) e incluída pelo mesmo runner. Ele ordena numericamente, valida antes de aplicar, usa transação atômica e lock por schema. gc_schema_migrations guarda version, sha256 e applied_at; repetir apply com conteúdo igual é idempotente. status falha se o ledger não existir, se houver versão pendente ou se um hash não corresponder. Rode apply antes do status em schema novo.

Para uma conferência somente leitura:

~~~sql
SELECT version, sha256, applied_at
FROM public.gc_schema_migrations
ORDER BY version;
~~~

Não edite migration já aplicada. Não há down-migrations: para desligar um sistema, desligue-o pela configuração e preserve tabelas/dados. Não remova grants ou dados por SQL. Qualquer remoção durável exige ordem específica e revisão. Fontes: [runner](../runtime/migrations.mjs), [implementação de migrations](../shared/persistence/src/migrations.ts).

<a id="passo-3-catlogos"></a>
### 3. Verificar catálogos com os plugins oficiais

Antes de compilar bundle ou ligar domínio, confira que o clone do Core e o checkout oficial do host são pastas irmãs e rode o verificador da raiz do workspace:

~~~powershell
node --experimental-strip-types AetheriusGameplayCore/tools/catalog/verify.ts .
~~~

O argumento real é a raiz do workspace. verify.ts lê os seis JSONs do catálogo e os arquivos relacionados em aetherius-server/build/dist/server/data, guiado por aetherius-loadorder.json. Compara assinatura de domínio, cada record e os fingerprints filename, size, crc32 e isLight dos plugins alcançados. Também varre identidade indexada/runtime. Isso é verificação offline dos arquivos, não um servidor vivo. Fontes: [README do catálogo](../tools/catalog/README.md), [verificador](../tools/catalog/verify.ts), [fingerprinting](../tools/catalog/host.ts).

Se passar, use os catálogos entregues para os domínios verificados. Se falhar em um domínio, **não ligue esse domínio** e peça ao dono/Opus 5.5 para regenerar os exports e o catálogo com houseCARL contra a instância oficial; depois repita verify. Não corrija assinatura manualmente, não use nome como chave, não escolha outro record como fallback. O processo de regeneração está no [Apêndice A](#apendice-a-catalogos).

<a id="passo-4-bundle"></a>
### 4. Construir o bundle do Core

Com as dependências instaladas pelo lockfile e catálogos verificados:

~~~powershell
Set-Location "<AetheriusGameplayCore>"
npm run build
~~~

O build gera dist/aetherius-gameplay-core.cjs; aponte GAMEPLAY_CORE_BUNDLE para esse arquivo no diretório de execução do gamemode. Recompile depois de alterar catálogos. Fonte: [build do runtime](../runtime/build.mjs), [package.json](../package.json).

<a id="passo-5-env"></a>
### 5. Configurar o .env do gamemode

Para comissionamento autorizado, carregue o bundle com os modos de sistema ainda off. Canário deve ser uma decisão explícita; GAMEPLAY_CORE_CANARY_CHARACTERS aceita entradas profile:<número positivo>. Valores de modo aceitos: off, audit, shadow, canary, active; ausente significa off. A tabela inclui todos os nomes de configuração GAMEPLAY_CORE_* encontrados no runtime atual.

| Variável | Valor inicial recomendado | Uso |
|---|---|---|
| ENABLE_GAMEPLAY_CORE | true somente após revisão e autorização de comissionamento; caso contrário false | Carrega o módulo do Core. O exemplo de host vem desligado. |
| GAMEPLAY_CORE_BUNDLE | Caminho absoluto do bundle revisado | Caminho de aetherius-gameplay-core.cjs. |
| GAMEPLAY_CORE_DATABASE_SCHEMA | public, ou o schema oficial aprovado | Deve coincidir com o runner de migrations. |
| GAMEPLAY_CORE_CANARY_CHARACTERS | Ausente/vazio enquanto não houver canário autorizado | Lista de profile:<id> permitidos nos modos canary. |
| GAMEPLAY_CORE_MODE_STANDING_STONES | off | Concessão de pedra. |
| GAMEPLAY_CORE_MODE_RACES | off | Observação/concessão de raça; não move o owner do resultado racial. |
| GAMEPLAY_CORE_MODE_CLASSES | off | Classes e progressão por marcos. |
| GAMEPLAY_CORE_MODE_LEVELING | off | XP por abate segue sem fonte de morte confirmada. |
| GAMEPLAY_CORE_MODE_DAMAGE | off | Modo do sistema no Core; não ativa sozinho a fórmula nativa DS-5. |
| GAMEPLAY_CORE_MODE_RELIGION | off | Não entregue. |
| GAMEPLAY_CORE_MODE_SPELLS | off | Não entregue como sistema independente. |
| GAMEPLAY_CORE_MODE_PERKS | off | Não entregue fora dos perks de classe. |
| GAMEPLAY_CORE_CLIENT_PERKS_MODE | off | Canal de entrega; active/canary requer migration 0008, cliente compatível e sessão pronta. |
| GAMEPLAY_CORE_ALLOW_DEV_OPTIONS | Ausente | Chave da trava de desenvolvimento; nunca presente no oficial. |
| GAMEPLAY_CORE_DEV_CLASS_SWEEP | Ausente | Varredura temporária de classes, somente desenvolvimento. |
| GAMEPLAY_CORE_DEV_CLASS_LEVEL | Ausente | Override de nível, somente desenvolvimento. |
| GAMEPLAY_CORE_DEV_ATTRIBUTES | Ausente | Override transitório de máximos, somente desenvolvimento. |
| GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY | Ausente | Compatibilidade de identidade offline antiga, somente desenvolvimento. |
| GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV | Ausente | Auto-apply em boot, somente desenvolvimento. |
| GAMEPLAY_CORE_DEV_COMBAT_PROBE | Ausente | Sonda de combate, somente desenvolvimento. |
| GAMEPLAY_CORE_DEV_COMBAT_PROBE_FILE | Ausente | Caminho absoluto JSONL exigido se a sonda dev for ligada. |

ENABLE_STANDING_STONE_SPIKE também deve estar ausente: é o protótipo antigo, não começa com GAMEPLAY_CORE_. **Toda opção dev deve estar ausente**, não vazia nem false; sua presença fora da trava resulta em erro/refusa o subsistema. A trava exige simultaneamente NODE_ENV=local, GAME_ACCESS_CONTROL diferente de true e GAMEPLAY_CORE_ALLOW_DEV_OPTIONS=true. offlineMode do host não é critério de desenvolvimento. Fontes: [lista/trava](../runtime/src/development.ts), [configuração e modos](../runtime/src/index.ts), [sonda](../runtime/src/combat-probe.ts).

<a id="passo-5-settings"></a>
### 6. Configurar server-settings.json de combate

Exemplo inicial explicitamente desligado:

~~~json
{
  "aetheriusCombat": {
    "families": { "melee": "off", "ranged": "off", "unarmed": "off" },
    "multipliers": { "pve": 1, "pvp": 1 },
    "probe": false
  }
}
~~~

families ausente também equivale a todas off; isso preserva a cadeia de dano atual. Quando fornecido, cada valor é off, shadow ou active. multipliers.pve e .pvp são **fatores diretos**, finitos entre 0 e 100: **neutro é 1; 100 multiplica por 100**. Inclua ambos os campos. O host aplica normal × global; o padrão da configuração é 1. probe fica ausente ou false; weaponPoison fica ausente ou false. As opções antigas shadow e physicalRecords são históricas e não ligam DS-5. Fontes: [Host.h espelhado](host/files/server/cpp/server_guest_lib/aetherius_combat/ds5a/Host.h), [Physical.h espelhado](host/files/server/cpp/server_guest_lib/aetherius_combat/ds5a/Physical.h), [guia do host](host/LEIA-ME.md).

Não use active: o host responde ACTIVE_REQUIRES_DS7. Para shadow, após autorização e conferência de catálogo, escolha uma ou mais famílias shadow e deixe as demais off; o resultado vigente continua sendo NATIVE_SERVER, candidato AETHERIUS_SERVER. O Core só publica perfis de jogador se uma fonte compatível entre pedra/raça/classe estiver em canary ou active; ligar GAMEPLAY_CORE_MODE_DAMAGE isoladamente não os publica. DS-5b cobre apenas perks CLASS, nove entry points e nove condições certificadas; bash, Q16, furtivo, cinco regras de chance crítica, origens fora de CLASS e prioridade sem prova seguem UNSUPPORTED/inativos. Fontes: [DS5A](host/DS5A.md), [DS5B](host/DS5B.md), [owners](../modules/damage-system/docs/FONTES_E_DONOS.md).

<a id="passo-6-cliente"></a>
### 7. Aplicar e compilar o cliente

Use clone limpo na base 31566e83fc5f991aaa29f6ee0e868f8a558fe2ad, rode git apply --check e aplique client/changes.patch. Esse delta inclui observação de NPC hospedado e tratamento de correção indexada com verificação de identidade. Ele não escolhe, cria, troca nem autoriza spawn. APPLIED indica apenas que a chamada nativa retornou. As cópias em client/files/ servem para revisão/hash; não as copie por cima do mantenedor. Fonte: [pacote do cliente](client/LEIA-ME.md), [manifesto](client/manifest.json).

~~~powershell
git apply --check "<Core>/integrations/client/changes.patch"
git apply "<Core>/integrations/client/changes.patch"
Set-Location "<aetherius-client>\client"
npm run build
~~~

O projeto declara build: webpack em client/package.json. DOC-2 provou patch/hash, não build nem teste do cliente. client/diagnostico/npc-hit-trace.patch é separado; não o aplique no oficial. O antigo client/historico/B5b-aa864cb.patch usa base supersedida e não deve ser aplicado.

<a id="passo-7-ativao-e-conferncia"></a>
### 8. Ordem de ativação

1. Mantenha todos os modos off e confira boot, migrations, catálogo e capacidade do host.
2. Só após decisão do dono, libere um sistema por vez em canário; não misture owners de resultado.
3. Pedras e raças: ativação não muda o owner dos efeitos. Classes/perks: faça a entrega pelo canal compatível e exija estado CONFIRMED; isto prova entrega, não efeito do perk. Atributos C3d exigem 0009 e a propriedade nativa no host, ainda sem homologação de jogo.
4. Fórmula DS-5: siga o passo 6 e DS5A/DS5B. Shadow é observação; active permanece bloqueado pela DS-7.
5. Levelling por abate, religião, magia, procs, durabilidade e refino permanecem desligados até haver fonte/contrato/cobertura aprovados.

Nenhuma sessão local descrita neste guia autoriza ativação no servidor oficial. A decisão de ligar e a validação em jogo continuam com o dono do projeto. Fonte: registros C1/C2/B5b/C3d e DS-5b, registros internos do workspace (não incluídos).

### 9. Shadow de dano e leitura do trace

O shadow DS-5 observa o candidato e retorna a cadeia vigente; não escreve no caminho do hit e não requer aetheriusCombat.probe. Para uma execução de harness privada e isolada, use runtime/tests/ds5a-host.mjs --help e os argumentos obrigatórios da versão atual, com porta livre diferente de 7777 e diretório de trabalho separado. Depois leia getAetheriusCombatCapabilities() para owners/modos e getAetheriusCombatShadow() para o buffer dos últimos 1.024 hits, quando o binding estiver disponível. Consulte [DS5A](host/DS5A.md) e [contrato de dano](../modules/damage-system/docs/FONTES_E_DONOS.md).

O trace contém revisões, componentes, candidato, status e motivo; a sequência do buffer não é identidade única do golpe. HitMessage ainda não tem identidade de hit para a DS-7. Não há comando administrativo documentado para extrair esse buffer do servidor oficial; não habilite sondas nem crie canal de debug no oficial para contornar isso. A ordem DOC-2 não executou o harness. A sonda aetheriusCombat.probe/GAMEPLAY_CORE_DEV_COMBAT_PROBE* é ferramenta distinta e dev-only.

### 10. Conferência no boot e por personagem

No boot, confira bundle <versão>; initialized; active instances=1, migrations completas, catálogos aceitos e ausência de DEV/ERROR ... refused. Verifique que o servidor tem exatamente uma instância do Core. O Core emite mensagens de aviso pelo nível info; procure o texto e o prefixo, não suponha que ERROR no corpo seja um nível de log. Fontes: [runtime](../runtime/src/index.ts), [attributes](../runtime/src/attribute-system.ts).

Para explicar um personagem, use a ferramenta somente leitura a partir da raiz do Core:

~~~powershell
node runtime/explain-character.mjs "<gamemode>/core/pg.js" profile:<id> [schema]
~~~

Ela abre transação somente leitura, mostra pedra, raça, classe, nível/origem, marcos, alocação e recusas; não aplica migrations nem mutações. Não salve a URL do banco em evidência. Fonte: [ferramenta de explicação](../runtime/explain-character.mjs), [implementação](../runtime/src/explanation.ts).

| Trecho de log | Leitura e ação |
|---|---|
| [gameplay-core] bundle <versão>; initialized; active instances=1 | Core carregado uma vez. |
| persistence unavailable: <código>; Run npm run migrations:apply ... | Banco, migration ausente ou hash divergente; conferir pool e rodar CLI de migrations. Sistemas dependentes do banco ficam indisponíveis. |
| Catalog host/files unavailable / Plugin absent / Plugin signature/kind mismatch | Verificar dataDir, arquivos e catálogo. Não ligar o domínio afetado até verify.ts passar. |
| invalid mode for <sistema>; using off | Modo inválido; o runtime adotou off. Corrigir o valor antes de ativar. |
| client perks UNSUPPORTED: PERK_MIGRATION_UNAVAILABLE | Conferir migration 0008 e ledger. |
| client perks UNSUPPORTED: TRANSPORT_OR_DATABASE_UNAVAILABLE | Conferir pool e API de transporte do host/cliente. |
| attributes UNSUPPORTED: ATTRIBUTE_NATIVE_PROPERTY_UNAVAILABLE | Host sem propriedade aetheriusAttributeBonuses; recompilar o pacote compatível. Sem fallback customizado. |
| perks profile:<id>: SENT_UNCONFIRMED ou ACK_TIMEOUT | Não houve confirmação válida; não conte como aplicado. Verifique cliente/sessão/prontidão. |
| perks profile:<id>: CONFIRMED | Evidência de entrega; não comprova efeito no jogo. |
| ACTIVE_REQUIRES_DS7 | A fórmula continua bloqueada; mantenha off/shadow. |
| ERROR <opção> refused: ... | Opção dev presente fora da trava; remova-a. O subsistema dependente foi recusado. |

Linhas e causas vêm de [index.ts](../runtime/src/index.ts), [perks.ts](../runtime/src/projection/perks.ts), [attribute-system.ts](../runtime/src/attribute-system.ts) e [trava de desenvolvimento](../runtime/src/development.ts). Para grants, confira estado por personagem e ACK/COMMIT; SENT_UNCONFIRMED ou ACK_RECEIVED isolado não prova entrega gravada.

## 5. O que nunca vai ao oficial

Antes do deploy, confira:

- [ ] Todos os GAMEPLAY_CORE_MODE_* estão off; nenhum canário está configurado sem autorização.
- [ ] GAMEPLAY_CORE_CLIENT_PERKS_MODE está off, salvo decisão explícita de ativar entrega compatível após 0008.
- [ ] GAMEPLAY_CORE_ALLOW_DEV_OPTIONS, GAMEPLAY_CORE_DEV_CLASS_SWEEP, GAMEPLAY_CORE_DEV_CLASS_LEVEL, GAMEPLAY_CORE_DEV_ATTRIBUTES, GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY, GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV, GAMEPLAY_CORE_DEV_COMBAT_PROBE e GAMEPLAY_CORE_DEV_COMBAT_PROBE_FILE estão ausentes; não basta false nem vazio.
- [ ] ENABLE_STANDING_STONE_SPIKE está ausente.
- [ ] NODE_ENV do processo é production; offlineMode não transforma o servidor oficial em ambiente dev.
- [ ] aetheriusCombat.probe e aetheriusCombat.weaponPoison estão ausentes ou false; o trace npc-hit-trace não foi aplicado.
- [ ] aetheriusCombat.families está ausente ou cada família está off; multiplicadores estão no fator neutro 1.
- [ ] A ferramenta runtime/adopt-standing-stone.mjs não foi executada no oficial.

A trava de opções dev exige ao mesmo tempo NODE_ENV=local, GAME_ACCESS_CONTROL != true e GAMEPLAY_CORE_ALLOW_DEV_OPTIONS=true. Fora disso, a simples presença de opção dev — mesmo vazia ou false — é recusada e registrada. Fontes: [development.ts](../runtime/src/development.ts), [combat-probe.ts](../runtime/src/combat-probe.ts), [atributos](../runtime/src/attributes.ts).

## 6. Como desligar ou voltar atrás

- **Core inteiro:** em janela autorizada, defina ENABLE_GAMEPLAY_CORE=false e recarregue/reinicie pelo procedimento do mantenedor.
- **Um sistema:** defina seu GAMEPLAY_CORE_MODE_* como off. Para perks, defina também GAMEPLAY_CORE_CLIENT_PERKS_MODE=off.
- **Fórmula:** families ausente ou todas off restaura a cadeia corrente. Não altere os multiplicadores para simular rollback.
- **Cliente/host:** use revert revisado contra o HEAD mais recente e coordene host, gamemode e cliente; não copie arquivos de files/ por cima de mudanças posteriores. O trace diagnóstico nunca é parte do rollback/instalação oficial.
- **Dados:** desligar não desfaz migrations, não apaga registros nem revoga automaticamente tudo que já foi projetado. Não exclua tabelas nem remova perks manualmente. A revisão DOC-1 registrou que a reversão de perks de classe não está coberta por um rollback genérico; uma remoção total requer ordem própria e regra por origem. Registro interno do workspace (não incluído).

Não existem down-migrations. Preserve as tabelas gc_ para reativação e auditoria. Fontes: [migrations](../shared/persistence/src/migrations.ts), [owners](../modules/damage-system/docs/FONTES_E_DONOS.md).

## 7. Divergência de bases e identidade

Host e cliente recebem commits com frequência. Primeiro rode git apply --check na baseline correspondente. Se a base divergiu ou o patch falhou, pare e compare o diff com o mantenedor; git apply --3way pode ajudar a identificar conflitos, mas não foi exercitado nesta entrega. Nunca resolva copiando um arquivo inteiro por cima.

Arquivos do host com maior chance de conflito: server/cpp/server_guest_lib/ActionListener.cpp, MpActor.cpp/.h, MovementValidation.cpp, MpObjectReference.cpp, LeveledListUtils.cpp/.h, server/cpp/addon/ScampServer.cpp, PropertyBindingFactory.cpp, unit/CMakeLists.txt, server/gameplay/class-system/ui/js/embedded-data.js e server/gamemode/phase0-basic.js. No cliente: client/src/index.ts, client/src/services/services/remoteServer.ts, client/src/services/services/npcObservationService.ts; hitService.ts só aparece no patch diagnóstico. As cópias para inspeção são [host/files](host/files/server/cpp/server_guest_lib/aetherius_combat/ds5a/Host.h) e [client/files](client/files/client/src/services/services/remoteServer.ts).

O Core depende da identidade oficial existente no host: mp.aetheriusOfficialIdentity.session(actorId), isCurrent(...) e mp.get(actorId, 'profileId'). O pacote não altera o login. Se a API ou o vínculo com profileId mudou depois da baseline, pare; não use identidade alternativa nem fallback. Fontes: [atores do runtime](../runtime/src/actors.ts), server/ts/systems/login.ts no repositório do host.

## 8. Integração da tela (AetheriusUI Core)

A UI é projeção mais intenção. Mostra o estado publicado pelo servidor e envia o pedido do jogador; não envia nível, saldo, máximo, perk final ou dano. O patch do host inclui server/gameplay/class-system/ui/js/embedded-data.js; o espelho está em [embedded-data.js](host/files/server/gameplay/class-system/ui/js/embedded-data.js). DOC-2 não compilou nem validou a tela.

O contrato C3d de atributos está em [ATRIBUTOS_C3d.md](../docs/classes/ATRIBUTOS_C3d.md). Resumo:

- Ler core.attributeState(binding) para classe, nível/origem, pontos ganhos/gastos/disponíveis, revisão, aplicabilidade e valores informados pelo host.
- Enviar core.allocateAttributes({ binding, requestId, health, magicka, stamina }); os valores são incrementos inteiros não negativos, múltiplos de 5, com soma positiva. Não enviar nível, saldo ou máximo.
- O servidor determina o binding autenticado e persiste idempotentemente por requestId; valores aceitos não provam que o máximo novo já foi projetado no motor.
- O transporte entre a tela AetheriusUI e os comandos C3d ainda não está integrado. Não instale patches antigos de integrations/ui-runtime-changes/ junto com este pacote: usam bases distintas e a compatibilidade não foi verificada.

## 9. Limitações, riscos e decisões em aberto

- HitMessage ainda não carrega identidade única de golpe. Essa é dependência do cliente/host e pré-requisito da DS-7; mantenha active bloqueado. Fonte: [bloqueio de deduplicação](../modules/damage-system/docs/DS5A_BLOQUEIO_DEDUPLICACAO.md).
- Respawn de hostis no servidor oficial ainda precisa definir se a autoridade é nativa ou EnemySystem, e se a reequipagem DS-0k continua necessária. EnemySystem é de outro desenvolvedor; Q13 continua valendo.
- Encantamentos/poções criados por jogador não têm magnitude por instância confirmada (Q16). Consulte [requisito de encantamentos/poções](../modules/damage-system/docs/REQUISITO_ENCANTAMENTOS_E_POCOES.md) e [diagnóstico Q16](../modules/damage-system/docs/DIAGNOSTICO_Q16_MAGNITUDE_POR_INSTANCIA.md).
- Foram observados dois crashes ao entrar no mundo em 25/10; causa não atribuída. Registro interno do workspace (não incluído): DS-0k/ab-crash-20261025.md.
- A suíte do runtime pode falhar sob saturação de CPU; DS-5a-fix1 registrou uma falha de infraestrutura e três execuções verdes. Evite build paralelo durante a execução de aceites. Registro interno do workspace (não incluído).
- DS-0k-fix3 documenta limitações de LVLI no host. Não trate resultados parciais como autoridade de spawn. Registro interno do workspace (não incluído).
- DS-5b não certifica bash, Q16, furtivo, cinco regras de chance crítica ou grupos não comutativos sem ordem provada; dez dourados permanecem pendentes. Fonte: [DS5B](host/DS5B.md), [casos dourados](../modules/damage-system/docs/CASOS_DOURADOS.md).
- Load order oficial corrente, efeito de perks no motor, valores C3d em jogo, equipagem após respawn, builds oficiais e boot oficial continuam sem validação nesta ordem.

## 10. Fontes e reprodutibilidade

Os caminhos relativos deste guia apontam para arquivos contidos no repositório AetheriusGameplayCore. Código de host/cliente referenciado para o integrador está espelhado em integrations/host/files/ e integrations/client/files/. Ordens, pareceres e sessões do workspace são citados como registros internos do workspace (não incluídos), acompanhados do fato relevante; não são links externos ao Core.

A ordem DOC-2 repetiu a prova de aplicação:

- Host: git apply --check e git apply passaram na baseline; 35/35 hashes do manifesto conferidos após normalização LF.
- Cliente: patch de produção passou em `git apply --check` e `git apply`; 5/5 hashes conferidos. Patch diagnóstico, separado e não oficial, passou em `git apply --check`/`git apply`; 2/2 hashes conferidos.
- Catálogo: `verify.ts` passou nos seis domínios, no workspace, contra os arquivos em `aetherius-server/build/dist/server/data`; resultado offline, não é confirmação de deployment ou host ao vivo.
- Não foram executados build do host, build do cliente, testes, migrations, boot ou validação em jogo nesta ordem.

Saídas completas: registro interno do workspace (não incluído), `_work/evidence/DOC-2/package-proof-r2-retry.txt`. A lista e resultado da resolução de todos os links deste guia estão em `_work/evidence/DOC-2/links-r2.txt`.

<a id="apendice-a-catalogos"></a>
## Apêndice A — regeneração de catálogos

A regeneração exige exports e manifesto da mesma época, obtidos da load order vencedora da instância oficial. No fluxo de trabalho atual, o Opus 5.5 consulta o houseCARL na instância C:/modOrganizer, perfil AETHERIUS - GRAFICO - QUALIDADE, e entrega os exports ao executor autorizado. Um mantenedor sem houseCARL deve pedir essa regeneração ao dono/Opus; não invente exports nem use wiki, nomes ou memória.

O procedimento usa os builders documentados em [tools/catalog/README.md](../tools/catalog/README.md): build.ts para pedras/raças, classes.ts para classes, npcs.ts e effects.ts para os domínios de combate/NPCs/efeitos, todos com manifesto e epoch coerentes. Gere os artefatos auxiliares fora de catalog/, revise os diffs e rode novamente [verify.ts](../tools/catalog/verify.ts) contra os arquivos de plugin do servidor oficial. Só os domínios cuja verificação passar podem ser usados.
