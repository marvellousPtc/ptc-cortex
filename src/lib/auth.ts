/**
 * ========== API 鉴权 ==========
 *
 * 简单的 API Key 校验，用于外部项目接入 /api/v1/* 接口。
 * 从 Authorization: Bearer <key> 头中提取 key，和环境变量比对。
 */

import { NextRequest } from "next/server";

export interface AuthResult {
  ok: boolean;
  error?: string;
}

/**
 * 校验请求的 API Key
 */
export function verifyApiKey(request: NextRequest): AuthResult {
  const secretKey = process.env.API_SECRET_KEY;

  if (!secretKey) {
    console.error("API_SECRET_KEY 未配置");
    return { ok: false, error: "服务端未配置 API Key" };
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return { ok: false, error: "缺少 Authorization 头" };
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (token !== secretKey) {
    return { ok: false, error: "无效的 API Key" };
  }

  return { ok: true };
}
