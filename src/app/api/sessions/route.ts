import { NextRequest, NextResponse } from "next/server";
import {
  createSession,
  getAllSessions,
  deleteSession,
  getActiveMessages,
  getSiblings,
  setActiveLeaf,
  getSession,
} from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth-check";

/**
 * 会话管理 API（按用户隔离）
 *
 * GET    /api/sessions              → 获取当前用户的所有会话列表
 * GET    /api/sessions?id=xxx       → 获取某个会话当前活跃链 + 分支版本信息
 * POST   /api/sessions              → 创建新会话
 * PATCH  /api/sessions              → 切换分支（更新 active_leaf_id）
 * DELETE /api/sessions?id=xxx       → 删除会话
 */

// 获取会话列表 / 单个会话的消息
export async function GET(request: NextRequest) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (id) {
    // 鉴权
    const session = await getSession(id, userId);
    if (!session) {
      return NextResponse.json({ error: "会话不存在" }, { status: 404 });
    }

    // 取当前活跃链，并给每条消息附带同 parent 的兄弟列表（用于版本切换器）
    const active = await getActiveMessages(id);
    const messages = await Promise.all(
      active.map(async (m) => {
        const siblings = await getSiblings(m.id);
        const variantIndex = siblings.findIndex((s) => s.id === m.id);
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          parent_id: m.parent_id,
          created_at: m.created_at,
          variantIndex: variantIndex >= 0 ? variantIndex : 0,
          variantTotal: siblings.length || 1,
          siblings: siblings.map((s) => s.id),
        };
      })
    );
    return NextResponse.json({ messages, activeLeafId: session.active_leaf_id });
  }

  // 获取当前用户的所有会话
  const sessions = await getAllSessions(userId);
  return NextResponse.json({ sessions });
}

// 创建新会话
export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { persona = "assistant" } = await request.json();
  const session = await createSession(persona, userId);
  return NextResponse.json({ session });
}

// 切换分支：把 active_leaf_id 指向目标消息（会沿子节点下潜到叶子）
export async function PATCH(request: NextRequest) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const { sessionId, messageId } = await request.json();
  if (!sessionId || typeof messageId !== "number") {
    return NextResponse.json(
      { error: "缺少 sessionId 或 messageId" },
      { status: 400 }
    );
  }
  try {
    await setActiveLeaf(sessionId, messageId, userId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "切换失败" },
      { status: 400 }
    );
  }
}

// 删除会话
export async function DELETE(request: NextRequest) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "缺少会话 id" }, { status: 400 });
  }

  await deleteSession(id, userId);
  return NextResponse.json({ success: true });
}
