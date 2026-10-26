import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSkyMpSpawnLocation, validatePlacedSpawnLocation } from '../src/spawning/location.mjs';
import { SkyMpIntegrationAdapter } from '../src/adapters/skymp-adapter.mjs';
import { buildReadinessReport } from '../src/readiness.mjs';

const placed = () => ({
  type: 'ACHR',
  identity: 'Skyrim.esm|001234',
  cellIdentity: 'Skyrim.esm|000042',
  locationIdentity: 'Skyrim.esm|000123',
  position: { x: 125, y: -83.5, z: 0 },
  rotation: { x: 0, y: 0, z: 1.25 }
});
const resolver = () => '00003C:Skyrim.esm';

test('converts ACHR source vectors into host arrays without mutating the original', () => {
  const source = placed();
  const result = prepareSkyMpSpawnLocation(source, resolver);
  assert.deepEqual(result, {
    status: 'RESOLVED',
    location: { cellOrWorldDesc: '00003C:Skyrim.esm', pos: [125, -83.5, 0], rot: [0, 0, 1.25] }
  });
  assert.deepEqual(source.position, { x: 125, y: -83.5, z: 0 });
  assert.deepEqual(source.rotation, { x: 0, y: 0, z: 1.25 });
});

test('rejects a missing or malformed spatial source before asking the host', () => {
  for (const replacement of [null, { x: 0, y: 0 }, { x: Infinity, y: 2, z: 3 }, [0, 0, 0], { x: '0', y: 0, z: 0 }]) {
    const source = { ...placed(), position: replacement };
    let called = false;
    const result = prepareSkyMpSpawnLocation(source, () => { called = true; return 'x'; });
    assert.equal(result.status, 'FAILED');
    assert.ok(result.issues.includes('SPAWN_POSITION_INVALID'));
    assert.equal(called, false);
  }
  assert.ok(validatePlacedSpawnLocation({ ...placed(), rotation: null }).includes('SPAWN_ROTATION_INVALID'));
  assert.ok(validatePlacedSpawnLocation({ ...placed(), cellIdentity: 'not-a-cell' }).includes('SPAWN_CELL_UNRESOLVED'));
  assert.ok(validatePlacedSpawnLocation({ ...placed(), type: 'REFR' }).includes('SPAWN_REFERENCE_NOT_ACHR'));
});

test('fails closed when the host cannot resolve the authoritative cell/worldspace', () => {
  assert.equal(prepareSkyMpSpawnLocation(placed()).reason, 'SPAWN_CELL_RESOLVER_UNBOUND');
  assert.equal(prepareSkyMpSpawnLocation(placed(), () => null).reason, 'SPAWN_CELL_OR_WORLD_UNRESOLVED');
  assert.equal(prepareSkyMpSpawnLocation(placed(), () => { throw Error('host issue'); }).reason, 'SPAWN_CELL_RESOLUTION_FAILED');
  assert.equal(prepareSkyMpSpawnLocation(placed(), async () => 'wrong').reason, 'SPAWN_CELL_OR_WORLD_UNRESOLVED');
});

test('adapter supplies validated authoring coordinates to the host only when bound', () => {
  const calls = [];
  const adapter = new SkyMpIntegrationAdapter({
    resolveCellOrWorldDesc: ({ cellIdentity }) => {
      assert.equal(cellIdentity, placed().cellIdentity);
      return resolver();
    },
    onServerSpawn: (request) => { calls.push(request); return { actorId: 123 }; }
  });
  assert.equal(adapter.spawnAtPlacedReference({ spawnRef: placed(), enemyBaseId: 42 }).actorId, 123);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].location.pos, [125, -83.5, 0]);
  assert.equal(calls[0].enemyBaseId, 42);
  assert.equal(adapter.readiness.spawnLocationResolver, 'BOUND_BY_HOST');
  assert.equal(adapter.spawnAtPlacedReference({ spawnRef: { ...placed(), position: null } }).status, 'FAILED');
  assert.equal(calls.length, 1);
  const missingSpawnHook = new SkyMpIntegrationAdapter({ resolveCellOrWorldDesc: resolver });
  assert.equal(missingSpawnHook.spawnAtPlacedReference({ spawnRef: placed() }).reason, 'HOST_SPAWN_UNBOUND');
});

test('dungeon readiness lists and blocks invalid placed locations', () => {
  const report = buildReadinessReport({
    sourceLockOk: true,
    loadOrderValidation: { ok: true, issues: [] },
    dungeons: [{
      dungeonId: 'test', classification: 'EASY', progressionContext: { valid: true },
      spawnRefs: [placed(), { ...placed(), identity: 'Skyrim.esm|001235', position: null }]
    }],
    integration: { inGameValidated: true }
  });
  assert.equal(report.readyForProduction, false);
  const issue = report.errors.find((entry) => entry.code === 'DUNGEON_SPAWN_LOCATION_INVALID');
  assert.equal(issue.count, 1);
  assert.equal(issue.examples[0].spawnStableIdentity, 'Skyrim.esm|001235');
});
