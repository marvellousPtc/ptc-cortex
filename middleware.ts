/**
 * 认证中间件 — 保护 /chat 页面，仅允许已登录用户访问
 *
 * 检查 NextAuth session cookie（与 ink-and-code 共享同域 cookie）：
 * - cookie 存在 → 放行
 * - cookie 不存在 → 302 重定向到 ink-and-code 的登录页
 *
 * 安全性说明：
 * NextAuth 的 session cookie 是 HttpOnly + Secure + SameSite，
 * 普通用户无法通过 JS 伪造。即使 cookie 过期，
 * 后续的 API 调用也会因 session 无效而返回错误，不会造成安全问题。
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // 读取 NextAuth session cookie
  // 生产环境（HTTPS）使用 __Secure- 前缀，开发环境无前缀
  const sessionToken =
    request.cookies.get("__Secure-authjs.session-token")?.value ||
    request.cookies.get("authjs.session-token")?.value;

  // 没有 session cookie → 重定向到登录页
  if (!sessionToken) {
    const origin = request.nextUrl.origin;
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("callbackUrl", basePath);

    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // 只拦截页面请求，排除 API、静态资源、图片等
  matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico).*)"],
};
