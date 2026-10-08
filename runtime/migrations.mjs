import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const [operation, pgPath, schema = 'public'] = process.argv.slice(2);
if (!['apply', 'status'].includes(operation) || !pgPath || process.argv.length > 5) throw Error('Usage: npm run migrations:apply|status -- <absolute-path-to-gamemode-core/pg.js> [schema]');
// Compile only the API into memory; no source package outputs are written.
const result = await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['shared/persistence/src/index.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
let pg;
try {
  pg = createRequire(import.meta.url)(resolve(pgPath));
  const pool = api.poolFromGamemode(pg);
  const migrations = await api.readMigrations(fileURLToPath(new URL('../database/migrations/', import.meta.url)));
  const value = operation === 'apply' ? await api.applyMigrations(pool, migrations, schema) : await api.migrationStatus(pool, migrations, schema);
  console.log(JSON.stringify(value));
} catch (error) {
  const code = /^[A-Z0-9_]+$/.test(error?.code) ? error.code : 'MIGRATION_FAILED';
  console.error(`Migration ${operation} failed: ${code}`); process.exitCode = 1;
} finally { if (pg) await pg.close(); }
