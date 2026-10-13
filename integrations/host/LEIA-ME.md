# Pacote do host — mudanças do GameplayCore no `aetherius-server`

> **Pacote gerado em 12/10/2026**, depois da ordem C3d, com `make-package.mjs`. Core no commit `c50c735`.

Este pacote leva para o `aetherius-server` oficial as mudanças que o GameplayCore precisa no host. Elas foram feitas num clone local, sem commit, sobre o commit base abaixo. O guia de instalação completo, com banco, catálogo, configuração e cliente, é [`../INSTALL.md`](../INSTALL.md). Este arquivo explica só o pacote do host: o que cada mudança faz, para quem precisar resolver conflito sabendo a intenção.

| | |
|---|---|
| Repositório | `https://github.com/AetheriusRP/aetherius-server.git` |
| Commit base | `340449fae21bb4404439cad0814e60759f944857` ("Painel da Staff: Moderação, Administração, Auditoria e catálogo de itens") |
| Conteúdo | `changes.patch` (um patch git com tudo, arquivos novos incluídos), `files\` (cada arquivo tocado, inteiro, no estado final), `manifest.json` (hash e funcionalidade de cada arquivo) |
| Fim de linha | o patch e as cópias em `files\` usam LF, a forma em que o repositório guarda os arquivos; os SHA-256 do manifest são dessa forma |

## 1. As funcionalidades

O patch é um só, mas contém seis funcionalidades independentes quanto à ativação. Três delas ficam desligadas ou inertes depois de aplicadas.

| Id no manifest | O que é | Ordens de origem | Precisa recompilar o C++ | Estado depois de aplicar | No servidor oficial |
|---|---|---|---|---|---|
| `core-loader` | o gamemode carrega o bundle do Core por um descriptor do `module-registry` | A6-S1 | não | desligado (`ENABLE_GAMEPLAY_CORE=false`) | **necessário** |
| `fix-1010` | correção de uma escrita fora dos limites em `ActionListener::OnHostAttempt`, que derruba o servidor quando há NPC hospedado por jogador | FIX-1010 | sim | sempre ativo | **recomendado**: o defeito é do código do mantenedor e existe na base |
| `dev-attributes` | máximos de vida, magia e vigor de teste; cria o ponto único `MpActor::GetMaximumValues()` | DEV-A1 | sim | inerte sem a opção de desenvolvimento do Core | só desenvolvimento; a opção nunca pode existir no oficial |
| `attribute-bonus` | bônus de atributos: o host soma ao máximo dos records os pontos que o jogador distribuiu, entregues pelo Core na propriedade nativa `aetheriusAttributeBonuses` | C3d, C3d-fix1 | sim | inerte até o Core entregar um bônus | **necessário para os pontos de atributo**; sem ele o Core declara `UNSUPPORTED`. Não validado em jogo |
| `weapon-poison` | veneno em arma: revestimento, cargas, efeito no golpe | D-P1, D-P1-fix1, D-P1-fix2, FIX-1010 | sim | desligado (`aetheriusCombat.weaponPoison` ausente ou `false`) | **suspenso** pelo dono do projeto em 12/10/2026; manter desligado |
| `damage-shadow` | fórmula de dano Aetherius calculada em sombra, sem alterar o dano aplicado | A6-S3 | sim | desligado (`aetheriusCombat.shadow` ausente ou `false`) | não ligar; a trilha de dano está adiada |

`attribute-bonus` depende de `dev-attributes`: usa o ponto único `MpActor::GetMaximumValues()` e o mecanismo de aviso ao cliente que a DEV-A1 criou. Não dá para aplicar uma sem a outra.

Duas funcionalidades citadas no plano **não têm nenhum arquivo no host**, conferido no `git status` do clone e na lista de snapshots do `aetherius-server`:

- **Identidade oficial (B1-fix1):** o Core lê `mp.aetheriusOfficialIdentity`, que o mantenedor já expõe na base (`server/ts/systems/login.ts`, linha 120 no commit `340449f`).
- **Projeção de feitiços e perks (B5a, B5b, B5b-fix1):** o Core usa a API do gamemode que já existe (feitiços aplicados pelo host; perks pelo canal de pacote customizado `aetherius.gameplay.grants`). A contraparte dos perks está no pacote do cliente, em `../client\`.

## 2. Arquivos, por funcionalidade

A lista autoritativa é o `manifest.json` (campo `features` de cada arquivo), gerado a partir de `features.json`. Resumo:

**`core-loader`** (JavaScript do gamemode; não exige compilação)

- `server/gamemode/phase0-basic.js` (alterado)
- `server/gamemode/.env.example` (alterado)

**`fix-1010`**

- `server/cpp/server_guest_lib/ActionListener.cpp` (alterado; um trecho)
- `unit/WeaponPoisonNpcTest.h` (novo; reproduz o NPC hospedado) e `unit/AetheriusShadowTest.cpp` (novo; inclui os demais testes)

**`dev-attributes`**

- alterados: `server/cpp/server_guest_lib/MpActor.h`, `MpActor.cpp`, `ActionListener.cpp`, `CropRegeneration.cpp`, `server/cpp/addon/property_bindings/PropertyBindingFactory.cpp`
- novos: `server/cpp/server_guest_lib/aetherius_combat/DevAttributes.h`, `DevAttributes.cpp`, `server/cpp/addon/property_bindings/DevAttributesBinding.h`, `DevAttributesBinding.cpp`, `unit/DevAttributesTest.h`

**`attribute-bonus`**

- alterados: `server/cpp/server_guest_lib/MpActor.h`, `MpActor.cpp`, `aetherius_combat/DevAttributes.h`, `DevAttributes.cpp` (novos da DEV-A1, estendidos pela C3d), `server/cpp/addon/property_bindings/PropertyBindingFactory.cpp`, `server/cpp/CMakeLists.txt` (só um comentário), `unit/DevAttributesTest.h`
- novos: `server/cpp/addon/property_bindings/AttributeBonusesBinding.h`, `AttributeBonusesBinding.cpp`
- usa, sem alterar além do que a DEV-A1 já fez: `ActionListener.cpp` (`CalculateCurrentHealthPercentage`) e `CropRegeneration.cpp`, que leem o máximo pelo ponto único

**`weapon-poison`**

- alterados: `server/cpp/server_guest_lib/MpActor.h`, `MpActor.cpp`, `ActionListener.cpp`, `ActiveMagicEffectsMap.h`, `ActiveMagicEffectsMap.cpp`, `WorldState.h`, `server/cpp/addon/ScampServer.cpp`, `server/cpp/addon/property_bindings/PropertyBindingFactory.cpp`
- novos: `server/cpp/server_guest_lib/aetherius_combat/WeaponPoison.h`, `WeaponPoisonHost.h`, `server/cpp/addon/property_bindings/PoisonDoseBinding.h`, `PoisonDoseBinding.cpp`, `unit/WeaponPoisonTest.h`, `unit/WeaponPoisonIntentTest.h`, `unit/WeaponPoisonNpcTest.h`

**`damage-shadow`**

- alterados: `server/cpp/addon/ScampServer.cpp`, `server/cpp/CMakeLists.txt`
- novos: `server/cpp/server_guest_lib/formulas/ShadowDamageFormula.h`; em `server/cpp/server_guest_lib/aetherius_combat/`: `AetheriusDamageFormula.h`, `AetheriusDamageFormula.cpp`, `ShadowStatus.h`, `README.md`, `config/CombatSettings.h`, `context/DamageContext.h`, `debug/CombatTrace.h`, `forms/StableFormKey.h`, `perks/PerkRegistry.h`, `physical/ArmorCurve.h`, `physical/PhysicalDamagePipeline.h`, `state/ActorCombatState.h`; e `unit/AetheriusShadowTest.cpp`

Arquivos que servem a mais de uma funcionalidade: `ActionListener.cpp` (quatro), `MpActor.h` e `MpActor.cpp` (três), `PropertyBindingFactory.cpp` (três), `DevAttributes.h` e `.cpp` (duas), `ScampServer.cpp` (duas), `unit/AetheriusShadowTest.cpp` (é o executável de teste que inclui os testes das outras), `aetherius_combat/README.md` (documenta a sombra e as proteções do veneno).

Os arquivos novos `.cpp` em `server_guest_lib/` e em `addon/` entram na compilação sem mudar o CMake: o `server/cpp/CMakeLists.txt` da base já usa `file(GLOB_RECURSE ...)` nessas pastas (linha 70 para `server_guest_lib`). Depois de aplicar o patch é preciso **reconfigurar** o CMake para os arquivos novos serem vistos.

## 3. O que cada trecho do patch faz

A maior parte dos trechos acrescentados a arquivos do mantenedor tem um comentário `AETHERIUS <ordem>` (`AETHERIUS D-P1`, `AETHERIUS D-P1-fix2`, `AETHERIUS DEV-A1`, `AETHERIUS C3d`, `AETHERIUS FIX-1010`); busque por `AETHERIUS` para localizá-los. **Nem toda linha está marcada.** Sem comentário: os dois `#include` e todo o bloco da sombra (A6-S3) em `ScampServer.cpp`, onde só a linha do veneno é marcada; o bloco do executável de teste em `server/cpp/CMakeLists.txt`; o descriptor em `phase0-basic.js`; e as duas opções em `.env.example`. Para esses, a referência é o próprio patch e a descrição abaixo.

