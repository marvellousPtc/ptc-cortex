/*
 * :file description: 
 * :name: /langchain-chat/src/lib/auth-check.ts
 * :author: PTC
 * :copyright: (c) 2026, Tungee
 * :date created: 2026-02-14 15:42:53
 * :last editor: PTC
 * :date last edited: 2026-02-14 15:53:05
 */
/**
 * 认证工具函数
 *
 * 查询 ink-and-code 共享的 PostgreSQL sessions 表，
 * 验证 session token 并获取关联的 user_id。
 */

import { getPool } from "./pg";
import { NextRequest } from "next/server";

/**
 * 验证 session token 是否有效（仅返回 boolean）
 * 用于 layout.tsx 的认证守卫
 */
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
    console.error("Session verify error:", error);
    return true;
  }
}

/**
 * 从 session token 查出关联的 user_id
 * token 无效或过期则返回 null
 */
export async function getUserIdFromToken(
  sessionToken: string
): Promise<string | null> {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT user_id, expires FROM sessions WHERE session_token = $1 LIMIT 1`,
      [sessionToken]
    );

    if (rows.length === 0) return null;
    if (new Date(rows[0].expires) < new Date()) return null;

    return rows[0].user_id;
  } catch (error) {
    console.error("getUserIdFromToken error:", error);
    return null;
  }
}

/**
 * 从 API 请求的 cookie 中获取当前登录用户的 ID
 * 供 API route handler 直接调用
 */
export async function getCurrentUserId(
  request: NextRequest
): Promise<string | null> {
  const token =
    request.cookies.get("__Secure-authjs.session-token")?.value ||
    request.cookies.get("authjs.session-token")?.value;

  if (!token) return null;
  return getUserIdFromToken(token);
}
