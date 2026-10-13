const path = require('path');

// Como o SkyMP copia o arquivo de entrada para um diretorio temporario do Windows no boot,
// precisamos resolver o caminho original do gamemode de forma absoluta usando process.cwd().
const gamemodeDir = path.resolve(process.cwd(), './gamemode');

// ─────────────────────────────────────────────────────────────────────────────
// .env — PRECISA vir antes de qualquer outro require deste arquivo.
// ─────────────────────────────────────────────────────────────────────────────
require(path.join(gamemodeDir, 'node_modules', 'dotenv'))
  .config({ path: path.join(gamemodeDir, '.env'), quiet: true });

const db            = require(path.join(gamemodeDir, 'database'));
const whitelist     = require(path.join(gamemodeDir, 'whitelist'));
const commands      = require(path.join(gamemodeDir, 'commands'));
const moduleRegistry = require(path.join(gamemodeDir, 'core', 'module-registry'));
const uiEventRouter  = require(path.join(gamemodeDir, 'core', 'ui-event-router'));
const serverOptions  = require(path.join(gamemodeDir, 'core', 'server-options'));
const governance    = require(path.join(gamemodeDir, 'governance-service'));
const marketStalls  = require(path.join(gamemodeDir, 'market-stalls-service'));
const playerPanel   = require(path.join(gamemodeDir, 'player-panel-service'));
const deathService  = require(path.join(gamemodeDir, 'death-service'));
const voipService   = require(path.join(gamemodeDir, 'voip-service'));
const soulService   = require(path.join(gamemodeDir, 'soul-service'));
const survivalService = require(path.join(gamemodeDir, 'survival-service'));

console.log("[phase0] SkyMP Heavy RP gamemode loaded");

