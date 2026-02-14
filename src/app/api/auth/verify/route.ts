/**
 * 验证 NextAuth session cookie 是否有效
 *
 * 查询 ink-and-code 共享的 PostgreSQL sessions 表，
 * 判断 session_token 是否存在且未过期。
 * 供 middleware 内部调用，不对外暴露敏感信息。
 */

import { getPool } from "@/lib/pg";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const token = request.headers.get("x-session-token");

  if (!token) {
    return NextResponse.json({ valid: false }, { status: 401 });
  }

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT expires FROM sessions WHERE session_token = $1 LIMIT 1`,
      [token]
    );

    if (rows.length === 0) {
      return NextResponse.json({ valid: false }, { status: 401 });
    }

    const expires = new Date(rows[0].expires);
    if (expires < new Date()) {
      return NextResponse.json({ valid: false }, { status: 401 });
    }

    return NextResponse.json({ valid: true });
  } catch (error) {
    console.error("Session verify error:", error);
    // 数据库连接失败时，默认放行（避免因数据库临时问题导致全站不可访问）
    return NextResponse.json({ valid: true });
  }
}