### `server/gamemode/phase0-basic.js` — `core-loader`

Um `moduleRegistry.register(...)` novo, antes do descriptor `npc-cleaner`: id `gameplay-core`, `enabledBy: 'ENABLE_GAMEPLAY_CORE'`, `phase: 'lab'`, sem comandos. No `initialize`: exige `GAMEPLAY_CORE_BUNDLE`, faz `require` do bundle (caminho resolvido a partir do diretório de execução do servidor), chama `bundle.createGameplayCore({ mp, pg, env: process.env, log: console })`, confere que o objeto tem `initialize`, `shutdown`, `healthCheck` e `info`, e chama `core.initialize()`. O `pg` entregue é o módulo `core/pg.js` do próprio gamemode: o Core não cria conexão. No `shutdown`, chama `core.shutdown()`.

O último trecho do patch nesse arquivo só acrescenta a quebra de linha que faltava no fim (`}, 2000);`). É ruído sem efeito; se conflitar, descarte.

### `server/gamemode/.env.example` — `core-loader`

Duas opções novas, desligadas: `ENABLE_GAMEPLAY_CORE=false` e `GAMEPLAY_CORE_BUNDLE=` (caminho absoluto, ou relativo ao diretório de execução do servidor). As demais opções do Core (`GAMEPLAY_CORE_MODE_*` e outras) **não** estão no `.env.example`; estão descritas no `INSTALL.md`, seção 4.5.

