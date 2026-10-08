import type { FeatureMode } from '../../shared/contracts/src/capabilities.js';
import type { SessionBinding } from '../../shared/contracts/src/identity.js';
import { loadDomain } from '../../shared/record-catalog/src/index.ts';
import type { DomainCatalog, DomainData } from '../../shared/record-catalog/src/types.ts';
import { createFileHost } from '../../tools/catalog/host.ts';
import { applyMigrations, migrationStatus, executeCommand, withTransaction } from '../../shared/persistence/src/index.js';
import type { Migration, PoolPort } from '../../shared/persistence/src/index.js';
import { createStandingStoneSpike } from '../spike-standing-stone/index.mjs';
import type { StandingStoneMp } from '../spike-standing-stone/index.mjs';
import { Actors } from './actors.js';
import { Hooks, Scope } from './scope.js';
import type { Hook, HostContext } from './host.js';
import { SpellProjection } from './projection/index.js';
export { SpellProjection } from './projection/index.js';
export type { ProjectionResult, ProjectionOutcome, ProjectionItem } from './projection/index.js';
export type { HostContext, RuntimeMp } from './host.js';
export type { ActorReady } from './actors.js';

declare const BUNDLE_VERSION: string;
declare const BUILD_DOMAINS: readonly DomainData[];
declare const BUILD_MIGRATIONS: readonly Migration[];
export interface SystemContext {
  readonly id: string;
  readonly mode: FeatureMode;
  readonly catalog: DomainCatalog | undefined;
  readonly persistence: { readonly pool: PoolPort; readonly withTransaction: typeof withTransaction; readonly executeCommand: typeof executeCommand } | undefined;
  readonly identity: Actors;
  readonly projection: Pick<SpellProjection, 'publish' | 'onAck' | 'capability'>;
  readonly actors: Pick<Actors, 'onReady' | 'onUnbound'>;
  readonly hooks: { register(name: `on${string}`, listener: Hook): () => void };
  readonly log: HostContext['log'];
  readonly signal: AbortSignal;
  canMutate(binding: SessionBinding): boolean;
}
export interface SystemRegistration {
  readonly id: string;
  readonly domain?: string;
  readonly requiresDatabase?: boolean;
  start(context: SystemContext): void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
}
interface SystemSpec { id: string; domain?: string; requiresDatabase: boolean }
const defaults: readonly SystemSpec[] = [
  { id: 'standing-stones', domain: 'standing-stones', requiresDatabase: true },
  { id: 'races', domain: 'races', requiresDatabase: false },
  ...['classes', 'religion', 'spells', 'perks', 'damage'].map(id => ({ id, domain: id, requiresDatabase: true }))
];
const coordinatorKey = Symbol.for('aetherius.runtime.coordinator.v1');
interface Coordinator { tail: Promise<unknown>; active?: { shutdown(): Promise<void> } }
const shared = process as unknown as Record<symbol, Coordinator>;
const coordinator = shared[coordinatorKey] ??= { tail: Promise.resolve() };
const healthEvent = 'aetherius:gameplay-core:health-check';
const modes = new Set<FeatureMode>(['off', 'audit', 'shadow', 'canary', 'active']);
const envKey = (id: string) => `GAMEPLAY_CORE_MODE_${id.replaceAll('-', '_').toUpperCase()}`;
const safeCode = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : 'BOOT_DEPENDENCY_FAILED';
};

