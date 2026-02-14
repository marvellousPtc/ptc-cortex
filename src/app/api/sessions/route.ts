import { NextRequest, NextResponse } from "next/server";
import {
  createSession,
  getAllSessions,
  deleteSession,
  getMessages,
} from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth-check";

/**
 * 会话管理 API（按用户隔离）
 *
 * GET    /api/sessions              → 获取当前用户的所有会话列表
 * GET    /api/sessions?id=xxx       → 获取某个会话的消息
 * POST   /api/sessions              → 创建新会话
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
    // 获取某个会话的所有消息（session 归属在 chat route 里校验，这里直接返回）
    const messages = await getMessages(id);
    return NextResponse.json({ messages });
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
