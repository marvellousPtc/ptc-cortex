/**
 * 认证中间件 — 保护 /chat 页面，仅允许已登录用户访问
 *
 * 流程：
 * 1. 读取 NextAuth session cookie（与 ink-and-code 共享同域 cookie）
 * 2. 调用内部 /api/auth/verify 验证 session 是否有效
 * 3. 无效则 302 重定向到 ink-and-code 的登录页
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // 读取 NextAuth session cookie
  // 生产环境（HTTPS）使用 __Secure- 前缀，开发环境无前缀
  const sessionToken =
    request.cookies.get("__Secure-authjs.session-token")?.value ||
    request.cookies.get("authjs.session-token")?.value;

  const origin = request.nextUrl.origin;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

  // 构建登录页 URL（ink-and-code 的 /login，不在 basePath 下）
  const loginUrl = new URL("/login", origin);
  loginUrl.searchParams.set("callbackUrl", basePath || "/chat");

  // 没有 session cookie → 直接重定向
  if (!sessionToken) {
    return NextResponse.redirect(loginUrl);
  }

  // 调用内部 API 验证 session 是否有效
  try {
    const verifyUrl = `${origin}${basePath}/api/auth/verify`;
    const res = await fetch(verifyUrl, {
      headers: { "x-session-token": sessionToken },
    });

    const data = await res.json();

    if (!data.valid) {
      return NextResponse.redirect(loginUrl);
    }
  } catch (error) {
    // 验证请求失败时放行（避免因内部错误导致全站不可用）
    console.error("Auth middleware verify failed:", error);
  }

  return NextResponse.next();
}

export const config = {
  // 只拦截页面请求，排除 API、静态资源、图片等
  matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico).*)"],
};
