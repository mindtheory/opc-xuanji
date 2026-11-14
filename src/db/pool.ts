/**
 * PostgreSQL 连接池与事务助手。
 *
 * 约束（与 03-技术基线一致）：应用侧不进 PgBouncer 的 transaction 模式陷阱——
 * 需要跨语句 `SET LOCAL` 的查询（HNSW ef_search、分区遍历）必须在 withTx 内执行，
 * 或走直连通道；本文件默认按直连 PG 使用。
 */
import pg from "pg";

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

// `date` 列（OID 1082）保持 YYYY-MM-DD 字符串：pg 默认按本地时区解析成 Date，
// 再经 JSON 序列化变成 `2026-12-01T05:00:00.000Z`，破坏契约与前端日期口径。
// timestamptz（OID 1184）不受影响，仍按 Date → ISO 输出。
pg.types.setTypeParser(1082, (value: string) => value);

export function createPool(dsn: string, overrides: pg.PoolConfig = {}): Pool {
  const pool = new pg.Pool({
    connectionString: dsn,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...overrides,
  });
  // 未捕获的池错误不能让进程崩溃（夜间任务需要知道失败但不静默死亡）
  pool.on("error", (error) => {
    console.error("[opc] pg pool idle error:", error instanceof Error ? error.message : String(error));
  });
  return pool;
}

/** 单事务执行；异常自动回滚。 */
export async function withTx<T>(pool: Pool, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* 回滚失败保持原异常 */
    }
    throw error;
  } finally {
    client.release();
  }
}

/** 取单行；无行返回 null。 */
export async function queryOne<T = Record<string, unknown>>(
  pool: Pool | Client,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const result = await pool.query(sql, params);
  return (result.rows[0] as T | undefined) ?? null;
}

/** 取多行。 */
export async function queryMany<T = Record<string, unknown>>(
  pool: Pool | Client,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

/** 执行并返回受影响行数。 */
export async function execute(pool: Pool | Client, sql: string, params: unknown[] = []): Promise<number> {
  const result = await pool.query(sql, params);
  return result.rowCount ?? 0;
}