### `server/cpp/server_guest_lib/ActionListener.cpp` — `fix-1010`, `weapon-poison`, `dev-attributes` (e, por uso, `attribute-bonus`)

A C3d não acrescentou linha neste arquivo; o bônus de atributos chega ao golpe porque `CalculateCurrentHealthPercentage` lê o máximo pelo ponto único.

| Função | Funcionalidade | O que muda |
|---|---|---|
| `OnHostAttempt` | `fix-1010` | antes de escrever `lastMovUpdateByIdx[remoteIdx]`, cresce o vetor se `size() <= remoteIdx`. Sem isso a escrita vai além do fim do vetor quando a forma hospedada ainda não enviou movimento. É o único trecho da correção da queda |
| `OnUpdateEquipment` | `weapon-poison` | para o próprio ator, chama `ReconcileWeaponPoisonEquipment(data)`; só se ela devolver `false` segue o caminho original (`SendToNeighbours` e `SetEquipment`). Com a opção desligada devolve `false` (fluxo do mantenedor preservado, conforme o parecer D-P1-fix1) |
| `OnChangeValues` | `dev-attributes` | **só quando o ator tem o máximo de teste** (`actor->HasDevAttributes()`): recusa valor não finito e limita também a regeneração de vigor. Sem o máximo de teste, o caminho é o anterior |
| `CalculateCurrentHealthPercentage` | `dev-attributes` | a vida base passa a vir de `actor.GetMaximumValues().health` em vez do cálculo direto por `GetBaseActorValues` |
| `OnWeaponHit` | `weapon-poison` | depois do dano físico, que não muda, e só com `worldState.aetheriusWeaponPoison` ligado: `aggressor->ApplyWeaponPoisonHit(...)` |

