import type { FeatureMode } from '../../shared/contracts/src/capabilities.js';
import type { SessionBinding } from '../../shared/contracts/src/identity.js';
import { loadDomain } from '../../shared/record-catalog/src/index.ts';
import type { DomainCatalog, DomainData } from '../../shared/record-catalog/src/types.ts';
import { deepFreeze } from '../../shared/record-catalog/src/integrity.ts';
import { createFileHost } from '../../tools/catalog/host.ts';
import { applyMigrations, migrationStatus, executeCommand, withTransaction } from '../../shared/persistence/src/index.js';
import type { Migration, PoolPort } from '../../shared/persistence/src/index.js';
import { createStandingStoneSpike } from '../spike-standing-stone/index.mjs';
import type { StandingStoneMp } from '../spike-standing-stone/index.mjs';
import { Actors } from './actors.js';
import { DEVELOPMENT_OPTIONS, requireDevelopmentOption } from './development.js';
import { Hooks, Scope } from './scope.js';
import type { Hook, HostContext } from './host.js';
import { SpellProjection } from './projection/index.js';
import { PerkDelivery } from './projection/perks.ts';
import { ClientDelivery } from './client-delivery.ts';
export { ClientDelivery } from './client-delivery.ts';
export { PerkDelivery } from './projection/perks.ts';
export { perkMigration } from './projection/migration.ts';
import { ActorComposition, nativeStonePerkKeys } from './composition.ts';
export {nativeStonePerkKeys} from './composition.ts';
import { StandingStoneSystem } from './standing-stones.ts';
import { RaceSystem } from './races.ts';
import { ClassSystem } from './classes.ts';
import { PoisonProjection } from './poison.ts';
export { poisonDoseBonus } from './poison.ts';
import { developmentLevel } from '../../modules/class-progression-system/src/index.ts';
export { classGrants, readClass, createClassCommands, developmentLevel, withDevelopmentLevel } from '../../modules/class-progression-system/src/index.ts';
export { createDurableLeveling } from '../../modules/leveling-system/src/integration/durable.ts';
export { levelingLevelPort, readProgress } from '../../modules/leveling-system/src/persistence/durable.ts';
import type { RaceOwnership } from '../../modules/race-system/src/ownership.ts';
import type { ChoiceIntent } from '../../modules/standing-stone-system/src/index.ts';
export { standingStoneGrants, createStandingStoneCommands } from '../../modules/standing-stone-system/src/index.ts';
export { ActorComposition } from './composition.ts';
export { raceGrants, initialRaceAttributes, readRace } from '../../modules/race-system/src/index.ts';
export { SpellProjection } from './projection/index.js';
export type { ProjectionResult, ProjectionOutcome, ProjectionItem } from './projection/index.js';
export type { HostContext, RuntimeMp } from './host.js';
export type { ActorReady } from './actors.js';