/** Host descriptor contract is preserved; configuration is snapped per lifecycle. */
export function createGameplayCore(host: HostContext) {
  const env = { ...host.env };
  const registrations = new Map<string, SystemRegistration>();
  const specs = new Map(defaults.map(spec => [spec.id, spec]));
  const featureModes = new Map<string, FeatureMode>();
  const catalogs = new Map<string, DomainCatalog>();
  const catalogFailures = new Map<string, readonly string[]>();
  let db = { status: 'UNSUPPORTED', missing: ['Runtime has not initialized'] as readonly string[] };
  let pool: PoolPort | undefined;
  let scope = new Scope();
  let actors = new Actors(host.mp, scope, env.GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY === 'true', warn);
  let hooks = new Hooks(host.mp, scope, warn);
  let controller = new AbortController();
  let initialized = false;
  let wanted = false;
  let initializing: Promise<void> | undefined;
  let stopTask: Promise<void> | undefined;
  let generation = 0;
  const stops: (() => void | Promise<void>)[] = [];
  const failures = new Map<string, string>();
  let spike: ReturnType<typeof createStandingStoneSpike> | undefined;
  let projection: SpellProjection | undefined;
  function warn(message: string) { host.log.info(`[gameplay-core] ${message}`); }
  function mode(id: string): FeatureMode {
    let value = featureModes.get(id);
    if (!value) {
      const raw = env[envKey(id)] ?? 'off';
      value = modes.has(raw as FeatureMode) ? raw as FeatureMode : 'off';
      if (raw !== value) warn(`invalid mode for ${id}; using off`);
      featureModes.set(id, value);
    }
    return value;
  }
  function capability(spec: SystemSpec) {
    const catalog = spec.domain ? catalogs.get(spec.domain) : undefined;
    const missing = [...(spec.domain && catalog?.status !== 'SUPPORTED'
      ? catalog?.issues ?? catalogFailures.get(spec.domain) ?? [`Catalog domain ${spec.domain} not delivered`] : []),
      ...(spec.requiresDatabase && db.status !== 'SUPPORTED' ? db.missing : []),
      ...(failures.has(spec.id) ? [failures.get(spec.id)!] : [])];
    return Object.freeze({ id: spec.id, mode: mode(spec.id), status: missing.length ? 'UNSUPPORTED' as const : 'SUPPORTED' as const,
      catalog: Object.freeze({ domain: spec.domain ?? null, status: catalog?.status ?? 'UNSUPPORTED', limitations: catalog?.unsupported ?? [] }),
      missing: Object.freeze(missing), proof: Object.freeze(['runtime/tests/runtime.test.mjs', 'runtime/tests/database.test.mjs']),
      registered: registrations.has(spec.id), started: initialized && registrations.has(spec.id) && mode(spec.id) !== 'off' && !missing.length });
  }
  function report() {
    return Object.freeze({ version: BUNDLE_VERSION, initialized, database: Object.freeze({ ...db }),
      actorReady: Object.freeze({ status: 'PARTIAL', signal: 'ONLINE_DELAY_APPROXIMATION', limitations: actors.limitations, proof: ['runtime/tests/runtime.test.mjs'] }),
      projection: projection?.capability() ?? Object.freeze({ status: 'UNSUPPORTED', reason: 'Runtime has not initialized' }),
      systems: Object.freeze([...specs.values()].map(capability)),
      spike: Object.freeze({ enabled: env.ENABLE_STANDING_STONE_SPIKE === 'true', running: !!spike }) });
  }
  function disposeNow() { wanted = false; initialized = false; controller.abort(); spike?.shutdown(); spike = undefined; scope.close(); }
  async function stopSystems() {
    await projection?.shutdown(); projection = undefined;
    for (const stop of stops.splice(0).reverse()) { try { await stop(); } catch { warn('system shutdown failed'); } }
  }
  async function boot(ticket: number) {
    const current = () => wanted && generation === ticket;
    if (!current()) return;
    if (stopTask) await stopTask;
    if (!current()) return;
    if (coordinator.active && coordinator.active !== api) await coordinator.active.shutdown();
    if (!current()) return;
    coordinator.active = api;
    scope = new Scope(); controller = new AbortController();
    actors = new Actors(host.mp, scope, env.GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY === 'true', warn);
    hooks = new Hooks(host.mp, scope, warn);
    catalogs.clear(); catalogFailures.clear(); failures.clear(); pool = undefined;
    for (const spec of specs.values()) mode(spec.id);
    try {
      const mp = host.mp;
      if (!mp) throw new Error('host unavailable');
      const dataDir = mp.getServerSettings().dataDir;
      if (!dataDir) throw new Error('host data directory unavailable');
      const adapter = createFileHost(mp, dataDir, BUILD_DOMAINS);
      for (const domain of BUILD_DOMAINS) catalogs.set(domain.domain, loadDomain(domain, adapter));
    } catch { for (const domain of BUILD_DOMAINS) catalogFailures.set(domain.domain, ['Catalog host/files unavailable; check host dataDir and relevant plugin files']); }
    const instruction = 'Run npm run migrations:apply -- <absolute-path-to-gamemode-core/pg.js> [schema] from the Core root';
    try {
      pool = host.pg.init();
      const schema = env.GAMEPLAY_CORE_DATABASE_SCHEMA ?? 'public';
      if (env.GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV === 'true') await applyMigrations(pool, BUILD_MIGRATIONS, schema);
      await migrationStatus(pool, BUILD_MIGRATIONS, schema);
      db = { status: 'SUPPORTED', missing: Object.freeze([]) };
    } catch (error) {
      const code = safeCode(error);
      db = { status: 'UNSUPPORTED', missing: Object.freeze([code, `Required migrations: ${BUILD_MIGRATIONS.map(m => m.version).join(', ')}`, instruction]) };
      warn(`persistence unavailable: ${code}; ${instruction}`);
    }
    if (!current()) return;
    const canary = new Set((env.GAMEPLAY_CORE_CANARY_CHARACTERS ?? '').split(',').map(s => s.trim()).filter(s => /^profile:[1-9][0-9]*$/.test(s)));
    projection = new SpellProjection({ pool: db.status === 'SUPPORTED' ? pool : undefined,
      unavailableReason: db.missing.join(' | '), mp: host.mp, schema: env.GAMEPLAY_CORE_DATABASE_SCHEMA ?? 'public',
      catalogs: [...catalogs.values()], identity: actors, actors, signal: controller.signal, warn,
      canProject: binding => current() && [...registrations.values()].some(system => !failures.has(system.id)
        && capability(specs.get(system.id)!).status === 'SUPPORTED'
        && (mode(system.id) === 'active' || (mode(system.id) === 'canary' && canary.has(binding.characterKey)))) });
    actors.start();
    const health = (reply: (healthy: boolean) => void) => reply(initialized);
    process.on(healthEvent, health); scope.add(() => process.removeListener(healthEvent, health));
    for (const system of registrations.values()) {
      const spec = specs.get(system.id)!;
      const m = mode(system.id);
      if (m === 'off' || capability(spec).status !== 'SUPPORTED') continue;
      const systemScope = new Scope(); scope.add(() => systemScope.close());
      let systemActive = true; systemScope.add(() => { systemActive = false; });
      const systemProjection = projection;
      const context: SystemContext = Object.freeze({ id: system.id, mode: m, catalog: spec.domain ? catalogs.get(spec.domain) : undefined,
        persistence: pool && db.status === 'SUPPORTED' ? Object.freeze({ pool, withTransaction, executeCommand }) : undefined,
        identity: actors, projection: Object.freeze({
          capability: () => systemProjection.capability(), onAck: (listener: Parameters<SpellProjection['onAck']>[0]) => systemProjection.onAck(listener),
          publish: (input: Parameters<SpellProjection['publish']>[0]) => {
            if (!systemActive || !context.canMutate(input.binding)) return Promise.resolve({ status: 'UNSUPPORTED' as const,
              reason: 'FEATURE_MODE_OR_BINDING_REFUSED', state: 'REJECTED' as const, items: [] });
            return systemProjection.publish(input);
          }
        }), actors: Object.freeze({ onReady: (fn: Parameters<Actors['onReady']>[0]) => systemScope.add(actors.onReady(fn)),
          onUnbound: (fn: Parameters<Actors['onUnbound']>[0]) => systemScope.add(actors.onUnbound(fn)) }),
        hooks: Object.freeze({ register: (name: `on${string}`, fn: Hook) => systemScope.add(hooks.register(name, fn)) }),
        signal: controller.signal, log: host.log,
        canMutate: (binding: SessionBinding) => current() && actors.isCurrent(binding) && (m === 'active' || (m === 'canary' && canary.has(binding.characterKey))) });
      try { const stop = await system.start(context); if (typeof stop === 'function') stops.push(stop); }
      catch { systemScope.close(); failures.set(system.id, 'System start failed'); warn(`system ${system.id} start failed`); }
      if (!current()) { await stopSystems(); return; }
    }
    if (env.ENABLE_STANDING_STONE_SPIKE === 'true' && host.mp && pool) {
      let releaseHook: (() => void) | undefined;
      let legacyHook: Hook | undefined;
      const view = new Proxy(host.mp, { get(target, key) {
        if (key === 'onActivate') return legacyHook;
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      }, set(_target, key, value) {
        if (key !== 'onActivate') throw new Error('Spike cannot write host properties');
        releaseHook?.(); legacyHook = value as Hook | undefined;
        releaseHook = value ? hooks.register('onActivate', value as Hook) : undefined; return true;
      } });
      // Preserve the approved offline spike's provisional identity/reconnect path.
      // Production systems use Actors/IdentityPort; C1 will replace the spike.
      spike = createStandingStoneSpike({ mp: view as StandingStoneMp, pg: { init: () => pool! }, log: host.log });
      try { await spike.initialize(); }
      catch (error) { spike.shutdown(); spike = undefined; warn(`standing-stone spike unavailable: ${safeCode(error)}`); }
    }
    if (!current()) { disposeNow(); await stopSystems(); return; }
    initialized = true; warn(`bundle ${BUNDLE_VERSION}; initialized; active instances=1`);
    for (const item of report().systems) if (item.status === 'UNSUPPORTED') warn(`${item.id}: UNSUPPORTED; ${item.missing.join(' | ')}`);
  }
  const api = Object.freeze({
    initialize(): Promise<void> {
      if (initialized) return Promise.resolve();
      if (initializing && wanted) return initializing;
      wanted = true; const ticket = ++generation;
      const task = coordinator.tail.then(() => boot(ticket));
      coordinator.tail = task.catch(() => {});
      const taskWrapper = task.finally(() => { if (initializing === taskWrapper) initializing = undefined; });
      initializing = taskWrapper; return taskWrapper;
    },
    shutdown(): Promise<void> {
      ++generation; disposeNow();
      if (coordinator.active === api) delete coordinator.active;
      if (!stopTask) stopTask = (initializing ?? Promise.resolve()).catch(() => {}).then(stopSystems).finally(() => { stopTask = undefined; });
      return stopTask;
    },
    register(system: SystemRegistration): void {
      if (wanted || initialized) throw new Error('Register systems before initialize');
      if (!/^[a-z][a-z0-9-]*$/.test(system.id) || registrations.has(system.id)) throw new Error('Invalid/duplicate system id');
      registrations.set(system.id, Object.freeze({ ...system }));
      const prior = specs.get(system.id);
      const domain = system.domain ?? prior?.domain;
      specs.set(system.id, { id: system.id, ...(domain ? { domain } : {}), requiresDatabase: system.requiresDatabase ?? prior?.requiresDatabase ?? true });
    },
    mode,
    get identity() { return actors; },
    get actorEvents() { return actors; },
    capabilityReport: report,
    healthCheck: () => initialized,
    info: () => Object.freeze({ ...report(), features: Object.freeze([...specs.values()].map(spec => Object.freeze({ id: spec.id,
      mode: spec.id === 'standing-stones' && env.ENABLE_STANDING_STONE_SPIKE === 'true' ? 'active' : mode(spec.id) }))), resources: scope.size })
  });
  return api;
}