### `server/cpp/server_guest_lib/MpActor.h` e `MpActor.cpp` — `dev-attributes`, `attribute-bonus` e `weapon-poison`

- `GetBaseValues()` e `GetMaximumValues()` passam a ser `const`. `GetMaximumValues()` deixa de ser sinônimo de `GetBaseValues()`: calcula os valores dos records e depois aplica **um** de dois ajustes: se houver máximo de teste entregue (`HasDevAttributes()`), os três valores absolutos da DEV-A1; senão, se houver bônus de atributos (`HasAttributeBonuses()`), soma o bônus (`AETHERIUS C3d`). Os dois nunca se somam. É o **ponto único** do máximo: spawn, golpe, regeneração e dano ou cura por recurso passam por ele.
- Novos em `MpActor.h` para o bônus (`AETHERIUS C3d`): `SetAttributeBonuses`, `HasAttributeBonuses`, `SendAttributeMaximumValues` e três campos privados (`aetheriusAttributeBonuses`, `aetheriusAttributeBonusesUser`, `aetheriusAttributeBonusesProfile`). O bônus só vale enquanto o ator for o mesmo jogador, com o mesmo usuário e o mesmo perfil da entrega. Nada vai para o change form.
- `VisitProperties` (spawn) passa a usar `GetMaximumValues()`.
- Novos em `MpActor.h`: `SetDevAttributes`, `HasDevAttributes`, `ApplyDevAttributes` e três campos privados (`aetheriusDevAttributes`, `aetheriusDevAttributesUser`, `aetheriusDevAttributesRevision`). As implementações ficam em `aetherius_combat/DevAttributes.cpp`.
- `SetEquipment`: primeira linha chama `ReconcileWeaponPoisonEquipment(newEquipment)` e retorna se ela tratar o caso.
- `OnEquip`: para poção, tenta `TryUseWeaponPoison(baseId)` antes da conferência de posse do item.
- Novo bloco `public` em `MpActor.h` com os métodos do veneno (`TryUseWeaponPoison`, `RequestWeaponPoison`, `ReconcileWeaponPoisonEquipment`, `ApplyWeaponPoisonHit`, `ApplyWeaponPoisonEffect`, `PublishWeaponPoisonEquipment`, `ScheduleWeaponPoisonTick`, leitura e escrita do bônus de dose) e os campos privados correspondentes. As implementações ficam em `aetherius_combat/WeaponPoisonHost.h`, incluído no fim dos includes de `MpActor.cpp`.

**Ponto a revisar pelo mantenedor (lido no diff; efeito não medido):** com todas as opções desligadas ainda há uma diferença em relação à base para ator **sem aparência**. Antes, `CropRegeneration.cpp` e `MpActor::VisitProperties` passavam `raceId = 0` nesse caso; agora os dois passam por `GetBaseValues()`, que usa `GetRaceId()`, e `GetRaceId()` resolve a raça pelo template do NPC quando não há aparência. Para jogador com aparência o valor é o mesmo de antes. O parecer da DEV-A1 não trata desse caso.

### `server/cpp/server_guest_lib/CropRegeneration.cpp` — `dev-attributes`

A função local `GetValues(actor)` passa a devolver `actor->GetMaximumValues()`. As taxas de regeneração não mudam.

### `server/cpp/server_guest_lib/ActiveMagicEffectsMap.h` e `.cpp` — `weapon-poison`

A entrada de efeito ganha `weaponPoison` e `weaponPoisonTicks`. `ToJson()` e `GetAllEffects()` pulam as entradas marcadas: o efeito de veneno em curso é transitório e nunca é gravado no change form.

### `server/cpp/server_guest_lib/WorldState.h` — `weapon-poison`

`FindLoadedForm(id)` (só consulta o mapa em memória, não carrega nada) e o booleano `aetheriusWeaponPoison`, `false` por padrão.

### `server/cpp/addon/ScampServer.cpp` — `weapon-poison` e `damage-shadow`

