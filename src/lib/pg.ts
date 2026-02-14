import { Pool } from "pg";

/**
 * ========== 共享 PostgreSQL 连接池 ==========
 *
 * 整个应用共用一个连接池，避免重复创建连接。
 * 所有需要访问数据库的模块都从这里获取 pool。
 *
 * 需要设置环境变量 DATABASE_URL，格式：
 *   postgresql://用户名:密码@主机:端口/数据库名
 */

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("未配置 DATABASE_URL 环境变量");
    }
    pool = new Pool({
      connectionString,
      max: 5, // 最多 5 个连接
      connectionTimeoutMillis: 10000, // 连接超时 10 秒
      idleTimeoutMillis: 30000, // 空闲超时 30 秒
    });
  }
  return pool;
}
