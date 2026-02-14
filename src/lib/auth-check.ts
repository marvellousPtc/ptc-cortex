/**
 * 验证 NextAuth session token 是否有效
 *
 * 查询 ink-and-code 共享的 PostgreSQL sessions 表，
 * 判断 session_token 是否存在且未过期。
 * 在 Server Component（layout）中调用，运行在 Node.js 环境，可正常使用 pg。
 */

import { getPool } from "./pg";

export async function verifySession(sessionToken: string): Promise<boolean> {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT expires FROM sessions WHERE session_token = $1 LIMIT 1`,
      [sessionToken]
    );

    if (rows.length === 0) {
      return false;
    }

    const expires = new Date(rows[0].expires);
    return expires > new Date();
  } catch (error) {
    // 数据库连接失败时放行，避免因 DB 临时问题导致全站不可用
    console.error("Session verify error:", error);
    return true;
  }
}
