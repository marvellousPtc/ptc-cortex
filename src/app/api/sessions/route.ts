import { NextRequest, NextResponse } from "next/server";
import {
  createSession,
  getAllSessions,
  deleteSession,
  getMessages,
} from "@/lib/db";

/**
 * 会话管理 API
 *
 * GET    /api/sessions              → 获取所有会话列表
 * GET    /api/sessions?id=xxx       → 获取某个会话的消息
 * POST   /api/sessions              → 创建新会话
 * DELETE /api/sessions?id=xxx       → 删除会话
 */

// 获取会话列表 / 单个会话的消息
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (id) {
    // 获取某个会话的所有消息
    const messages = getMessages(id);
    return NextResponse.json({ messages });
  }

  // 获取所有会话
  const sessions = getAllSessions();
  return NextResponse.json({ sessions });
}

// 创建新会话
export async function POST(request: NextRequest) {
  const { persona = "assistant" } = await request.json();
  const session = createSession(persona);
  return NextResponse.json({ session });
}

// 删除会话
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "缺少会话 id" }, { status: 400 });
  }

  deleteSession(id);
  return NextResponse.json({ success: true });
}