declare const BUNDLE_VERSION: string;
declare const BUILD_DOMAINS: readonly DomainData[];
declare const BUILD_MIGRATIONS: readonly Migration[];
declare const BUILD_RACE_OWNERSHIP: readonly RaceOwnership[];
export interface SystemContext {
  readonly id: string;
  readonly mode: FeatureMode;
  readonly catalog: DomainCatalog | undefined;
  readonly persistence: { readonly pool: PoolPort; readonly withTransaction: typeof withTransaction; readonly executeCommand: typeof executeCommand } | undefined;
  readonly identity: Actors;
  readonly projection: Pick<SpellProjection, 'publish' | 'onAck' | 'capability' | 'perkStatus'>;
  readonly composition: Pick<ActorComposition, 'register' | 'recompose' | 'inspect'>;
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
  /** A dependency failure still needs an observer/veto; it never authorizes mutation. */
  readonly observeUnavailable?: boolean;
  start(context: SystemContext): void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
}
interface SystemSpec { id: string; domain?: string; requiresDatabase: boolean }
const defaults: readonly SystemSpec[] = [
  { id: 'standing-stones', domain: 'standing-stones', requiresDatabase: true },
  { id: 'races', domain: 'races', requiresDatabase: true },
  { id: 'leveling', requiresDatabase:true },
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
  const refusedDevOptions = new Map<string, string>();
  const devEnabled = (option: string) => !refusedDevOptions.has(option) && env[option] === 'true';
  const raceOwnership = deepFreeze(JSON.parse(JSON.stringify(BUILD_RACE_OWNERSHIP)) as readonly RaceOwnership[]);
  const registrations = new Map<string, SystemRegistration>();
  const specs = new Map(defaults.map(spec => [spec.id, spec]));
  const featureModes = new Map<string, FeatureMode>();
  const catalogs = new Map<string, DomainCatalog>();
  const catalogFailures = new Map<string, readonly string[]>();
  let db = { status: 'UNSUPPORTED', missing: ['Runtime has not initialized'] as readonly string[] };
  let pool: PoolPort | undefined;
  let scope = new Scope();
  let actors = new Actors(host.mp, scope, false, warn);
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
  let composition: ActorComposition | undefined;
  let standingStones: StandingStoneSystem | undefined;
  let races: RaceSystem | undefined;
  let classes: ClassSystem | undefined;
  let devClassLevel:number|undefined;
  let clientDelivery: ClientDelivery | undefined;
  let perkDeliveryFailure: string | undefined;
  const deliveryMode = modes.has(env.GAMEPLAY_CORE_CLIENT_PERKS_MODE as FeatureMode) ? env.GAMEPLAY_CORE_CLIENT_PERKS_MODE as FeatureMode : 'off';
  registrations.set('classes',{id:'classes',domain:'classes',requiresDatabase:true,start(context){
    const eligible=new Set((env.GAMEPLAY_CORE_CANARY_CHARACTERS??'').split(',').map(s=>s.trim()));
    classes=new ClassSystem(context,BUILD_DOMAINS.find(d=>d.domain==='classes')!,devClassLevel,env.GAMEPLAY_CORE_DATABASE_SCHEMA??'public',
      key=>context.mode==='active'||context.mode==='canary'&&eligible.has(key));
    classes.start();return()=>classes!.shutdown();
  }});
  registrations.set('races', { id:'races', domain:'races', requiresDatabase:true, observeUnavailable:true, start(context) {
    races = new RaceSystem(context, host.mp, env.GAMEPLAY_CORE_DATABASE_SCHEMA ?? 'public');
    races.start(); return () => races!.shutdown();
  } });
  registrations.set('standing-stones', { id: 'standing-stones', domain: 'standing-stones', requiresDatabase: true,
    observeUnavailable: true, start(context) {
      const data = BUILD_DOMAINS.find(domain => domain.domain === 'standing-stones')!;
      standingStones = new StandingStoneSystem(context, host.mp, data, env.GAMEPLAY_CORE_DATABASE_SCHEMA ?? 'public');
      standingStones.start(); return () => standingStones!.shutdown();
    } });
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
      missing: Object.freeze(missing), proof: Object.freeze(['runtime/tests/runtime.test.mjs', 'runtime/tests/database.test.mjs',
        ...(spec.id === 'standing-stones' ? ['modules/standing-stone-system/tests/provider.test.mjs', 'runtime/tests/standing-stones.test.mjs'] : []),
        ...(spec.id === 'races' ? ['modules/race-system/tests/provider.test.mjs', 'runtime/tests/races.acceptance.mjs'] : [])]),
      ...(spec.id === 'races' ? { ownership: raceOwnership,
        observation: Object.freeze({ source:'mp.get(actorId, appearance).raceId', changeSignal:'onUpdateAppearanceAttempt',
          resultAuthority:'NATIVE_CLIENT', hostMutations:0, limitations:['BASE_NPC_RACE_USED_BY_NATIVE_ADD_SPELL', 'MULTIPLAYER_RESULTS_UNVERIFIED'] }) } : {}),
      ...(spec.id==='classes'?{levelOrigin:devClassLevel===undefined?'LEVELING':'DEV',devClassLevel:devClassLevel??null,
        perkDelivery:projection?.capability().perks??{status:'UNSUPPORTED',reason:'CLIENT_PERK_DELIVERY_OFF_OR_UNAVAILABLE'},proof:['runtime/tests/classes.acceptance.mjs','runtime/tests/perks.test.mjs']} : {}),
      ...(spec.id==='leveling'?{adapter:'DURABLE_POSTGRESQL',eventSource:{status:'UNSUPPORTED',reason:'SERVER_CONFIRMED_DEATH_OWNER_NOT_DECIDED'},proof:['runtime/tests/classes.acceptance.mjs']} : {}),
      ...(spec.id === 'standing-stones' ? { ownership: Object.freeze({ grants: 'AETHERIUS_SERVER', results: 'NATIVE_CLIENT' }),
        playerFeedback: Object.freeze({ status: host.mp?.makeProperty && host.mp.set ? 'PARTIAL' : 'UNSUPPORTED',
          channel: 'OWNER_PROPERTY_DEBUG_NOTIFICATION', delivery: 'UNCONFIRMED', proof: ['runtime/tests/standing-stones.test.mjs'] }) } : {}),
      registered: registrations.has(spec.id), started: initialized && registrations.has(spec.id) && mode(spec.id) !== 'off' && !missing.length });
  }
  function report() {
    return Object.freeze({ version: BUNDLE_VERSION, initialized, database: Object.freeze({ ...db }),
      actorReady: Object.freeze({ status: 'PARTIAL', signal: clientDelivery ? 'CLIENT_SPAWN_TASKS_COMPLETED_WITH_LEGACY_APPROXIMATION' : 'ONLINE_DELAY_APPROXIMATION', limitations: actors.limitations, proof: ['runtime/tests/runtime.test.mjs','runtime/tests/client-delivery.test.mjs'] }),
      clientPerks: Object.freeze({mode:deliveryMode,...clientDelivery?.capability()??{status:'UNSUPPORTED',reason:perkDeliveryFailure??'CLIENT_PROTOCOL_OFF'}}),
      projection: projection?.capability() ?? Object.freeze({ status: 'UNSUPPORTED', reason: 'Runtime has not initialized' }),
      systems: Object.freeze([...specs.values()].map(capability)),
      spike: Object.freeze({ enabled: devEnabled('ENABLE_STANDING_STONE_SPIKE'), running: !!spike,
        ...(refusedDevOptions.has('ENABLE_STANDING_STONE_SPIKE') ? { reason: refusedDevOptions.get('ENABLE_STANDING_STONE_SPIKE') } : {}) }) });
  }
  function disposeNow() { wanted = false; initialized = false; controller.abort(); spike?.shutdown(); spike = undefined; scope.close(); }
  async function stopSystems() {
    for (const stop of stops.splice(0).reverse()) { try { await stop(); } catch { warn('system shutdown failed'); } }
    await composition?.shutdown(); composition = undefined; standingStones = undefined; races = undefined; classes=undefined;
    await projection?.shutdown(); projection = undefined; clientDelivery=undefined;
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
    if(env.GAMEPLAY_CORE_CLIENT_PERKS_MODE!==undefined&&!modes.has(env.GAMEPLAY_CORE_CLIENT_PERKS_MODE as FeatureMode))warn('invalid GAMEPLAY_CORE_CLIENT_PERKS_MODE; using off');
    refusedDevOptions.clear();
    for (const option of DEVELOPMENT_OPTIONS) {
      try { requireDevelopmentOption(env, option); }
      catch (error) { const reason = (error as Error).message; refusedDevOptions.set(option, reason); warn(`ERROR ${reason}`); }
    }
    actors = new Actors(host.mp, scope, devEnabled('GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY'), warn, 3000,
      refusedDevOptions.has('GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY'));
    hooks = new Hooks(host.mp, scope, warn);
    catalogs.clear(); catalogFailures.clear(); failures.clear(); pool = undefined;
    devClassLevel=undefined;
    try{devClassLevel=developmentLevel(env.GAMEPLAY_CORE_DEV_CLASS_LEVEL,env);
      if(devClassLevel!==undefined)warn(`DEV class level override=${devClassLevel}; read only; never use on official server`);
    }catch(error){failures.set('classes',refusedDevOptions.get('GAMEPLAY_CORE_DEV_CLASS_LEVEL') ?? (error as {code:string}).code);warn(`ERROR ${failures.get('classes')}; classes refused`);}
    failures.set('leveling','SERVER_CONFIRMED_DEATH_OWNER_NOT_DECIDED: durable adapter available; no event source connected');
    for (const spec of specs.values()) mode(spec.id);
    if (devEnabled('ENABLE_STANDING_STONE_SPIKE') && ['canary', 'active'].includes(mode('standing-stones'))) {
      failures.set('standing-stones', 'STANDING_STONE_SPIKE_CONFLICT: disable ENABLE_STANDING_STONE_SPIKE before canary/active');
      warn(failures.get('standing-stones')!);
    }
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
      if (refusedDevOptions.has('GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV')) throw Object.assign(Error('Development migrations refused'), { code: 'DEV_MIGRATIONS_REFUSED' });
      pool = host.pg.init();
      const schema = env.GAMEPLAY_CORE_DATABASE_SCHEMA ?? 'public';
      if (devEnabled('GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV')) await applyMigrations(pool, BUILD_MIGRATIONS, schema);
      // C2 is optional. A missing race table disables races, while the approved
      // standing-stone installation keeps using its already-applied foundation.
      // Optional slices cannot disable the already approved stone installation.
      const verifySlice=async(versions:readonly string[])=>{
        const subset=BUILD_MIGRATIONS.filter(m=>m.version<'0005'||versions.includes(m.version));
        const selected=new Set(subset.map(m=>m.version)),known=new Set(BUILD_MIGRATIONS.map(m=>m.version));
        const view:PoolPort={async connect(){const client=await pool!.connect();return {release:error=>client.release(error),
          async query<Row=Record<string,unknown>>(sql:string,params?:unknown[]){const result=await client.query<Row>(sql,params);
            if(sql==='SELECT version, sha256, applied_at FROM gc_schema_migrations ORDER BY version')return {...result,rows:result.rows.filter(row=>{
              const version=(row as {version:string}).version;return selected.has(version)||!known.has(version);
            })};return result;}};}};
        await migrationStatus(view,subset,schema);
      };
      await verifySlice([]);
      for(const [id,versions] of [['races',['0005_gc_race_observation.sql']],['classes',['0006_gc_character_class.sql','0007_gc_leveling_progress.sql']]] as const){
        try{await verifySlice(versions);}
        catch{if(!failures.has(id))failures.set(id,`${id.toUpperCase()}_MIGRATION_UNAVAILABLE: apply ${versions.join(', ')}`);}
      }
      perkDeliveryFailure=undefined;
      try{await verifySlice(['0008_gc_perk_projection.sql']);}catch{perkDeliveryFailure='PERK_MIGRATION_UNAVAILABLE: apply 0008_gc_perk_projection.sql';}
      db = { status: 'SUPPORTED', missing: Object.freeze([]) };
    } catch (error) {
      const code = safeCode(error);
      db = { status: 'UNSUPPORTED', missing: Object.freeze([code, `Required migrations: ${BUILD_MIGRATIONS.map(m => m.version).join(', ')}`, instruction]) };
      warn(`persistence unavailable: ${code}; ${instruction}`);
    }
    if (!current()) return;
    const canary = new Set((env.GAMEPLAY_CORE_CANARY_CHARACTERS ?? '').split(',').map(s => s.trim()).filter(s => /^profile:[1-9][0-9]*$/.test(s)));
    const deliveryAllowed=(binding:SessionBinding)=>current()&&actors.isCurrent(binding)&&(deliveryMode==='active'||deliveryMode==='canary'&&canary.has(binding.characterKey));
    let perks:PerkDelivery|undefined;
    if(['active','canary'].includes(deliveryMode)&&db.status==='SUPPORTED'&&!perkDeliveryFailure&&pool&&host.mp?.on&&host.mp.getUserActor&&host.mp.getUserByActor&&host.mp.sendCustomPacket){
      clientDelivery=new ClientDelivery(host.mp,actors,scope,deliveryAllowed,warn);clientDelivery.start(hooks);
      const ranks=new Map<import('../../shared/contracts/src/identity.js').StableFormKey,Set<number>>();
      const classData=BUILD_DOMAINS.find(d=>d.domain==='classes');
      for(const cls of classData?.classes??[])for(const stage of cls.stages)for(const perk of stage.perks)if(perk.stableFormKey&&perk.rank){
        if(!ranks.has(perk.stableFormKey))ranks.set(perk.stableFormKey,new Set());ranks.get(perk.stableFormKey)!.add(perk.rank);
      }
      perks=new PerkDelivery({pool,schema:env.GAMEPLAY_CORE_DATABASE_SCHEMA??'public',channel:clientDelivery,catalogs:[...catalogs.values()],rankRecords:ranks,
        check:binding=>{if(!deliveryAllowed(binding))throw Error('STALE_BINDING_OR_CLIENT_MODE');},nativeRecords:(binding,set)=>new Set([
          ...races?.nativeKeys(binding)??[],...nativeStonePerkKeys(set,BUILD_DOMAINS.find(d=>d.domain==='standing-stones'))]),warn});
    }else if(['active','canary'].includes(deliveryMode))warn(`client perks UNSUPPORTED: ${perkDeliveryFailure??'TRANSPORT_OR_DATABASE_UNAVAILABLE'}`);
    projection = new SpellProjection({ pool: db.status === 'SUPPORTED' ? pool : undefined,
      ...(perks?{perks}:{}),
      unavailableReason: db.missing.join(' | '), mp: host.mp, schema: env.GAMEPLAY_CORE_DATABASE_SCHEMA ?? 'public',
      catalogs: [...catalogs.values()], identity: actors, actors, signal: controller.signal, warn,
      nativeRecords: binding => races?.nativeKeys(binding) ?? new Set(),
      canProject: binding => current() && [...registrations.values()].some(system => !failures.has(system.id)
        && capability(specs.get(system.id)!).status === 'SUPPORTED'
        && (mode(system.id) === 'active' || (mode(system.id) === 'canary' && canary.has(binding.characterKey)))) });
    const commonProjection = projection;
    const poisonProjection=new PoisonProjection(host.mp,()=>[...catalogs.values()],binding=>current()&&actors.isCurrent(binding),warn);
    scope.add(()=>poisonProjection.shutdown());
    actors.onUnbound(binding=>poisonProjection.clear(binding));
    if(host.mp?.getServerSettings().aetheriusCombat?.weaponPoison===true)
      actors.onReady(({binding})=>{void composition?.inspect(binding).catch(()=>warn('poison dose UNSUPPORTED: composition unavailable'));});
    composition = new ActorComposition({ pool: db.status === 'SUPPORTED' ? pool : undefined,
      schema: env.GAMEPLAY_CORE_DATABASE_SCHEMA ?? 'public',
      check: binding => { if (!current() || !actors.isCurrent(binding)) throw Object.assign(Error('STALE_BINDING'), { code: 'STALE_BINDING' }); },
      publish: (binding, set) => commonProjection.publish({ binding, set }),
      onComposed:(binding,set)=>poisonProjection.publish(binding,set) });
    actors.start();
    const health = (reply: (healthy: boolean) => void) => reply(initialized);
    process.on(healthEvent, health); scope.add(() => process.removeListener(healthEvent, health));
    for (const system of registrations.values()) {
      const spec = specs.get(system.id)!;
      const m = mode(system.id);
      if (m === 'off' || (failures.has(system.id) && !system.observeUnavailable) || (capability(spec).status !== 'SUPPORTED' && !system.observeUnavailable)) continue;
      const systemScope = new Scope(); scope.add(() => systemScope.close());
      let systemActive = true; systemScope.add(() => { systemActive = false; });
      const systemProjection = projection;
      const systemComposition = composition;
      const context: SystemContext = Object.freeze({ id: system.id, mode: m, catalog: spec.domain ? catalogs.get(spec.domain) : undefined,
        persistence: pool && db.status === 'SUPPORTED' && !failures.has(system.id) ? Object.freeze({ pool, withTransaction, executeCommand }) : undefined,
        identity: actors, projection: Object.freeze({
          capability: () => systemProjection.capability(), perkStatus:(binding:SessionBinding)=>systemProjection.perkStatus(binding), onAck: (listener: Parameters<SpellProjection['onAck']>[0]) => systemProjection.onAck(listener),
          publish: (input: Parameters<SpellProjection['publish']>[0]) => {
            if (!systemActive || !context.canMutate(input.binding)) return Promise.resolve({ status: 'UNSUPPORTED' as const,
              reason: 'FEATURE_MODE_OR_BINDING_REFUSED', state: 'REJECTED' as const, items: [] });
            return systemProjection.publish(input);
          }
        }), composition: Object.freeze({ register: (provider: Parameters<ActorComposition['register']>[0]) => systemScope.add(systemComposition.register(provider)),
          inspect: (binding: SessionBinding) => {
            if (!systemActive || !actors.isCurrent(binding)) return Promise.reject(Error('STALE_BINDING'));
            return systemComposition.inspect(binding);
          },
          recompose: (binding: SessionBinding) => {
            if (!systemActive || !context.canMutate(binding)) return Promise.resolve({ status: 'UNSUPPORTED' as const,
              reason: 'FEATURE_MODE_OR_BINDING_REFUSED', state: 'REJECTED' as const, items: [] });
            return systemComposition.recompose(binding);
          } }), actors: Object.freeze({ onReady: (fn: Parameters<Actors['onReady']>[0]) => systemScope.add(actors.onReady(fn)),
          onUnbound: (fn: Parameters<Actors['onUnbound']>[0]) => systemScope.add(actors.onUnbound(fn)) }),
        hooks: Object.freeze({ register: (name: `on${string}`, fn: Hook) => systemScope.add(hooks.register(name, fn)) }),
        signal: controller.signal, log: host.log,
        canMutate: (binding: SessionBinding) => current() && actors.isCurrent(binding) && (m === 'active' || (m === 'canary' && canary.has(binding.characterKey))) });
      try { const stop = await system.start(context); if (typeof stop === 'function') stops.push(stop); }
      catch { systemScope.close(); failures.set(system.id, 'System start failed'); warn(`system ${system.id} start failed`); }
      if (!current()) { await stopSystems(); return; }
    }
    if (devEnabled('ENABLE_STANDING_STONE_SPIKE') && host.mp && pool) {
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
    chooseStandingStone: (intent: ChoiceIntent) => standingStones?.choose(intent) ?? Promise.resolve({ status: 'UNSUPPORTED' as const,
      reason: failures.get('standing-stones') ?? 'STANDING_STONES_NOT_STARTED', committed: false }),
    observeRace: (binding: SessionBinding) => races?.observe(binding) ?? Promise.resolve({status:'UNSUPPORTED' as const,raceKey:null,reason:'RACES_NOT_STARTED'}),
    setCharacterClass:(input:{binding:SessionBinding;requestId:string;classId:string})=>classes?.set(input)??Promise.resolve({status:'UNSUPPORTED' as const,reason:failures.get('classes')??'CLASSES_NOT_STARTED'}),
    inspectActor:(binding:SessionBinding)=>composition?.inspect(binding)??Promise.reject(Error('COMPOSITION_UNAVAILABLE')),
    refreshClass:(binding:SessionBinding)=>classes?.refresh(binding)??Promise.resolve({status:'UNSUPPORTED' as const,reason:failures.get('classes')??'CLASSES_NOT_STARTED'}),
    get identity() { return actors; },
    get actorEvents() { return actors; },
    capabilityReport: report,
    healthCheck: () => initialized,
    info: () => Object.freeze({ ...report(), features: Object.freeze([...specs.values()].map(spec => Object.freeze({ id: spec.id,
      mode: spec.id === 'standing-stones' && devEnabled('ENABLE_STANDING_STONE_SPIKE') ? 'active' : mode(spec.id) }))), resources: scope.size })
  });
  return api;
}
