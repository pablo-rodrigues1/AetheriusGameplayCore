/**
 * Boundary for the real SkyMP integration. The adapter accepts callbacks supplied by
 * the host runtime; it does not guess event names or import private SkyMP internals.
 * Canonical identities are resolved by the host at call time. No runtime load
 * index is persisted, so a reordered plugin list does not invalidate state.
 */
import { parseStableRecordIdentity } from '../records/identity.mjs';
import { prepareSkyMpSpawnLocation } from '../spawning/location.mjs';

export class SkyMpIntegrationAdapter {
  constructor({
    onServerDeath = null,
    onServerSpawn = null,
    onDungeonGeneration = null,
    onDungeonReset = null,
    resolveCanonicalRecord = null,
    resolveCellOrWorldDesc = null,
    persistence = null,
    loot = null
  } = {}) {
    this.onServerDeath = onServerDeath;
    this.onServerSpawn = onServerSpawn;
    this.onDungeonGeneration = onDungeonGeneration;
    this.onDungeonReset = onDungeonReset;
    this.resolveCanonicalRecord = resolveCanonicalRecord;
    this.resolveCellOrWorldDesc = resolveCellOrWorldDesc;
    this.persistence = persistence;
    this.loot = loot;
  }

  resolveRecord(stableIdentity) {
    const canonical = parseStableRecordIdentity(stableIdentity);
    if (!canonical) return { status: 'UNRESOLVED', reason: 'invalid canonical identity' };
    if (typeof this.resolveCanonicalRecord !== 'function') return { status: 'UNRESOLVED', reason: 'host canonical resolver is not bound', canonical };
    return this.resolveCanonicalRecord(canonical);
  }

  prepareSpawnLocation(spawnRef) {
    return prepareSkyMpSpawnLocation(spawnRef, this.resolveCellOrWorldDesc);
  }

  /** Call host spawn only with a validated original ACHR location, never player coordinates. */
  spawnAtPlacedReference({ spawnRef, ...context } = {}) {
    const prepared = this.prepareSpawnLocation(spawnRef);
    if (prepared.status !== 'RESOLVED') return prepared;
    if (typeof this.onServerSpawn !== 'function') return { status: 'FAILED', reason: 'HOST_SPAWN_UNBOUND' };
    return this.onServerSpawn({ ...context, spawnRef, location: prepared.location });
  }

  beginDungeonGeneration(context) {
    if (!context?.dungeonId || !Number.isInteger(context.generation) || context.generation < 0) throw new Error('dungeonId and non-negative generation are required');
    const hostResult = typeof this.onDungeonGeneration === 'function' ? this.onDungeonGeneration(context) : null;
    const lootResult = this.loot && typeof this.loot.onDungeonGeneration === 'function' ? this.loot.onDungeonGeneration(context) : null;
    return { hostResult, lootResult };
  }

  resetDungeon(context) {
    if (!context?.dungeonId || !Number.isInteger(context.generation) || context.generation < 0) throw new Error('dungeonId and non-negative generation are required');
    const hostResult = typeof this.onDungeonReset === 'function' ? this.onDungeonReset(context) : null;
    const lootResult = this.loot && typeof this.loot.onDungeonReset === 'function' ? this.loot.onDungeonReset(context) : null;
    return { hostResult, lootResult };
  }

  get readiness() {
    return {
      deathHook: typeof this.onServerDeath === 'function' ? 'BOUND_BY_HOST' : 'UNRESOLVED',
      spawnHook: typeof this.onServerSpawn === 'function' ? 'BOUND_BY_HOST' : 'UNRESOLVED',
      spawnLocationResolver: typeof this.resolveCellOrWorldDesc === 'function' ? 'BOUND_BY_HOST' : 'UNRESOLVED',
      dungeonGenerationHook: typeof this.onDungeonGeneration === 'function' ? 'BOUND_BY_HOST' : 'UNRESOLVED',
      dungeonResetHook: typeof this.onDungeonReset === 'function' ? 'BOUND_BY_HOST' : 'UNRESOLVED',
      canonicalRecordResolver: typeof this.resolveCanonicalRecord === 'function' ? 'BOUND_BY_HOST' : 'UNRESOLVED',
      persistence: this.persistence ? 'BOUND_BY_HOST' : 'UNRESOLVED',
      loot: this.loot ? 'BOUND_BY_HOST' : 'OPTIONAL_FUTURE_SYSTEM'
    };
  }
}
