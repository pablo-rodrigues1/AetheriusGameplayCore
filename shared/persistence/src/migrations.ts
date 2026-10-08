import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sha256 } from './canonical.js';
import { validateMigrationSql } from './sql-policy.js';
import { lockKey, PersistenceError, withTransaction } from './transaction.js';
import type { PoolPort, QueryExecutor } from './transaction.js';

export interface Migration { readonly version: string; readonly sql: string }
export interface MigrationStatus { readonly version: string; readonly sha256: string; readonly applied_at: Date }
const BOOTSTRAP = '0001_gc_schema_migrations.sql';
const CONTROL_SQL = 'CREATE TABLE gc_schema_migrations (version text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)';

function schemaName(schema: string): void {
  if (!/^[a-z_][a-z_0-9]{0,62}$/.test(schema) || schema.startsWith('pg_')) throw new TypeError('Persistence: invalid target schema');
}

function prepare(migrations: readonly Migration[]) {
  const versions = new Set<string>();
  const numbers = new Set<string>();
  const prepared = migrations.map(m => {
    const match = /^([0-9]{4,})_gc_[a-z_0-9]+\.sql$/.exec(m.version);
    if (!match || versions.has(m.version) || numbers.has(BigInt(match[1]!).toString())) {
      throw new PersistenceError('MIGRATION_ORDER_INVALID', 'Persistence: migrations need unique numbered gc_ filenames');
    }
    versions.add(m.version); numbers.add(BigInt(match[1]!).toString());
    return { ...m, hash: sha256(m.sql), statements: validateMigrationSql(m.sql), number: BigInt(match[1]!) };
  }).sort((a, b) => a.number < b.number ? -1 : 1);
  if (prepared[0]?.version !== BOOTSTRAP || prepared[0].statements.join(' ') !== validateMigrationSql(CONTROL_SQL).join(' ')) {
    throw new PersistenceError('MIGRATION_BOOTSTRAP_INVALID', 'Persistence: first migration must create the fixed gc_schema_migrations ledger');
  }
  // The ledger is exclusively maintained by this runner.
  for (const migration of prepared.slice(1)) {
    if (migration.statements.some(s => /\bgc_schema_migrations\b/.test(s))) {
      throw new PersistenceError('MIGRATION_SQL_REJECTED', 'Persistence: migrations cannot alter the migration ledger');
    }
  }
  return prepared;
}

export async function readMigrations(directory: string): Promise<readonly Migration[]> {
  const names = await readdir(directory);
  return Promise.all(names.filter(n => n.endsWith('.sql')).map(async version => Object.freeze({
    version, sql: await readFile(resolve(directory, version), 'utf8')
  })));
}

async function targetSchema(tx: QueryExecutor, schema: string): Promise<void> {
  await tx.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
  const actual = await tx.query<{ schema: string }>('SELECT current_schema() AS schema');
  if (actual.rows[0]?.schema !== schema) throw new PersistenceError('SCHEMA_MISSING', 'Persistence: target schema must already exist');
}

/** Validates the full batch first, then applies it atomically under a per-schema lock. */
export async function applyMigrations(pool: PoolPort, migrations: readonly Migration[], schema = 'public') {
  schemaName(schema);
  const prepared = prepare(migrations);
  return withTransaction(pool, async tx => {
    await targetSchema(tx, schema);
    await lockKey(tx, 'migrations', schema);
    const exists = await tx.query<{ relation: string | null }>('SELECT to_regclass($1) AS relation', [`${schema}.gc_schema_migrations`]);
    if (!exists.rows[0]?.relation) await tx.query(prepared[0]!.statements[0]!);
    const prior = await tx.query<MigrationStatus>('SELECT version, sha256, applied_at FROM gc_schema_migrations ORDER BY version');
    const byVersion = new Map(prior.rows.map(m => [m.version, m]));
    for (const row of prior.rows) {
      const migration = prepared.find(m => m.version === row.version);
      if (!migration || migration.hash !== row.sha256) throw new PersistenceError('MIGRATION_HASH_MISMATCH',
        `Persistence: applied migration missing or changed: ${row.version}`);
    }
    let pendingSeen = false;
    for (const m of prepared) {
      if (!byVersion.has(m.version)) pendingSeen = true;
      else if (pendingSeen) throw new PersistenceError('MIGRATION_ORDER_INVALID', 'Persistence: cannot insert a migration before applied versions');
    }
    const applied: string[] = [];
    for (const m of prepared) {
      if (byVersion.has(m.version)) continue;
      if (m.version !== BOOTSTRAP) for (const sql of m.statements) await tx.query(sql);
      await tx.query('INSERT INTO gc_schema_migrations (version, sha256) VALUES ($1, $2)', [m.version, m.hash]);
      applied.push(m.version);
    }
    return Object.freeze({ applied: Object.freeze(applied), unchanged: prior.rows.length });
  });
}

/** Compares files and ledger as well as returning the installed hashes. Does not apply. */
export async function migrationStatus(pool: PoolPort, migrations: readonly Migration[], schema = 'public') {
  schemaName(schema);
  const prepared = prepare(migrations);
  return withTransaction(pool, async tx => {
    await targetSchema(tx, schema);
    const rows = (await tx.query<MigrationStatus>('SELECT version, sha256, applied_at FROM gc_schema_migrations ORDER BY version')).rows;
    if (rows.length !== prepared.length || rows.some(row => prepared.find(m => m.version === row.version)?.hash !== row.sha256)) {
      throw new PersistenceError('MIGRATIONS_NOT_CURRENT', 'Persistence: migration ledger differs from the delivered files');
    }
    return Object.freeze(rows.map(row => Object.freeze(row)));
  });
}
