import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const hostRequire = createRequire(new URL('../../../../aetherius-server/build/dist/server/gamemode/core/pg.js', import.meta.url));
const { Pool } = hostRequire('pg');
const databaseUrl = process.env.AETHERIUS_TEST_DATABASE_URL;
if (!databaseUrl) throw Error('AETHERIUS_TEST_DATABASE_URL is required; no integration tests skipped');
const url = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/aetherius_test') {
  throw Error('Integration requires the local aetherius_test database');
}
const schema = `gc_b3_${process.pid}_${randomBytes(5).toString('hex')}`;
// Exactly one Pool, constructed here in the gamemode's role.
const pool = new Pool({ connectionString: databaseUrl, max: 6, connectionTimeoutMillis: 2000,
  options: `-c search_path=${schema},pg_catalog` });
pool.on('error', () => {});
const originalLoad = Module._load;
Module._load = function(specifier, ...args) {
  if (specifier === 'pg' || /(?:^|[/\\])pg(?:[/\\]|$)/.test(specifier)) {
    throw Error('Persistence attempted to load pg or construct another Pool');
  }
  return originalLoad.call(this, specifier, ...args);
};
const { executeCommand, withTransaction, poolFromGamemode, applyMigrations, readMigrations,
  migrationStatus, lockCharacter } = await import('../build/persistence/src/index.js');
let migrations;
let schemaCreated = false;

const deferred = () => {
  let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve };
};
const command = (id, profile = 7, payload = { value: 1 }) => ({
  requestId: id, characterKey: `profile:${profile}`, epoch: 'session-one', type: 'test.set', payload
});
const effect = async (tx, intent) => {
  await tx.query('INSERT INTO gc_test_effects (request_id, character_key) VALUES ($1, $2)', [intent.requestId, intent.characterKey]);
  await tx.query(`INSERT INTO gc_test_state (character_key, value) VALUES ($1, $2)
    ON CONFLICT (character_key) DO UPDATE SET value = EXCLUDED.value`, [intent.characterKey, intent.payload.value]);
  return { value: intent.payload.value };
};
async function counts(id) {
  const r = await pool.query(`SELECT
    (SELECT count(*)::integer FROM gc_test_effects WHERE request_id = $1) AS effects,
    (SELECT count(*)::integer FROM gc_commands WHERE request_id = $1) AS commands`, [id]);
  return r.rows[0];
}
function released() {
  assert.equal(pool.waitingCount, 0);
  assert.equal(pool.idleCount, pool.totalCount, 'all borrowed connections returned to pool');
}
function faultPool(position) {
  return { async connect() {
    const real = await pool.connect();
    return {
      async query(sql, params) {
        if (sql === 'COMMIT') {
          if (position === 'after') await real.query(sql, params);
          throw Error(`simulated ${position}-commit acknowledgement failure`);
        }
        return real.query(sql, params);
      },
      release(error) { real.release(error); }
    };
  } };
}

before(async () => {
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, 'aetherius_test');
  await pool.query(`CREATE SCHEMA "${schema}"`); schemaCreated = true;
  migrations = await readMigrations(fileURLToPath(new URL('../../../database/migrations/', import.meta.url)));
});
after(async () => {
  try { if (schemaCreated) await pool.query(`DROP SCHEMA "${schema}" CASCADE`); }
  finally { await pool.end(); Module._load = originalLoad; }
  console.log(`B3 isolated schema removed; single pool closed; schema=${schema}`);
});

test('real PostgreSQL: empty schema, ordered migrations, repeated application and hash verification', async () => {
  assert.deepEqual(await applyMigrations(pool, [...migrations].reverse(), schema), {
    applied: ['0001_gc_schema_migrations.sql', '0002_gc_commands.sql'], unchanged: 0
  });
  const first = await migrationStatus(pool, migrations, schema);
  assert.deepEqual(await applyMigrations(pool, migrations, schema), { applied: [], unchanged: 2 });
  assert.deepEqual(await migrationStatus(pool, migrations, schema), first);
  console.log('migrations=2; repeat applied=0; ledger timestamps and hashes unchanged');
});

