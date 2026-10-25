# Pacote do host — DOC-2, 25/10/2026

O roteiro completo está em [INSTALL.md](../INSTALL.md). Este arquivo descreve a baseline, os conteúdos e os limites do delta de host.

## Base e prova

- Baseline do repositório do host: `6181abf1774c31a4e93206f71b784af5b13f10ae`.
- `changes.patch`: SHA-256 `ad62636998ce7e7aedb68364ebb77a942a0c7afe657fa3c93df0fadb5a8c1d2f`; 35 caminhos, sendo 17 modificados e 18 adicionados.
- `manifest.json` descreve os arquivos finais; `files/` contém espelhos de revisão. A aplicação de integração usa o patch, não a cópia integral.
- DOC-2 repetiu `git apply --check` e `git apply` num clone limpo da baseline e conferiu 35/35 hashes após normalizar CRLF para LF. Evidência: registro interno do workspace (não incluído), `_work/evidence/DOC-2/package-proof-r2-retry.txt`.
- A prova não compilou o host nem iniciou o servidor oficial. Nenhum binário, settings ou build/dist local foi incluído.

## O que o host expõe

| Parte | Capacidade e limite | Espelho no pacote |
|---|---|---|
| Loader do Core | Registra o módulo pelo module-registry. Exige `ENABLE_GAMEPLAY_CORE` e `GAMEPLAY_CORE_BUNDLE`; injeta o pool PostgreSQL existente em `core/pg.js`. Não cria outro pool. | [phase0-basic.js](files/server/gamemode/phase0-basic.js) |
| DS-5a/DS-5b | Catálogo e perfil de combate nativos; fórmula física e perks `CLASS` em shadow. O resultado aplicado continua `NATIVE_SERVER`. | [Host.h](files/server/cpp/server_guest_lib/aetherius_combat/ds5a/Host.h), [Physical.h](files/server/cpp/server_guest_lib/aetherius_combat/ds5a/Physical.h), [DS5A](DS5A.md), [DS5B](DS5B.md) |
| NPC | Recebe observação/evidência e permite correção indexedTeleport. Não entrega decisão de spawn a DamageSystem. Reequipagem após respawn/CNTO aguarda sessão de jogo; o harness real-host não resolveu essa dúvida. | [NpcObservation.h](files/server/cpp/server_guest_lib/aetherius_combat/NpcObservation.h), [remote host paths](files/server/cpp/server_guest_lib/MpObjectReference.cpp) |
| Atributos C3d | Expõe a propriedade nativa `aetheriusAttributeBonuses`. Sua presença no pacote não valida máximos nem reconexão no servidor oficial. | [AttributeBonusesBinding.h](files/server/cpp/addon/property_bindings/AttributeBonusesBinding.h), [MpActor.h](files/server/cpp/server_guest_lib/MpActor.h) |
| UI de classes | O delta inclui o bundle embutido da UI de classes/atributos. DOC-2 não fez build nem validação visual. | [embedded-data.js](files/server/gameplay/class-system/ui/js/embedded-data.js) |
| Diagnóstico | `aetheriusCombat.probe` habilita coleta somente dev; mantenha ausente ou `false` no oficial. | [CombatProbe.h](files/server/cpp/server_guest_lib/aetherius_combat/CombatProbe.h) |

O Core usa o pool do gamemode e migrations próprias com prefixo `gc_`; consulte [guia de integração](../INSTALL.md). O pacote não altera login nem substitui a API de identidade oficial.

## Configuração DS-5

Em `server-settings.json`, `aetheriusCombat.families` aceita `melee`, `ranged` e `unarmed`, cada uma `off`, `shadow` ou `active`. Ausência de `families` equivale a todas `off` e mantém a cadeia vigente.

`aetheriusCombat.multipliers.pve` e `.pvp` são **fatores diretos**, finitos de 0 a 100: **neutro é 1; 100 aplica 100×**. A configuração padrão é 1. Se incluir `multipliers`, informe ambos os campos. O host calcula `normal × global` antes das defesas. A versão recomendada para integração inicial é:

~~~json
{
  "aetheriusCombat": {
    "families": { "melee": "off", "ranged": "off", "unarmed": "off" },
    "multipliers": { "pve": 1, "pvp": 1 },
    "probe": false
  }
}
~~~

`active` é recusado com `ACTIVE_REQUIRES_DS7`. Para uma observação shadow autorizada, configure somente a família aprovada como `shadow` e mantenha as outras `off`. Shadow calcula um candidato e devolve o resultado atual; não aplica os dois owners. Não use as chaves históricas `aetheriusCombat.shadow` ou `physicalRecords` para DS-5. Fontes: [Host.h](files/server/cpp/server_guest_lib/aetherius_combat/ds5a/Host.h), [Physical.h](files/server/cpp/server_guest_lib/aetherius_combat/ds5a/Physical.h), [INSTALL](../INSTALL.md).

DS-5b cobre nove entry points e nove condições certificadas de perks `CLASS`; 26 dourados passaram, nenhum falhou e dez seguem pendentes. Bash, Q16, furtivo, regras de chance crítica sem cobertura, origens fora de `CLASS` e operações sem ordem provada ficam `UNSUPPORTED` ou inativas. Fontes: [DS5B](DS5B.md), [FONTES_E_DONOS](../../modules/damage-system/docs/FONTES_E_DONOS.md), parecer DS-5b em registro interno do workspace (não incluído).

## Build e rollback

Use clone na baseline exata, confira/aplique o patch e recompile com o gerador, toolchain/vcpkg, arquitetura e opções mantidos pelo operador. A receita do repositório do servidor está em `aetherius-server/cmake_server_build.txt`; o guia [INSTALL](../INSTALL.md) inclui sua forma de comando. Depois do deploy, revise settings no diretório de execução. DOC-2 não executou build ou deploy.

Para desligar a fórmula, remova `families` ou coloque cada família em `off` numa janela autorizada e reinicie o processo que carrega o addon. DS-5 não tem migration. Não apague tabelas/dados do Core. A cadeia vigente permanece como resultado aplicado.

## Limites de integração

- DamageSystem não escolhe, cria, substitui ou respawna NPC (Q13); o owner dessas decisões é `EnemySystem`.
- `NATIVE_SERVER` continua sendo owner de dano aplicado; DS-5 é candidato shadow. `active` aguarda DS-7 e identidade única de hit.
- C3d requer a propriedade nativa acima, migration 0009 e teste oficial em jogo ainda pendente.
- Reequipagem DS-0k após respawn/CNTO aguarda sessão em jogo; a interpretação de LVLI do host possui limites descritos no parecer DS-0k-fix3.
- Mágica, procs, veneno suspenso e sonda de combate não devem ser ativados por este pacote.
