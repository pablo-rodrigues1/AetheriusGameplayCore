export interface QueryResult<Row = Record<string, unknown>> {
  readonly rows: Row[];
  readonly rowCount: number | null;
}
export interface QueryExecutor {
  query<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<Row>>;
}
export interface PoolClient extends QueryExecutor { release(error?: boolean | Error): void }
export interface PoolPort { connect(): Promise<PoolClient> }

/** No pool is constructed or closed here. The caller owns pg.init(). */
export function poolFromGamemode(pg: { init(): PoolPort }): PoolPort { return pg.init(); }

export class PersistenceError extends Error {
  constructor(readonly code: string, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'PersistenceError';
  }
}

function queryHead(sql: string): string {
  let i = 0;
  while (i < sql.length) {
    if (/\s/.test(sql[i]!)) { i++; continue; }
    if (sql.startsWith('--', i)) { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (depth && i < sql.length) {
        if (sql.startsWith('/*', i)) { depth++; i += 2; }
        else if (sql.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) return '';
      continue;
    }
    return sql.slice(i);
  }
  return '';
}

/** Resolves only after COMMIT acknowledges success. A COMMIT error is indeterminate. */
export async function withTransaction<T>(pool: PoolPort, fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try { client = await pool.connect(); }
  catch (cause) { throw new PersistenceError('DATABASE_UNAVAILABLE', 'Persistence: database connection failed', cause); }
  let active = false;
  let discard = false;
  let stage = 'BEGIN';
  const tx: QueryExecutor = Object.freeze({
    query<Row = Record<string, unknown>>(sql: string, params?: unknown[]) {
      if (!active) return Promise.reject(new PersistenceError('TRANSACTION_CLOSED', 'Persistence: executor is outside its transaction'));
      // Lifecycle belongs to this helper, never to a domain callback.
      const head = queryHead(sql);
      if (!head || /^(?:BEGIN|COMMIT|ROLLBACK|END|ABORT|START|PREPARE|SET\s+TRANSACTION)\b/i.test(head) || sql.includes(';')) {
        return Promise.reject(new PersistenceError('INVALID_QUERY', 'Persistence: use one query without transaction control'));
      }
      return client.query<Row>(sql, params);
    }
  });
  try {
    await client.query('BEGIN');
    // Avoid inheriting a caller's REPEATABLE READ snapshot before advisory-lock waits.
    await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    active = true;
    stage = 'CALLBACK';
    const result = await fn(tx);
    active = false;
    stage = 'COMMIT';
    const committed = await client.query('COMMIT');
    // pg reports an aborted transaction's COMMIT as ROLLBACK, without throwing.
    if ((committed as QueryResult & { command?: string }).command === 'ROLLBACK') {
      throw new PersistenceError('TRANSACTION_ABORTED', 'Persistence: transaction was rolled back instead of committed');
    }
    return result;
  } catch (cause) {
    active = false;
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    if (stage === 'COMMIT') {
      discard = true;
      if (cause instanceof PersistenceError) throw cause;
      throw new PersistenceError('COMMIT_UNCONFIRMED', 'Persistence: commit acknowledgement failed; retry the same requestId', cause);
    }
    if (stage === 'BEGIN') {
      discard = true;
      throw new PersistenceError('DATABASE_UNAVAILABLE', 'Persistence: could not begin transaction', cause);
    }
    throw cause;
  } finally { client.release(discard); }
}

/** Transaction-scoped: released by PostgreSQL on commit/rollback/disconnect. */
export async function lockKey(tx: QueryExecutor, namespace: string, key: string): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0) & 9223372036854775807)', [`gc:${namespace}:${key}`]);
}

export function assertCharacterKey(key: string): void {
  if (!/^profile:[1-9][0-9]*$/.test(key) || !Number.isSafeInteger(Number(key.slice(8)))) {
    throw new TypeError('Persistence: expected canonical profile:<profile_id> with a positive safe integer');
  }
}

export async function lockCharacter(tx: QueryExecutor, characterKey: string): Promise<void> {
  assertCharacterKey(characterKey);
  // Exact negative bigint: distinct profile ids cannot hash-collide, and request/
  // migration locks occupy the nonnegative half of the bigint namespace.
  await tx.query('SELECT pg_advisory_xact_lock($1::bigint)', [-Number(characterKey.slice(8))]);
}