No construtor, depois de montar a cadeia de fórmulas de dano e antes de `partOne->SetDamageFormula(...)`: lê o objeto `aetheriusCombat` do `server-settings.json`. `weaponPoison` vai para `worldState.aetheriusWeaponPoison`. Se `shadow` for `true`, embrulha a fórmula vigente num `ShadowDamageFormula`, registra `mp.getAetheriusCombatShadow()` e escreve `Aetherius damage shadow enabled` no log; nesse caso `physicalRecords` é obrigatório (lista de até 4096 chaves `Plugin.esm:FormIDlocal`) e a falta dele faz o servidor lançar exceção no boot. Sem a chave `aetheriusCombat`, ou com as duas opções `false`, a cadeia de fórmulas é a de antes.

### `server/cpp/addon/property_bindings/PropertyBindingFactory.cpp` — `weapon-poison`, `dev-attributes` e `attribute-bonus`

Três includes e cinco propriedades nativas novas para o gamemode: `aetheriusAttributeBonuses` (leitura e escrita, em memória; descrita abaixo), `aetheriusPoisonDoseBonus` (leitura e escrita, em memória), `aetheriusPoisonStatus` (só leitura, diagnóstico), `aetheriusWeaponPoisonIntent` (só escrita; é um comando, não guarda valor) e `aetheriusDevAttributes` (leitura e escrita, em memória). Nenhuma é propriedade customizada e nenhuma é persistida.

### `server/cpp/CMakeLists.txt` — `damage-shadow` e `attribute-bonus`

No fim do arquivo, um comentário `AETHERIUS C3d` (lembra de reconfigurar para o arquivo novo entrar no glob; não muda o build) e a opção `AETHERIUS_SHADOW_TESTS` (padrão `OFF`) e, quando ligada, o executável `aetherius-shadow-test`, feito de `unit/AetheriusShadowTest.cpp` e ligado a `server_guest_lib`. Com a opção desligada o build é o de antes. Apesar do nome, esse executável roda também os testes nativos do veneno, do NPC hospedado e dos máximos de teste, que `AetheriusShadowTest.cpp` inclui.

### Arquivos novos

| Arquivo | Conteúdo |
|---|---|
| `aetherius_combat/DevAttributes.h`, `.cpp` | o tipo `aetherius::development::Attributes` (três inteiros de 1 a 100000) e as três funções de `MpActor`. Só vale para ator criado como jogador, com usuário associado e perfil; o cliente é avisado pelo `SpSnippet Actor.SetActorValue` que já existe |
| `aetherius_combat/DevAttributes.h`, `.cpp` (parte da C3d) | o tipo `aetherius::attributes::Bonuses`: três inteiros de 0 a 585, múltiplos de 5, soma até 585 (o ganho do nível 40); fora disso lança `ATTRIBUTE_POINTS_INVALID`. `SetAttributeBonuses` recusa ator que não seja jogador online com perfil (`ATTRIBUTE_OFFICIAL_PLAYER_REQUIRED`) e recusa quando o máximo de teste está ativo (`ATTRIBUTE_DEV_WRITER_ACTIVE`). `SendAttributeMaximumValues` avisa o cliente dos três máximos pelo `SpSnippet Actor.SetActorValue` existente e só publica as porcentagens depois das três confirmações |
| `addon/property_bindings/AttributeBonusesBinding.*` | a propriedade `aetheriusAttributeBonuses`. Escrita: objeto com exatamente `health`, `magicka`, `stamina` (acréscimos), ou `null` para limpar. Leitura: `{ base, maximum, origin }`, com `origin` igual a `RECORDS`, `CLASS_ADDITIVE` ou `DEV`. O Core usa a leitura para saber se o host tem a propriedade |
| `addon/property_bindings/DevAttributesBinding.*` | a propriedade `aetheriusDevAttributes`: objeto com exatamente `health`, `magicka`, `stamina`, ou `null` para limpar |
| `aetherius_combat/WeaponPoison.h`, `WeaponPoisonHost.h` | regras e integração do veneno com o inventário e os recursos do host |
| `addon/property_bindings/PoisonDoseBinding.*` | as três propriedades do veneno |
| `formulas/ShadowDamageFormula.h` | o embrulho: devolve sempre o dano da fórmula vigente e guarda até 1024 amostras em memória |
| `aetherius_combat/AetheriusDamageFormula.*`, `ShadowStatus.h` | a fórmula candidata, com perfil neutro |
| os oito cabeçalhos em `config/`, `context/`, `debug/`, `forms/`, `perks/`, `physical/`, `state/` | cópias de `modules/damage-system` do Core, segundo o `README.md` dessa pasta |
| `aetherius_combat/README.md` | documentação da sombra e da auditoria FIX-1010, em inglês |
| `unit/*.h`, `unit/AetheriusShadowTest.cpp` | testes nativos |