// AETHERIUS_ADMIN_PANEL
// Painel da Staff (F7). Só liga com config/admin-panel.local.json { "enabled": true }.
// Erro de configuração do painel não derruba o gamemode.
try {
  if (typeof mp !== 'undefined') require(path.join(gamemodeDir, 'admin-panel', 'install.cjs')).install({ mp, gamemodeDir });
} catch (err) {
  console.error('[aetherius-admin] painel desativado:', err.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro de módulos
// ─────────────────────────────────────────────────────────────────────────────

moduleRegistry.register((() => {
  let gameplayCore = null;
  return {
    id: 'gameplay-core',
    enabledBy: 'ENABLE_GAMEPLAY_CORE',
    phase: 'lab',
    dependencies: [],
    commands: [],
    initialize: async () => {
      if (gameplayCore) return;
      if (!process.env.GAMEPLAY_CORE_BUNDLE) {
        throw new Error('Defina GAMEPLAY_CORE_BUNDLE para carregar o Core');
      }
      const bundle = require(path.resolve(process.cwd(), process.env.GAMEPLAY_CORE_BUNDLE));
      if (typeof bundle.createGameplayCore !== 'function') {
        throw new Error('Bundle sem createGameplayCore');
      }
      const core = bundle.createGameplayCore({
        mp: typeof mp === 'undefined' ? undefined : mp,
        pg: require(path.join(gamemodeDir, 'core', 'pg')),
        env: process.env,
        log: console
      });
      for (const method of ['initialize', 'shutdown', 'healthCheck', 'info']) {
        if (!core || typeof core[method] !== 'function') {
          throw new Error(`GameplayCore sem ${method}`);
        }
      }
      try {
        await core.initialize();
        gameplayCore = core;
      } catch (err) {
        await core.shutdown();
        throw err;
      }
    },
    shutdown: async () => {
      if (!gameplayCore) return;
      await gameplayCore.shutdown();
      gameplayCore = null;
    },
    healthCheck: () => gameplayCore !== null && gameplayCore.healthCheck() === true
  };
})());

moduleRegistry.register({
  id: 'npc-cleaner',
  enabledBy: 'ENABLE_NPC_CLEANER',
  phase: 'core',
  dependencies: [],
  commands: [],
  initialize: async () => {
    require(path.join(gamemodeDir, 'npc-cleaner')).startWorldCleaner();
  }
});

moduleRegistry.register({
  id: 'death',
  enabledBy: 'ENABLE_DEATH_SERVICE',
  phase: 'lab',
  dependencies: [],
  commands: deathService.commandDefs(),
  initialize: async () => {
    deathService.initDeathService();
  }
});

moduleRegistry.register({
  id: 'governance',
  enabledBy: 'ENABLE_GOVERNANCE_SERVICE',
  phase: 'lab',
  dependencies: [],
  commands: governance.commandDefs(),
  initialize: async () => {
    await governance.initGovernanceService();
    uiEventRouter.register('governance', governance.handleUiEvent);
  },
  shutdown: async () => {
    uiEventRouter.unregister('governance');
    governance.shutdownGovernanceService();
  }
});

moduleRegistry.register({
  id: 'market-stalls',
  enabledBy: 'ENABLE_MARKET_STALLS_SERVICE',
  phase: 'lab',
  dependencies: ['governance'],
  commands: marketStalls.commandDefs(),
  initialize: async () => {
    await marketStalls.initMarketStallsService();
  },
  shutdown: async () => {
    marketStalls.shutdownMarketStallsService();
  }
});

moduleRegistry.register({
  id: 'player-panel',
  enabledBy: 'ENABLE_PLAYER_PANEL_SERVICE',
  phase: 'lab',
  dependencies: ['governance'],
  commands: playerPanel.commandDefs(),
  initialize: async () => {
    await playerPanel.initPlayerPanelService();
    uiEventRouter.register('panel', playerPanel.handleUiEvent);
  },
  shutdown: async () => {
    uiEventRouter.unregister('panel');
    playerPanel.shutdownPlayerPanelService();
  }
});

moduleRegistry.register({
  id: 'soul',
  enabledBy: 'ENABLE_SOUL_SERVICE',
  phase: 'lab',
  dependencies: [],
  commands: soulService.commandDefs(),
  initialize: async () => {
    await soulService.initSoulService();
  },
  shutdown: async () => {
    soulService.shutdownSoulService();
  }
});

moduleRegistry.register({
  id: 'survival',
  enabledBy: 'ENABLE_SURVIVAL_SERVICE',
  phase: 'lab',
  dependencies: [],
  commands: survivalService.commandDefs(),
  initialize: async () => {
    await survivalService.initSurvivalService();
  },
  shutdown: async () => {
    await survivalService.shutdownSurvivalService();
  }
});

moduleRegistry.register({
  id: 'voip',
  enabledBy: 'ENABLE_VOIP_SERVICE',
  phase: 'lab',
  dependencies: [],
  commands: voipService.commandDefs(),
  initialize: async () => {
    voipService.startVoipServer();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Inicialização do servidor
// ─────────────────────────────────────────────────────────────────────────────

async function boot() {
  try {
    const options = serverOptions.load();
    console.log(`[phase0] server-options: ${options.usedFile ? options.path : 'nenhum arquivo, usando defaults'}`);
    for (const warning of options.warnings) {
      console.warn(`[phase0] server-options: ${warning}`);
    }

    db.init();
    console.log("[phase0] Database pool initialized");

    await moduleRegistry.bootAll();

  } catch (err) {
    console.error("[phase0] Fatal: Could not initialize database or services:", err.message);
  }
}

boot();

// ─────────────────────────────────────────────────────────────────────────────
// Runtime SkyMP
// ─────────────────────────────────────────────────────────────────────────────

if (typeof mp !== "undefined") {
  console.log("[phase0] mp API available");

  mp.makeProperty('browserVisible', {
    isVisibleByOwner: true,
    isVisibleByNeighbors: false,
    updateOwner: 'ctx.sp.browser.setVisible(ctx.value);',
    updateNeighbor: ''
  });
  mp.makeProperty('browserFocused', {
    isVisibleByOwner: true,
    isVisibleByNeighbors: false,
    updateOwner: 'ctx.sp.browser.setFocused(ctx.value);',
    updateNeighbor: ''
  });
  mp.makeProperty('browserModal', {
    isVisibleByOwner: true,
    isVisibleByNeighbors: false,
    updateOwner: `
      if (ctx.value && ctx.sp && ctx.sp.browser && ctx.sp.browser.executeJavaScript) {
        const payload = JSON.stringify(ctx.value);
        ctx.sp.browser.executeJavaScript('window.handleServerModal && window.handleServerModal(' + payload + ')');
      }
    `,
    updateNeighbor: ''
  });
  mp.makeProperty('panelData', {
    isVisibleByOwner: true,
    isVisibleByNeighbors: false,
    updateOwner: `
      if (ctx.value && ctx.sp && ctx.sp.browser && ctx.sp.browser.executeJavaScript) {
        const payload = JSON.stringify(ctx.value);
        ctx.sp.browser.executeJavaScript('window.handlePanelData && window.handlePanelData(' + payload + ')');
      }
    `,
    updateNeighbor: ''
  });
  mp.makeProperty('voipTicket', {
    isVisibleByOwner: true,
    isVisibleByNeighbors: false,
    updateOwner: `
      if (ctx.value && ctx.sp && ctx.sp.browser && ctx.sp.browser.executeJavaScript) {
        const payload = JSON.stringify(ctx.value);
        ctx.sp.browser.executeJavaScript('window.handleVoipTicket && window.handleVoipTicket(' + payload + ')');
      }
    `,
    updateNeighbor: ''
  });

  mp.on('customPacket', (userId, content) => {
    try {
      const actorId = mp.getUserActor(userId);
      if (!actorId) return;

      const uiEvent = JSON.parse(content);
      // admin:request não vai pro log: jogador comum apertando F7 encheria o log.
      if (uiEvent?.type !== 'admin:request') {
        console.log(`[phase0] customPacket from actor ${actorId.toString(16)}:`, uiEvent);
      }
      uiEventRouter.dispatch(actorId, uiEvent).catch(err =>
        console.error('[phase0] ui-event-router dispatch failed:', err.message)
      );
      if (uiEvent.type === 'cef::chat:send') {
        const text = uiEvent.data;
        commands.handleChatInput(actorId, text);
      }
      if (uiEvent.type === 'cef::voip:reconnect') {
        voipService.requestListenerReconnect(actorId);
      }
    } catch (err) {
      console.error("[phase0] Error in customPacket handler:", err.message);
    }
  });
} else {
  console.log("[phase0] mp API not available");
}

const activeUsers = new Set();
const userActorMap = new Map();
// userId conectado e ainda sem ator → quando foi visto pela primeira vez.
const pendingSince = new Map();

// Conexões verificadas por volta (o servidor aceita até maxPlayers; antes só
// 1..10 eram vistas e o 11º jogador nunca passava pelo login).
const MAX_USER_ID = 128;
// Conexão sem ator por mais que isto é derrubada (ver abaixo).
const NO_ACTOR_KICK_MS = 15000;

/**
 * profileId do ator, direto da propriedade `profileId` do servidor. Antes era
 * uma varredura de getActorsByProfileId(1..50): quem tinha profile_id acima de
 * 50 (06/10/2026: profile 66) nunca passava pelo login.
 */
function profileIdOf(actorId) {
  try {
    const id = Number(mp.get(actorId, 'profileId'));
    return Number.isInteger(id) && id > 0 ? id : -1;
  } catch {
    return -1;
  }
}

// Polling de Conexões de Rede (2 em 2 segundos)
setInterval(() => {
  if (typeof mp === "undefined") return;

  for (let userId = 0; userId <= MAX_USER_ID; userId++) {
    const connected = mp.isConnected(userId);
    if (!connected) pendingSince.delete(userId);
    if (connected && !activeUsers.has(userId)) {
      try {
        const actorId = mp.getUserActor(userId);

        if (!actorId) {
          // Conexão que chegou antes de o login do servidor subir (o jogo
          // reconectando sozinho quando o servidor abre): o login nunca a viu
          // e ela fica sem ator pra sempre. Avisa uma vez e, passado o prazo,
          // derruba — o jogo reconecta e desta vez o login já está de pé.
          const since = pendingSince.get(userId);
          if (since === undefined) {
            pendingSince.set(userId, Date.now());
            console.log(`[phase0] Connection detected! User ID: ${userId} (ainda sem ator)`);
          } else if (Date.now() - since > NO_ACTOR_KICK_MS) {
            console.warn(`[phase0] User ${userId} conectado ha ${Math.round((Date.now() - since) / 1000)}s sem ator (conexao anterior ao login?). Derrubando para reconectar.`);
            pendingSince.delete(userId);
            try {
              mp.kick(userId);
            } catch (kickErr) {
              console.error(`[phase0] Falha ao derrubar user ${userId}:`, kickErr.message);
            }
          }
          continue;
        }
        pendingSince.delete(userId);
        console.log(`[phase0] Connection detected! User ID: ${userId}, actor ${actorId.toString(16)}`);

        {
          // Só marca como "processado" agora que o ator realmente existe —
          // se marcássemos antes, e o ator ainda não tivesse carregado, este
          // usuário nunca mais seria reavaliado nos próximos ticks.
          activeUsers.add(userId);

          const foundProfileId = profileIdOf(actorId);
          console.log(`[phase0] User ${userId} mapped to profileId: ${foundProfileId}`);
          userActorMap.set(userId, actorId);

          if (foundProfileId !== -1) {
            // Desde 06/10/2026 o login sempre passa pelo banco (whitelist.js):
            // o jogo saiu do MySQL e o PostgreSQL existe em todo ambiente. Antes,
            // ALLOW_LOCAL_AUTOWHITELIST pulava o banco e registrava um personagem
            // falso só na memória (id = profileId, "Local TesterN").

            // Limpa qualquer toast antigo preso na property (ex: de uma
            // tentativa anterior de /voz que falhou antes do personagem estar
            // registrado) — senão o motor re-sincroniza o valor velho e o
            // toast reaparece sozinho, em loop.
            try {
              mp.set(actorId, 'browserModal', null);
            } catch (err) {
              console.error(`[phase0] Failed to clear stale browserModal for actor ${actorId.toString(16)}:`, err.message);
            }

            whitelist.checkWhitelist(userId, foundProfileId, actorId)
              .then((allowed) => {
                if (allowed) {
                  console.log(`[phase0] User ${userId} successfully approved by database check.`);
                } else {
                  console.log(`[phase0] User ${userId} was rejected and kicked by database check.`);
                  activeUsers.delete(userId);
                  userActorMap.delete(userId);
                  commands.removeActiveCharacter(actorId);
                  playerPanel.cleanup(actorId);
                  whitelist.forgetActor(actorId);
                }
              })
              .catch((err) => {
                console.error(`[phase0] Error in async checkWhitelist for user ${userId}:`, err.message);
                if (typeof mp !== 'undefined') mp.kick(userId);
                activeUsers.delete(userId);
                userActorMap.delete(userId);
                commands.removeActiveCharacter(actorId);
                playerPanel.cleanup(actorId);
                whitelist.forgetActor(actorId);
              });
          } else {
            console.log(`[phase0] User ${userId} actor ${actorId.toString(16)} has no associated profileId in server registry.`);
          }
        }
      } catch (err) {
        console.error(`[phase0] Error processing connection for user ${userId}:`, err.message);
      }
    } else if (!connected && activeUsers.has(userId)) {
      activeUsers.delete(userId);
      console.log(`[phase0] Disconnection detected! User ID: ${userId}`);

      const actorId = userActorMap.get(userId);
      userActorMap.delete(userId);
      if (actorId) {
        // Antes de tirar dos ativos: é de lá que vem o id do personagem.
        whitelist.saveCharacterPosition(actorId)
          .catch((err) => console.error(`[phase0] Falha ao gravar a posicao do user ${userId}:`, err.message));
        try {
          commands.removeActiveCharacter(actorId);
          playerPanel.cleanup(actorId);
          whitelist.forgetActor(actorId);
        } catch (err) {
          console.error(`[phase0] Error cleaning up disconnected user ${userId}:`, err.message);
        }
      }
    }
  }
}, 2000);
