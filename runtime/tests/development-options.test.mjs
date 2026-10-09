import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { classHost } from './class-host.mjs';
import { logger } from './host.mjs';
import { developmentEnv } from './development-env.mjs';
const require = createRequire(import.meta.url), { Pool } = require('pg');
const { createGameplayCore } = require('../../dist/aetherius-gameplay-core.cjs');
const url = new URL(process.env.AETHERIUS_TEST_DATABASE_URL ?? 'missing:');
assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname) && url.pathname === '/aetherius_test', 'Only local aetherius_test');
const schema = `gc_b1_fix1_${randomBytes(8).toString('hex')}`;
// Mocked runtime timers must never become the pg-pool idle eviction clock.
const pool = new Pool({ connectionString: process.env.AETHERIUS_TEST_DATABASE_URL, idleTimeoutMillis: 0, options: `-c search_path=${schema},pg_catalog` });
before(async () => {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  const core = createGameplayCore({ mp: classHost({ catalogAvailable: true }), pg: { init: () => pool }, log: logger(),
    env: { ...developmentEnv, GAMEPLAY_CORE_DATABASE_SCHEMA: schema, GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV: 'true' } });
  try { await core.initialize(); assert.equal(core.capabilityReport().database.status, 'SUPPORTED'); } finally { await core.shutdown(); }
});
after(async () => { await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.end(); });
const options = ['GAMEPLAY_CORE_DEV_CLASS_LEVEL', 'GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY', 'GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV', 'ENABLE_STANDING_STONE_SPIKE'];
for (const option of options) for (const nodeEnv of [undefined, 'production', 'staging', 'local'])
  for (const access of [undefined, 'true']) for (const confirmation of [undefined, 'true']) {
    const allowed = nodeEnv === 'local' && access !== 'true' && confirmation === 'true';
    test(`${option}: NODE_ENV=${nodeEnv} access=${access} confirmation=${confirmation} => ${allowed ? 'accept' : 'refuse'}`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout','setInterval'] });
      const migration = option === 'GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV';
      const currentSchema = migration ? `${schema}_${randomBytes(3).toString('hex')}` : schema;
      if (migration) await pool.query(`CREATE SCHEMA "${currentSchema}"`);
      const mp = classHost({ catalogAvailable: true, offlineMode: option === 'GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY' });
      const log = logger(); let probe, poolAcquisitions = 0;
      const core = createGameplayCore({ mp, pg: { init() { poolAcquisitions++; return pool; } }, log, env: {
        NODE_ENV: nodeEnv, GAME_ACCESS_CONTROL: access, GAMEPLAY_CORE_ALLOW_DEV_OPTIONS: confirmation,
        GAMEPLAY_CORE_DATABASE_SCHEMA: currentSchema, GAMEPLAY_CORE_MODE_CLASSES: 'active', GAMEPLAY_CORE_MODE_PROBE: 'active',
        [option]: option === 'GAMEPLAY_CORE_DEV_CLASS_LEVEL' ? '40' : 'true'
      } });
      core.register({ id: 'probe', requiresDatabase: false, start(ctx) { probe = ctx; } });
      try {
        await core.initialize(); assert(core.healthCheck()); assert(probe, 'independent system still starts');
        const errors = log.messages.filter(m => m.includes('ERROR') && m.includes(option));
        assert.equal(errors.length > 0, !allowed);
        if (!allowed) assert(errors.every(m => m.includes('refused') && /NODE_ENV|GAME_ACCESS_CONTROL|ALLOW_DEV_OPTIONS/.test(m)));
        const report = core.capabilityReport(), binding = core.identity.lookup({actorId:91});
        if (option === 'GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY') assert.equal(binding.status, allowed ? 'SUPPORTED' : 'UNSUPPORTED');
        if (option === 'GAMEPLAY_CORE_DEV_CLASS_LEVEL') {
          const c = report.systems.find(s => s.id === 'classes');
          assert.equal(c.started, allowed); assert.equal(c.devClassLevel, allowed ? 40 : null);
          const result = await core.setCharacterClass({ binding: binding.value, classId: 'elementalista', requestId: randomBytes(8).toString('hex') });
          assert.equal(result.status, allowed ? 'SUPPORTED' : 'UNSUPPORTED');
          const composed = await core.inspectActor(binding.value);
          assert.equal(composed.grants.filter(g => g.source.kind === 'CLASS').length, allowed ? 19 : 0);
          assert.equal((await pool.query('SELECT count(*)::int AS n FROM gc_leveling_progress')).rows[0].n, 0);
        }
        if (migration) {
          const tables = (await pool.query('SELECT count(*)::int AS n FROM pg_tables WHERE schemaname=$1', [currentSchema])).rows[0].n;
          assert.equal(tables > 0, allowed); assert.equal(poolAcquisitions, allowed ? 1 : 0);
          assert.equal(report.database.status, allowed ? 'SUPPORTED' : 'UNSUPPORTED');
          assert.equal(report.systems.find(s => s.id === 'classes').started, allowed);
        }
        if (option === 'ENABLE_STANDING_STONE_SPIKE') {
          assert.equal(report.spike.enabled, allowed); assert.equal(report.spike.running, allowed);
          assert.equal(report.spike.reason !== undefined, !allowed);
        }
        assert.equal(mp.mutations().length, 0, 'no host mutation during option validation');
      } finally { await core.shutdown(); if (migration) await pool.query(`DROP SCHEMA "${currentSchema}" CASCADE`); }
    });
  }

test('presence of false/empty flags outside development is also refused; no legacy identity fallback', async () => {
  for (const raw of ['false', '']) {
    const log = logger(), core = createGameplayCore({ mp: classHost({ catalogAvailable: true }), pg: { init: () => pool }, log,
      env: { NODE_ENV: 'production', GAMEPLAY_CORE_DATABASE_SCHEMA: schema, ...Object.fromEntries(options.map(option => [option, raw])) } });
    try {
      await core.initialize();
      for (const option of options) assert(log.messages.some(m => m.includes('ERROR') && m.includes(option)));
      assert.equal(core.identity.lookup({ actorId:91 }).status, 'UNSUPPORTED');
      assert.equal(core.capabilityReport().database.status, 'UNSUPPORTED'); assert.equal(core.capabilityReport().spike.running, false);
    } finally { await core.shutdown(); }
  }
});