## 4. Ordem de aplicação

O patch é único e se aplica de uma vez sobre o commit base:

```powershell
git -C <aetherius-server> rev-parse HEAD
git -C <aetherius-server> apply --check "<Core>\integrations\host\changes.patch"
git -C <aetherius-server> apply "<Core>\integrations\host\changes.patch"
```

Antes, confira que o arquivo do patch tem o SHA-256 registrado em `manifest.json` (`patch.sha256`):

```powershell
Get-FileHash "<Core>\integrations\host\changes.patch" -Algorithm SHA256
```

Se o hash não bater, o motivo mais provável é o git ter convertido o fim de linha do patch no checkout do Core (`core.autocrlf=true`). Um patch com CRLF não se aplica. O `.gitattributes` do Core marca `integrations/host/changes.patch`, `integrations/host/files/**`, `integrations/host/manifest.json` e os patches de `integrations/client/` com `-text`, para o git não converter; essa proteção só vale a partir do commit que a contém. Se ainda assim o hash divergir, clone o Core com `git clone -c core.autocrlf=false ...`.

**Só o carregador do Core, sem recompilar o C++:**

```powershell
git -C <aetherius-server> apply --include="server/gamemode/*" "<Core>\integrations\host\changes.patch"
```

Essa forma foi exercitada em 12/10/2026 com o patch final (`_work\evidence\DOC-1\15-pacote-final-conferencias.txt`). Ela basta para pedras, raças, classes e entrega de perks. **Não basta para os pontos de atributo:** eles dependem da propriedade nativa `aetheriusAttributeBonuses`, e sem ela o Core escreve `attributes UNSUPPORTED: ATTRIBUTE_NATIVE_PROPERTY_UNAVAILABLE` e não aplica bônus (lido em `runtime/src/attribute-system.ts`; não exercitado com um host sem a propriedade).

**Só a correção da queda:** é um trecho de seis linhas em `ActionListener::OnHostAttempt`. Se não quiser as outras funcionalidades, copie o trecho à mão (está no patch, marcado `AETHERIUS FIX-1010`) em vez de aplicar o patch inteiro. A descrição do defeito para o mantenedor está em `_work\evidence\FIX-1010\DEFEITO-HOST-lastMovUpdateByIdx.md` no workspace de desenvolvimento; em 12/10 o dono do projeto ainda não tinha dito se ela pode ser repassada.

As demais funcionalidades nativas compartilham `MpActor.h`, `MpActor.cpp`, `ActionListener.cpp` e `PropertyBindingFactory.cpp`. Separá-las exige escolher trecho por trecho, pelos comentários `AETHERIUS <ordem>`. A recomendação é aplicar tudo e deixar desligado o que a seção 6 lista.

## 5. Como compilar

Estes são os comandos que foram usados no ambiente de desenvolvimento. O servidor oficial tem o fluxo de build do mantenedor; use-o se for diferente.

**Limite:** esta sequência reúne o que o `CMakeLists.txt` da base exige e o que foi registrado no clone de desenvolvimento. **Não foi executada numa máquina limpa**, nem por quem escreveu este documento nem pelo revisor.

