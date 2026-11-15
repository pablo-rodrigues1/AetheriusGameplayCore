# AetheriusClassSystem — Meridian / Aetherius UI Core

> [!IMPORTANT]
> Este módulo é uma baseline funcional dentro do monorepo. Ownership, Host Ports, persistência e integração futura devem seguir [a arquitetura canônica](../../docs/architecture/AETHERIUS_GAMEPLAY_CORE_ARCHITECTURE.md). Em especial, Leveling é o único owner de XP/character level e ActorState compõe grants/skills efetivos; Party/Raid permanece fisicamente aqui apenas como owner transitório exposto por contrato.

Sistema de 18 classes, progressão, atributos, grupos e raids para SkyMP. A interface usa os módulos `class` e `party` da **Aetherius UI Core 1.x**, renderizado pela view Meridian do Core. O plugin e a ponte Prisma foram removidos.

O módulo segue o painel **Servidor**: fundo preto translúcido sobre o jogo, marca e navegação do Core, títulos claros, textos brancos/cinza e verde apenas nos destaques e seleções. A escolha mantém o formato de três colunas de arquétipos, com seis classes em cada coluna. As 18 ilustrações em SVG usam contornos finos e detalhes orgânicos; podem ser regeneradas com `npm run draw-icons`. Cada classe tem uma apresentação própria com emblema, especialidades, requisitos, trilha de progressão interativa e grimório. O catálogo, descrições e regras de Roleplay permanecem nos JSONs de `config/`.

## Compilar e instalar

Requisitos: Node.js 18+ e checkout de [AetheriusUI_Core](https://github.com/mercurius17/AetheriusUI_Core) ao lado deste repositório, ou caminho em `AETHERIUS_UI_CORE`.

```powershell
npm ci
npm run package:meridian
```

**TODAS AS CLASSES** retorna ao catálogo mesmo com uma classe atribuída; **MINHA CLASSE** retorna à progressão do personagem. Inspecionar outra classe mostra apenas seus dados de apresentação, sem alterar a classe atual. A redefinição só retorna ao catálogo após sucesso; falhas mantêm a classe e exibem o motivo. No jogo, a redefinição é gratuita até o nível 15 e exige ticket acima desse nível.

O pacote sai em `dist/meridian/Data/MeridianUI/aetheriusui/`. Para instalação nova, copie a árvore Data para o mod do Core. Para uma instalação com outros módulos, copie `modules/class/` e `modules/party/`, acrescente os dois CSS ao `<head>` do index do Core e carregue `data.js`, `class-module.js` e `party-module.js` depois de `shell.js`. Desabilite a fixture `class-echo-module.js`, que ocupa o mesmo slot.

## Integração no servidor

Instale primeiro o transporte do Core descrito em seus patches de integração. No bootstrap onde existe o **router autenticado do Core**, registre o ClassSystem:

```js
const registerClass = require('/caminho/AetheriusClassSystem/integrations/register-class.cjs');
const unloadClass = registerClass(coreRouter, classRuntime);
// No unload do módulo:
// unloadClass();
```

`classRuntime` é uma implementação vinculada ao servidor de `server/runtime.ts`: `get(actorId, property)`, `set(actorId, property, value)`, `getServerSettings()` e, quando disponível, `makeProperty()`. Pode ser o objeto `mp` no ambiente de gamemode que já fornece essas funções. Em um host Node separado desse ambiente, exponha essas operações através do adapter autorizado do host; não suponha que exista `global.mp`. O registro recusa uma API sem persistência/settings. O Core mantém a sessão, a deduplicação, o limite de mensagens e o envio dos envelopes; o módulo recebe o ator de `context.actorId`, nunca do payload.

O ClassSystem não cria uma segunda conexão nem um segundo router no jogo. O canal `class` registra snapshot, seleção, atributos e redefinição. O canal `party` registra snapshot e operações de grupo/raid, apresentadas exclusivamente no módulo **GRUPO** (`/party`, slot 3) do Core. O bootstrap registra ambos; não é necessário alterar o shell do Core. Relatos de abate do browser não são permitidos nesse canal. O pipeline confiável de mortes da Base deve continuar chamando o LevelingSystem no servidor.

No catálogo de disponibilidade do servidor Core, marque `class` como disponível somente após o registro bem-sucedido. O frontend registra `/class`, slot 1. Os handlers retornam estado autoritativo e os convites do próprio jogador; snapshots periódicos atualizam progressão e grupo enquanto o menu está montado. Listeners, temporizador e handlers são removidos no unload.

## Integração no cliente

Carregue o entrypoint compilado `dist/client/index.js` no bundle Skyrim Platform, junto ao serviço `aetheriusUiService` do Core. O módulo escuta `AetheriusUI.ToView`, usa a sessão emitida pelo transporte Core e aplica perks, habilidades e atributos apenas em envelopes da sessão atual. Não usa `mp.events.callRemote`, não cria view e não controla cursor ou foco. Abertura e retorno são os controles do radial do Core; o atalho K exclusivo do Prisma foi retirado.

## DamageSystem

Foi incorporado o adapter de [AetheriusDamageSystem](https://github.com/mercurius17/AetheriusDamageSystem), commit `f21faf5c4a1264f787545e20a1e4dbadc6362e80`, e seu catálogo verificado. Em `aetheriusCombatSettings.enabled=true` e `mode=aetherius`, o repositório recomputa skills da configuração, publica perks com identidades auditadas e atributos raciais/alocados, e avança a revisão acima da revisão persistida e nativa. A API deve fornecer `getActorCombatProfile` e `applyActorCombatProfile`, com métodos vinculados ao servidor.

O modo `legacy` continua padrão. O modo experimental exige a build e os overlays nativos do DamageSystem; ele rejeita perks sem handler auditado e equipamentos não suportados. O ClassSystem não acrescenta multiplicadores sobre a fórmula. Falha de publicação não substitui a progressão persistida nem altera a cópia em memória. Skills recebidas do perfil são exatas, inclusive zero após reset. O resolver não inventa FormIDs em produção.

SDK de servidor vendorizado do Core no commit `470526a24a003d5452802f90933c323c3bc4e300`; origem em `vendor/ui-core/PROVENANCE.md`. O frontend usa o checkout do Core informado no empacotamento. `AUDIT.md` é o histórico anterior à migração.

## Lista documental de feitiços

Consulte [Feitiços por classe](../../docs/classes/FEITICOS_POR_CLASSE.md) para os 164 registros da aba Classes, agora espelhados em Classes - Progressão. O documento registra as omissões e os nomes/tiers divergentes de `config/classes-config.json`: `authorizedSpells` tem 128 entradas (127 associações únicas; Aura of Thorns está repetida no Curandeiro), enquanto `allSpellsList` já tem os 164 nomes, com seis tiers divergentes. Esta atualização é documental; os JSONs e a apresentação em execução não foram alterados.
