import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations, migrationStatus, poolFromGamemode, readMigrations } from './build/persistence/src/index.js';

const [operation, pgModulePath, schema = 'public'] = process.argv.slice(2);
if (!['apply', 'status'].includes(operation) || !pgModulePath || process.argv.length > 5) {
  console.error('Usage: node migrate.mjs <apply|status> <path-to-gamemode-core/pg.js> [schema]');
  process.exitCode = 1;
} else {
  let pg;
  try {
    pg = createRequire(import.meta.url)(resolve(pgModulePath));
    const migrations = await readMigrations(fileURLToPath(new URL('../../database/migrations/', import.meta.url)));
    const pool = poolFromGamemode(pg);
    const result = operation === 'apply'
      ? await applyMigrations(pool, migrations, schema)
      : await migrationStatus(pool, migrations, schema);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    // Do not dump environment, URL, driver details or nested causes to deployment logs.
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'PERSISTENCE_FAILED';
    console.error(`Migration ${operation} failed: ${code}`);
    process.exitCode = 1;
  } finally {
    if (pg) {
      try { await pg.close(); }
      catch { console.error('Migration pool close failed'); process.exitCode = 1; }
    }
  }
}
