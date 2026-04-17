import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth-check";

/**
 * 把 AI 生成 + 用户确认过的 Markdown 文章推送到 Ink & Code 博客系统。
 *
 * 鉴权策略：
 *   1) 优先转发浏览器带过来的 cookie —— cortex 和 ink-and-code 共享同一个域/session，
 *      所以 ink-and-code 那边的接口能直接识别出当前用户。
 *   2) 如果配置了 INK_AND_CODE_TOKEN，则额外带上 Bearer（兼容 create-from-commit
 *      这种 token-only 接口，或本地未登录调试场景）。
 */
export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const baseUrl = process.env.INK_AND_CODE_URL;
  if (!baseUrl) {
    return NextResponse.json(
      { error: "服务端未配置 INK_AND_CODE_URL" },
      { status: 500 }
    );
  }
  const token = process.env.INK_AND_CODE_TOKEN;

  let body: {
    title?: string;
    content?: string;
    tags?: string[];
    published?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体非法" }, { status: 400 });
  }

  const { title, content, tags = [], published = false } = body;
  if (!title || !title.trim()) {
    return NextResponse.json({ error: "缺少标题" }, { status: 400 });
  }
  if (!content || !content.trim()) {
    return NextResponse.json({ error: "缺少正文" }, { status: 400 });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // 转发浏览器 cookie，让 ink-and-code 以当前用户身份落库
  const cookie = request.headers.get("cookie");
  if (cookie) headers.Cookie = cookie;

  // 可选：Bearer token 后备（当接口需要 token 时）
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(`${baseUrl}/api/article/create-from-commit`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: title.trim(),
        content,
        tags: Array.isArray(tags) ? tags : [],
        published,
      }),
    });

    const text = await res.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }

    if (
      !res.ok ||
      (payload.code && payload.code !== 201 && payload.code !== 200)
    ) {
      return NextResponse.json(
        {
          error:
            (payload.message as string) ||
            `发布失败（HTTP ${res.status}）`,
          details: payload,
        },
        { status: 502 }
      );
    }

    const data = (payload.data as Record<string, unknown>) || {};
    const articleUrl = (data.url as string) || "";
    return NextResponse.json({
      success: true,
      url: articleUrl ? `${baseUrl}${articleUrl}` : "",
      title: title.trim(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "调用博客系统失败",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