test('maintenance CLI applies and verifies real migrations using the same injected gamemode pool', async () => {
  const fixture = new URL('../build/test-fixtures/', import.meta.url);
  await mkdir(fixture, { recursive: true });
  const pgModule = new URL('cli-pg.cjs', fixture);
  await writeFile(pgModule, 'module.exports = globalThis.__b3CliPg;\n');
  let closes = 0;
  // Test caller controls lifecycle; CLI borrows this real pool, never constructs one.
  globalThis.__b3CliPg = { init() { return pool; }, async close() { closes++; } };
  const previousArgs = process.argv;
  const originalLog = console.log;
  const output = [];
  console.log = value => output.push(JSON.parse(value));
  try {
    for (const operation of ['apply', 'status']) {
      process.argv = [process.execPath, fileURLToPath(new URL('../migrate.mjs', import.meta.url)),
        operation, fileURLToPath(pgModule), schema];
      await import(new URL(`../migrate.mjs?integration=${operation}`, import.meta.url));
    }
    assert.deepEqual(output[0], { applied: [], unchanged: 2 });
    assert.equal(output[1].length, 2);
    assert.equal(closes, 2);
    assert.equal(process.exitCode, undefined);
    released();
  } finally {
    console.log = originalLog;
    process.argv = previousArgs;
    delete globalThis.__b3CliPg;
  }
  console.log('CLI apply/status: real database, same single caller-owned pool, 2 hashes verified');
});

test('applied file modified on disk is refused, as is a foreign table migration before any DDL', async () => {
  const fixture = new URL('../build/test-fixtures/', import.meta.url);
  await mkdir(fixture, { recursive: true });
  for (const m of migrations) await writeFile(new URL(m.version, fixture), m.sql);
  const second = new URL('0002_gc_commands.sql', fixture);
  await writeFile(second, `${await readFile(second, 'utf8')}\n-- changed after application\n`);
  await assert.rejects(applyMigrations(pool, await readMigrations(fileURLToPath(fixture)), schema), { code: 'MIGRATION_HASH_MISMATCH' });
  await assert.rejects(applyMigrations(pool, [...migrations, { version: '0003_gc_foreign.sql',
    sql: 'CREATE TABLE other_table (id text)' }], schema), { code: 'MIGRATION_SQL_REJECTED' });
  assert.equal((await migrationStatus(pool, migrations, schema)).length, 2); released();
});

test('bad DDL rolls the entire batch back; new files cannot be inserted before existing history', async () => {
  const bad = { version: '0003_gc_bad.sql', sql: 'CREATE TABLE gc_partial (id text); CREATE TABLE gc_commands (id text)' };
  await assert.rejects(applyMigrations(pool, [...migrations, bad], schema), { code: '42P07' });
  assert.equal((await pool.query("SELECT to_regclass('gc_partial') AS name")).rows[0].name, null);
  const extra = { version: '0004_gc_extra.sql', sql: 'CREATE TABLE gc_extra (id text)' };
  await applyMigrations(pool, [...migrations, extra], schema);
  await assert.rejects(applyMigrations(pool, [...migrations,
    { version: '0003_gc_late.sql', sql: 'CREATE TABLE gc_late (id text)' }, extra], schema), { code: 'MIGRATION_ORDER_INVALID' });
  await assert.rejects(applyMigrations(pool, migrations, schema), { code: 'MIGRATION_HASH_MISMATCH' });
  released();
});

test('concurrent migration runners on the same schema apply a file once', async () => {
  const all = [...migrations, { version: '0004_gc_extra.sql', sql: 'CREATE TABLE gc_extra (id text)' },
    { version: '0005_gc_test_tables.sql', sql: `CREATE TABLE gc_test_state (character_key text PRIMARY KEY, value integer NOT NULL);
      CREATE TABLE gc_test_effects (request_id text PRIMARY KEY, character_key text NOT NULL)` }];
  const results = await Promise.all([applyMigrations(pool, all, schema), applyMigrations(pool, all, schema)]);
  assert.deepEqual(results.map(r => r.applied.length).sort(), [0, 1]);
  released();
});

test('transaction commit is invisible until callback completes and awaited commit acknowledges', async () => {
  const inserted = deferred(); const finish = deferred(); let published = false;
  const pending = withTransaction(pool, async tx => {
    await tx.query("INSERT INTO gc_test_state VALUES ('profile:1', 10)");
    inserted.resolve(); await finish.promise; return 'committed';
  }).then(result => { published = true; return result; });
  await inserted.promise;
  try {
    assert.equal((await pool.query("SELECT * FROM gc_test_state WHERE character_key = 'profile:1'")).rowCount, 0);
    assert.equal(published, false);
  } finally { finish.resolve(); }
  assert.equal(await pending, 'committed');
  assert.equal((await pool.query("SELECT value FROM gc_test_state WHERE character_key = 'profile:1'")).rows[0].value, 10);
  released();
});

