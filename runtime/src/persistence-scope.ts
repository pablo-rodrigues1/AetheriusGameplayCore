import type { PoolPort } from '../../shared/persistence/src/index.ts';

/** Borrow the host's pool. B3 uses unqualified gc_ names: set search_path only
 * inside its transaction, never on the pooled session. Revalidate at COMMIT. */
export function scopedPool(pool: PoolPort, schema = 'public', check: () => void = () => {}): PoolPort {
  if (!/^[a-z_][a-z_0-9]{0,62}$/.test(schema) || schema.startsWith('pg_')) throw new TypeError('Invalid Core schema');
  return { async connect() {
    check(); const client = await pool.connect();
    try { check(); } catch (error) { client.release(); throw error; }
    return { async query<Row = Record<string, unknown>>(sql: string, params?: unknown[]) {
      if (sql !== 'ROLLBACK') check();
      const result = await client.query<Row>(sql, params);
      if (sql === 'BEGIN') {
        check(); await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
      }
      if (sql !== 'ROLLBACK') check();
      return result;
    }, release: error => client.release(error) };
  } };
}
