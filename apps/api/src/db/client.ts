import pg from 'pg';

const { Pool } = pg;

// ─── Pool singleton ───────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                  // max connections in pool
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Parse numeric types as JS numbers instead of strings
  // (pg returns NUMERIC as string by default)
});

// Parse NUMERIC columns as floats
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (val) => parseFloat(val));
// Parse INT8 (bigint) as JS number — safe up to 2^53
pg.types.setTypeParser(pg.types.builtins.INT8, (val) => parseInt(val, 10));

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err);
});

// ─── Types ────────────────────────────────────────────────────────────────────

type QueryValue = string | number | boolean | null | Date | string[] | Buffer;

interface QueryResult<T extends pg.QueryResultRow = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

// ─── Core query helper ────────────────────────────────────────────────────────

async function query<T extends pg.QueryResultRow = Record<string, unknown>>(
  sql: string,
  params: QueryValue[] = []
): Promise<QueryResult<T>> {
  const start = Date.now();

  try {
    const result = await pool.query<T>(sql, params);
    const duration = Date.now() - start;

    if (duration > 1000) {
      console.warn(`[db] Slow query (${duration}ms):`, sql.slice(0, 120));
    }

    return {
      rows: result.rows,
      rowCount: result.rowCount ?? 0,
    };
  } catch (err) {
    console.error('[db] Query error:', { sql: sql.slice(0, 120), params, err });
    throw err;
  }
}

// ─── Single row helpers ───────────────────────────────────────────────────────

async function queryOne<T extends pg.QueryResultRow = Record<string, unknown>>(
  sql: string,
  params: QueryValue[] = []
): Promise<T | null> {
  const result = await query<T>(sql, params);
  return result.rows[0] ?? null;
}

async function queryOneOrThrow<T extends pg.QueryResultRow = Record<string, unknown>>(
  sql: string,
  params: QueryValue[] = [],
  errorMessage = 'Record not found'
): Promise<T> {
  const row = await queryOne<T>(sql, params);
  if (!row) throw new Error(errorMessage);
  return row;
}

// ─── Transaction support ──────────────────────────────────────────────────────

interface TransactionClient {
  query: typeof query;
  queryOne: typeof queryOne;
  queryOneOrThrow: typeof queryOneOrThrow;
}

async function transaction<T>(
  fn: (client: TransactionClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Wrap the raw pg client in the same interface as our db helpers
    const txClient: TransactionClient = {
      query: async <R extends pg.QueryResultRow = Record<string, unknown>>(
        sql: string,
        params: QueryValue[] = []
      ): Promise<QueryResult<R>> => {
        const result = await client.query<R>(sql, params);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
      },
      queryOne: async <R extends pg.QueryResultRow = Record<string, unknown>>(
        sql: string,
        params: QueryValue[] = []
      ): Promise<R | null> => {
        const result = await client.query<R>(sql, params);
        return result.rows[0] ?? null;
      },
      queryOneOrThrow: async <R extends pg.QueryResultRow = Record<string, unknown>>(
        sql: string,
        params: QueryValue[] = [],
        errorMessage = 'Record not found'
      ): Promise<R> => {
        const result = await client.query<R>(sql, params);
        if (!result.rows[0]) throw new Error(errorMessage);
        return result.rows[0];
      },
    };

    const result = await fn(txClient);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Health check ─────────────────────────────────────────────────────────────

async function healthCheck(): Promise<{
  healthy: boolean;
  latencyMs: number;
  poolSize: number;
  idleConnections: number;
  waitingClients: number;
}> {
  const start = Date.now();

  try {
    await pool.query('SELECT 1');
    return {
      healthy: true,
      latencyMs: Date.now() - start,
      poolSize: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingClients: pool.waitingCount,
    };
  } catch {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      poolSize: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingClients: pool.waitingCount,
    };
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  console.info('[db] Closing connection pool...');
  await pool.end();
  console.info('[db] Pool closed.');
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ─── Exports ──────────────────────────────────────────────────────────────────

export const db = {
  query,
  queryOne,
  queryOneOrThrow,
  transaction,
  healthCheck,
  shutdown,
  /** Expose pool directly for advanced use cases */
  pool,
};