test('callback failure rolls back writes, releases connection and transaction-scoped character lock', async () => {
  await assert.rejects(withTransaction(pool, async tx => {
    await lockCharacter(tx, 'profile:2');
    await tx.query("INSERT INTO gc_test_state VALUES ('profile:2', 20)");
    throw Error('domain failure');
  }), /domain failure/);
  assert.equal((await pool.query("SELECT * FROM gc_test_state WHERE character_key = 'profile:2'")).rowCount, 0);
  await withTransaction(pool, async tx => { await lockCharacter(tx, 'profile:2'); }); released();
});

test('a swallowed SQL failure cannot return accepted after PostgreSQL rolls back COMMIT', async () => {
  await assert.rejects(executeCommand(pool, command('aborted'), async tx => {
    try { await tx.query('SELECT * FROM gc_missing_table'); } catch { /* bad domain handler */ }
    return 'wrong success';
  }));
  assert.deepEqual(await counts('aborted'), { effects: 0, commands: 0 }); released();
  await assert.rejects(withTransaction(pool, async tx => {
    try { await tx.query('SELECT * FROM gc_missing_table'); } catch { /* bad handler */ }
    return 'wrong success';
  }), { code: 'TRANSACTION_ABORTED' }); released();
});

test('before-commit failure leaves no effect/ledger, and retry executes once', async () => {
  let runs = 0;
  const run = async (tx, intent) => { runs++; return effect(tx, intent); };
  await assert.rejects(executeCommand(faultPool('before'), command('before'), run), { code: 'COMMIT_UNCONFIRMED' });
  assert.deepEqual(await counts('before'), { effects: 0, commands: 0 }); released();
  assert.equal((await executeCommand(pool, command('before'), run)).replayed, false);
  assert.equal(runs, 2); assert.deepEqual(await counts('before'), { effects: 1, commands: 1 }); released();
});

test('after-commit acknowledgement failure persists effect/ledger; retry returns saved result', async () => {
  let runs = 0;
  const run = async (tx, intent) => { runs++; return effect(tx, intent); };
  await assert.rejects(executeCommand(faultPool('after'), command('after'), run), { code: 'COMMIT_UNCONFIRMED' });
  assert.deepEqual(await counts('after'), { effects: 1, commands: 1 });
  const replay = await executeCommand(pool, command('after'), run);
  assert.deepEqual(replay, { status: 'accepted', requestId: 'after', replayed: true, result: { value: 1 } });
  assert.equal(runs, 1); released();
});

test('same requestId and canonical content is one effect/row, including retry with new epoch', async () => {
  const first = command('repeat', 3, { value: 12, nested: { a: 1, b: 2 } });
  const second = { ...first, epoch: 'reconnected', payload: { nested: { b: 2, a: 1 }, value: 12 } };
  const result = await executeCommand(pool, first, effect);
  const replay = await executeCommand(pool, second, () => { throw Error('must not execute'); });
  assert.deepEqual(result.result, replay.result); assert.equal(replay.replayed, true);
  assert.deepEqual(await counts('repeat'), { effects: 1, commands: 1 }); released();
});

test('changed payload/type/character/expected revision conflicts without running', async () => {
  const original = command('conflict', 4);
  await executeCommand(pool, original, effect);
  const different = [command('conflict', 4, { value: 2 }), command('conflict', 5),
    { ...original, type: 'different' },
    { ...original, expectedRevision: { facts: 1, grants: 0, equipment: 0, effects: 0, catalog: 0 } }];
  for (const intent of different) assert.deepEqual(await executeCommand(pool, intent, () => { throw Error('must not run'); }), {
    status: 'conflict', requestId: 'conflict', reason: 'REQUEST_ID_REUSED'
  });
  assert.deepEqual(await counts('conflict'), { effects: 1, commands: 1 }); released();
});

test('concurrent same requestId is deduplicated, including cross-character reuse', async () => {
  let runs = 0;
  const slow = async (tx, intent) => { runs++; await delay(30); return effect(tx, intent); };
  const identical = await Promise.all([executeCommand(pool, command('race-request', 20), slow), executeCommand(pool, command('race-request', 20), slow)]);
  assert.deepEqual(identical.map(r => r.replayed).sort(), [false, true]); assert.equal(runs, 1);
  const different = await Promise.all([executeCommand(pool, command('race-cross', 21), slow), executeCommand(pool, command('race-cross', 22), slow)]);
  assert.deepEqual(different.map(r => r.status).sort(), ['accepted', 'conflict']); assert.equal(runs, 2);
  assert.deepEqual(await counts('race-cross'), { effects: 1, commands: 1 }); released();
});

