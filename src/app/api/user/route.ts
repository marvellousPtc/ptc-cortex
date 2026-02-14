/**
 * 用户信息 API
 * 从 session token 查出当前登录用户的 name 和 image（头像）
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/pg";

export async function GET(request: NextRequest) {
  try {
    const token =
      request.cookies.get("__Secure-authjs.session-token")?.value ||
      request.cookies.get("authjs.session-token")?.value;

    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT u.name, u.image
       FROM sessions s JOIN users u ON s.user_id = u.id
       WHERE s.session_token = $1 AND s.expires > NOW()
       LIMIT 1`,
      [token]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "会话无效" }, { status: 401 });
    }

    return NextResponse.json({
      name: rows[0].name || "用户",
      image: rows[0].image || null,
    });
  } catch (error) {
    console.error("User API error:", error);
    return NextResponse.json({ error: "获取用户信息失败" }, { status: 500 });
  }
}
