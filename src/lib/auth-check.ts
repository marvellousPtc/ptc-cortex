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

/**
 * 判断请求是否携带了合法的开发者 token。
 *
 * 约定：
 *   - 环境变量 `NEXT_PUBLIC_DEVELOPER_TOKEN` 是服务端期望值（同时也会被 Next.js
 *     注入到浏览器 bundle，客户端据此在请求头中带上 x-developer-token）；
 *   - 请求头 `x-developer-token` 或 cookie `developer-token` 携带实际值；
 *   - 只有两者完全一致（且 env 不为空）时才判定为开发者。
 *
 * 与管理员身份一样，开发者可以绕过每日对话次数限制。
 *
 * 该 token 会随请求明文发给浏览器，故不具备"对客户端保密"的能力；
 * 它只是一个长随机字符串充当弱鉴权，用途等价于"本机开发调试绕过限额"。
 */
export function isDeveloperRequest(request: NextRequest): boolean {
  const expected = process.env.NEXT_PUBLIC_DEVELOPER_TOKEN;
  if (!expected) return false;

  const provided =
    request.headers.get("x-developer-token") ||
    request.cookies.get("developer-token")?.value ||
    "";

  if (!provided) return false;
  return provided === expected;
}