test('same-character concurrent commands serialize and observe the previous committed state', async () => {
  const started = deferred(); const finish = deferred(); let secondEntered = false;
  const first = executeCommand(pool, command('serial-1', 30, { value: 100 }), async (tx, intent) => {
    await effect(tx, intent); started.resolve(); await finish.promise; return { value: 100 };
  });
  await started.promise;
  const second = executeCommand(pool, command('serial-2', 30, { value: 200 }), async (tx, intent) => {
    secondEntered = true;
    assert.equal((await tx.query('SELECT value FROM gc_test_state WHERE character_key = $1', [intent.characterKey])).rows[0].value, 100);
    return effect(tx, intent);
  });
  try { await delay(100); assert.equal(secondEntered, false); }
  finally { finish.resolve(); }
  await Promise.all([first, second]);
  assert.equal((await pool.query("SELECT value FROM gc_test_state WHERE character_key = 'profile:30'")).rows[0].value, 200);
  console.log('same character: second callback blocked until first commits; final value=200'); released();
});

test('different characters execute in parallel (both callbacks enter before either commits)', { timeout: 4000 }, async () => {
  const started = [deferred(), deferred()]; const finish = deferred();
  const jobs = [40, 41].map((profile, i) => executeCommand(pool, command(`parallel-${profile}`, profile), async (tx, intent) => {
    started[i].resolve(); await finish.promise; return effect(tx, intent);
  }));
  try {
    await Promise.race([Promise.all(started.map(d => d.promise)), delay(2000).then(() => { throw Error('characters blocked each other'); })]);
    assert.equal((await counts('parallel-40')).effects, 0);
    assert.equal((await counts('parallel-41')).effects, 0);
    console.log('different characters: both callbacks entered before commits');
  } finally { finish.resolve(); }
  await Promise.all(jobs); released();
});

test('input snapshot cannot be changed during lock wait; non-JSON result rolls back the effect', async () => {
  const intent = command('snapshot', 50, { value: 55 });
  const pending = executeCommand(pool, intent, effect);
  intent.payload.value = 999;
  assert.equal((await pending).result.value, 55);
  await assert.rejects(executeCommand(pool, command('invalid-result', 51), async (tx, c) => {
    await effect(tx, c); return { value: undefined };
  }), TypeError);
  assert.deepEqual(await counts('invalid-result'), { effects: 0, commands: 0 }); released();
});

test('executor expires, lifecycle commands are rejected, and injected gamemode pool is reused', async () => {
  let saved;
  const baseline = pool.totalCount;
  const pg = { init() { return pool; } };
  assert.equal(poolFromGamemode(pg), pool);
  await withTransaction(poolFromGamemode(pg), async tx => {
    saved = tx;
    await assert.rejects(tx.query('COMMIT'), { code: 'INVALID_QUERY' });
    await assert.rejects(tx.query('/* nested /* comment */ */ -- comment\n COMMIT'), { code: 'INVALID_QUERY' });
    await assert.rejects(tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'), { code: 'INVALID_QUERY' });
    await assert.rejects(tx.query('SELECT 1; COMMIT'), { code: 'INVALID_QUERY' });
    await tx.query('SELECT 1');
  });
  await assert.rejects(saved.query('SELECT 1'), { code: 'TRANSACTION_CLOSED' });
  assert.equal(pool.totalCount, baseline); released();
});

test('refused real connection yields DATABASE_UNAVAILABLE and never accepted; same pool recovers', async () => {
  // Find a closed local TCP port without starting/stopping PostgreSQL or the game server.
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const connections = await Promise.all(Array.from({ length: pool.totalCount }, () => pool.connect()));
  for (const client of connections) client.release(true);
  const priorUrl = pool.options.connectionString;
  const refused = new URL(priorUrl); refused.hostname = '127.0.0.1'; refused.port = String(port);
  pool.options.connectionString = refused.toString();
  try {
    await assert.rejects(executeCommand(pool, command('refused'), effect), error => {
      assert.equal(error.code, 'DATABASE_UNAVAILABLE');
      assert.equal(error.cause.code, 'ECONNREFUSED');
      assert.match(error.message, /database connection failed/);
      console.log('real TCP refusal: DATABASE_UNAVAILABLE / ECONNREFUSED; no accepted receipt');
      return true;
    });
    released();
  } finally { pool.options.connectionString = priorUrl; }
  assert.deepEqual(await counts('refused'), { effects: 0, commands: 0 });
  assert.equal((await executeCommand(pool, command('refused'), effect)).status, 'accepted'); released();
});