1. **vcpkg.** O `CMakeLists.txt` da raiz usa `<aetherius-server>\vcpkg\scripts\buildsystems\vcpkg.cmake` e para com erro se o arquivo não existir. A base `340449f` não traz a pasta `vcpkg` nem um `.gitmodules`, então os comandos `git submodule` que a mensagem de erro sugere não resolvem. No ambiente de desenvolvimento o vcpkg foi clonado em `<aetherius-server>\vcpkg`, no commit `cb2981c4e0`, e inicializado com `bootstrap-vcpkg.bat -disableMetrics` (`_work\evidence\A8\RUNBOOK.md`, seção 1); de onde vem a escolha desse commit não foi conferido. **Se o servidor oficial já compila, o vcpkg que ele usa é o certo: não troque.**
2. **Caminho sem espaços.** A configuração do CMake falhou quando o repositório estava num caminho com espaços (`C:\Code\Aetherius - SkyMP\...`) e passou pelo mesmo diretório acessado por um caminho sem espaços (`C:\Code\AetheriusSkyMP\...`); registro em `_work\evidence\upstream-server\build.meta.txt`. Se o seu clone estiver num caminho com espaços, crie um atalho de diretório sem espaços e use esse caminho em todos os comandos abaixo.
3. **Configurar** (necessário depois de aplicar o patch, para os arquivos novos entrarem). O `CMakeLists.txt` da raiz exige que o diretório de build seja exatamente `<aetherius-server>\build` e recusa qualquer outro. Com os dois diretórios explícitos:

   ```powershell
   # só se a máquina tiver outra versão do Visual Studio além do Build Tools 2022:
   $env:VCPKG_VISUAL_STUDIO_PATH = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"
   cmake --fresh -S "<aetherius-server>" -B "<aetherius-server>\build" -G "Visual Studio 17 2022" -A x64 -DVCPKG_TARGET_TRIPLET=x64-windows-sp -DBUILD_SKYRIM_PLATFORM=ON -DBUILD_UNIT_TESTS=OFF
   ```

   O registro do ambiente de desenvolvimento (`_work\evidence\A8\01-configure.cmd.txt`, de 06/10/2026, sobre o commit anterior `4c47aa9`) usou a forma equivalente: criar a pasta `build`, entrar nela e rodar `cmake --fresh ..` com as mesmas opções. A forma com `-S` e `-B` acima não foi executada. `--fresh` descarta a configuração anterior da pasta `build`; se o oficial já tem essa pasta configurada com outras opções, reconfigure com as opções do mantenedor em vez destas. Para a base `340449f` a configuração e o build passaram em 08/10 (`_work\evidence\upstream-server\`), mas a linha de comando exata dessa data não foi conferida para este documento.
4. **Compilar o alvo `skymp5-server`:**

   ```powershell
   cmake --build "<aetherius-server>\build" --config Release --target skymp5-server -- /m /v:minimal /nologo
   ```

   O resultado é `build\dist\server\scam_native.node`.
5. **Sincronizar os plugins**, porque recompilar pode regravar o `server-settings.json` do diretório de execução:

   ```powershell
   node "<aetherius-server>\server\tools\sync-client-plugins.js" --mo2 "<instância do Mod Organizer>"
   ```

   Depois, confira de novo no `server-settings.json` as opções `aetheriusCombat` (seção 6).
6. **O gamemode não é compilado.** `phase0-basic.js` precisa chegar ao diretório de execução (`build\dist\server\gamemode\`) pelo mesmo caminho que o resto do gamemode chega no servidor oficial. No ambiente de desenvolvimento essa cópia foi feita à mão (ordem A8: o script `build-server.bat` citado nos comentários do repositório não está no repositório).
7. **Testes nativos (opcional).** Configure com `-DAETHERIUS_SHADOW_TESTS=ON`, compile os alvos `skymp5-server` e `aetherius-shadow-test` em Release e execute `build\server\cpp\Release\aetherius-shadow-test.exe` passando o caminho absoluto de `build\dist\server\data\aetherius-loadorder.json`. Os testes usam os plugins reais do perfil. Fonte: `server/cpp/server_guest_lib/aetherius_combat/README.md`.

## 6. O que fica desligado por padrão e como conferir

| Funcionalidade | Onde se liga | Valor que mantém desligado | Como conferir |
|---|---|---|---|
| `core-loader` | `.env` do gamemode: `ENABLE_GAMEPLAY_CORE`, `GAMEPLAY_CORE_BUNDLE` | `ENABLE_GAMEPLAY_CORE=false` ou ausente | no log do boot não aparece nenhuma linha `[gameplay-core]`; ligado, aparece `[module-registry] [LAB] gameplay-core: ATIVO (0 comandos registrados)` |
| `weapon-poison` | `server-settings.json`: `"aetheriusCombat": { "weaponPoison": true }` | chave ausente ou `false` | ler o arquivo do diretório de execução **depois** de cada build e de cada `sync-client-plugins` |
| `damage-shadow` | `server-settings.json`: `"aetheriusCombat": { "shadow": true, "physicalRecords": [...] }` | chave ausente ou `false` | no log do boot não aparece `Aetherius damage shadow enabled` |
| `attribute-bonus` | não tem opção no host: age quando o Core escreve a propriedade, o que só acontece com as classes em `canary` ou `active` e pontos distribuídos | classes em `off`, ou nenhum ponto distribuído | `mp.get(actorId, 'aetheriusAttributeBonuses')` devolve `origin: 'RECORDS'`; no log do boot, `attribute maximum writer=CLASS_ADDITIVE` (nunca `DEV` no oficial) |
| `dev-attributes` | opção `GAMEPLAY_CORE_DEV_ATTRIBUTES` do Core, sob a trava de desenvolvimento | opção ausente do `.env` | no log do boot não aparece `DEV attributes override=` |
| `fix-1010` | não tem opção | — | o trecho `AETHERIUS FIX-1010` está em `ActionListener.cpp` |

As opções de `aetheriusCombat` são lidas no construtor C++ do addon: mudar exige reiniciar o processo do servidor; recarregar só o gamemode não muda nada.

## 7. O que foi provado e o que não foi

- **Provado com o patch final, em 12/10/2026** (`_work\evidence\DOC-1\14-make-package-final.txt`): o patch gerado pelo `make-package.mjs` aplica sem erro sobre os arquivos extraídos do commit base com `git archive` e reproduz, por SHA-256, os 40 arquivos da árvore de trabalho (12 alterados e 28 novos); nenhum arquivo ficou sem funcionalidade. `git apply --check -R` do mesmo patch sobre a árvore do clone e a aplicação parcial de `server/gamemode/*` também passaram (`15-pacote-final-conferencias.txt`). A primeira tentativa da prova, com a prévia do mesmo dia, falhou por fim de linha na comparação (defeito da prova, não do patch); o registro está guardado (`01a-...-FALHOU.txt`).
- **Compilado e testado pelo revisor da C3d no clone de desenvolvimento, em 12/10/2026:** alvo `skymp5-server` em Release e `aetherius-shadow-test --dev-attributes` com 69 conferências nativas (`_work\evidence\C3d-fix1\native-build-opus.txt`, `native-unit-opus.txt`); ensaio de atributos e da varredura com o servidor compilado (`_work\evidence\C3d-fix3\`).
- **Não provado:** que o patch aplica num `aetherius-server` oficial mais novo que `340449f`; que o servidor compila a partir de um clone limpo com o patch (o que se compilou foi o clone de desenvolvimento, onde as mudanças nasceram); o bônus de atributos em jogo (as três barras); o comportamento em jogo de cada funcionalidade, que está no `INSTALL.md`, seção 2.
- A revisão independente da correção `fix-1010` (feita pelo revisor Opus 5.5) pelo Sol 6.1 estava pendente em 12/10 (`RETOMADA.md`, seção 14).

## 8. Como regenerar o pacote

Na raiz do Core, sem alterar nenhuma das duas árvores (o script só usa `git rev-parse`, `status`, `diff` e `archive`):

```powershell
node integrations/host/make-package.mjs --server "<caminho do aetherius-server>" --prove "<pasta vazia fora dos repositórios>"
```

- Sem `--out`, grava `changes.patch`, `files\` e `manifest.json` nesta pasta.
- Recusa gerar se o `HEAD` do servidor não for o commit base de `features.json`, se houver arquivo alterado sem funcionalidade em `features.json`, ou se o git mostrar um estado que não seja "alterado sem estar no índice" ou "não rastreado".
- `--prove` repete a prova da seção 7 e sai com código 1 se algum arquivo divergir.
- `--preview --out <pasta>` gera uma prévia marcada (`PREVIA.txt`, `"preview": true`) e aceita arquivo ainda não classificado.
- Ficam fora, por `exclude` em `features.json`: `build/`, `build-nospace/`, `vcpkg/`.

## Pendências deste pacote

- Revisão independente da correção `fix-1010` e conferência, pelo mantenedor, da diferença de comportamento para ator sem aparência (seção 3).
- Bônus de atributos e veneno sem validação em jogo; o estado de cada sistema está no `INSTALL.md`, seção 2.
- O pacote precisa ser regenerado (seção 8) se a árvore do `aetherius-server` de desenvolvimento mudar depois de 12/10/2026.
