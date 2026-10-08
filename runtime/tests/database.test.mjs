import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { fakeHost, logger } from './host.mjs';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const { createGameplayCore } = require('../../dist/aetherius-gameplay-core.cjs');
const databaseUrl = process.env.AETHERIUS_TEST_DATABASE_URL;
if (!databaseUrl) throw Error('AETHERIUS_TEST_DATABASE_URL is required; no test skipped');
const url = new URL(databaseUrl);
if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.pathname !== '/aetherius_test') throw Error('Requires local aetherius_test');

test('real PostgreSQL: pending migrations do not apply; development opt-in applies; restart verifies hashes', async () => {
  const schema = `gc_b1_${randomBytes(8).toString('hex')}`;
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 2000 });
  const log = logger();
  const host = { mp: fakeHost({ catalogAvailable: true }), pg: { init: () => pool }, log };
  const core = env => createGameplayCore({ ...host, env: { GAMEPLAY_CORE_DATABASE_SCHEMA: schema, ...env } });
  await pool.query(`CREATE SCHEMA "${schema}"`);
  let runtime;
  try {
    runtime = core({ GAMEPLAY_CORE_MODE_STANDING_STONES: 'audit' }); await runtime.initialize();
    let report = runtime.capabilityReport(); assert.equal(runtime.healthCheck(), true);
    assert.equal(report.systems.find(s => s.id === 'standing-stones').status, 'UNSUPPORTED');
    assert(report.database.missing.some(s => s.includes('migrations:apply')));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM pg_tables WHERE schemaname=$1', [schema])).rows[0].n, 0);
    await runtime.shutdown();
    runtime = core({ GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV: 'true' }); await runtime.initialize();
    assert.equal(runtime.capabilityReport().database.status, 'SUPPORTED');
    const { readdir } = await import('node:fs/promises');
    const delivered = (await readdir(new URL('../../database/migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).length;
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${schema}".gc_schema_migrations`)).rows[0].n, delivered);
    await runtime.shutdown();
    runtime = core({}); await runtime.initialize(); assert.equal(runtime.capabilityReport().database.status, 'SUPPORTED'); await runtime.shutdown();
    await pool.query(`UPDATE "${schema}".gc_schema_migrations SET sha256='changed' WHERE version='0002_gc_commands.sql'`);
    runtime = core({}); await runtime.initialize(); assert.equal(runtime.capabilityReport().database.status, 'UNSUPPORTED');
    console.log('B1/B5a: pending schema untouched; three migrations applied with development flag; restart checked; modified hash refused');
  } finally { await runtime?.shutdown(); await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.end(); }
});

test('same spike flag preserves offline rehydration; retired spike timers never project', async t => {
  t.mock.timers.enable({ apis: ['setTimeout','setInterval'] });
  const schema = `gc_b1_spike_${randomBytes(8).toString('hex')}`;
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis:2000, options:`-c search_path=${schema},pg_catalog` });
  const mp = fakeHost({ catalogAvailable:true, offlineMode:true }); const calls=[];
  mp.callPapyrusFunction = (_type,_class,method) => { calls.push(method); return true; };
  const host = { mp, pg:{ init:() => pool }, log:logger(), env:{ ENABLE_STANDING_STONE_SPIKE:'true', GAMEPLAY_CORE_DATABASE_SCHEMA:schema } };
  await pool.query(`CREATE SCHEMA "${schema}"`);
  let first, second;
  try {
    first = createGameplayCore(host); await first.initialize();
    assert.equal(first.identity.lookup({ actorId:91 }).status,'UNSUPPORTED');
    assert.equal(first.capabilityReport().spike.running,true);
    await pool.query('INSERT INTO spike_standing_stone_choices (character_key,stone_key) VALUES ($1,$2)', ['profile:108549','skyrim.esm|0D232D']);
    await first.shutdown(); t.mock.timers.tick(4000); await pool.query('SELECT 1');
    assert.equal(calls.length,0,'no retired spawn timer projects after shutdown');
    second = createGameplayCore(host); await second.initialize();
    assert.equal(second.identity.lookup({ actorId:91 }).status,'UNSUPPORTED');
    calls.length=0; t.mock.timers.tick(3000);
    for (let attempt=0; attempt<100 && calls.length<2; attempt++) await pool.query('SELECT 1');
    assert.deepEqual(calls,['RemoveSpell','AddSpell'],'legacy offline profile still rehydrates under its existing flag');
    const before = calls.length; await second.shutdown(); t.mock.timers.tick(4000); await pool.query('SELECT 1'); assert.equal(calls.length,before);
    console.log('Spike offline rehydration preserved; first-instance spawn/poll timers cancelled; production identity remains unsupported');
  } finally { await first?.shutdown(); await second?.shutdown(); await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.end(); }
});
