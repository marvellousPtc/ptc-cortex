/*
 * :file description: 
 * :name: /langchain-chat/src/app/api/mcp-servers/route.ts
 * :author: PTC
 * :copyright: (c) 2026, Tungee
 * :date created: 2026-02-14 16:13:06
 * :last editor: PTC
 * :date last edited: 2026-02-14 16:53:17
 */
/**
 * MCP Servers 管理 API
 * GET    - 获取当前用户的 MCP server 列表
 * POST   - 添加新的 MCP server
 * DELETE  - 删除指定 MCP server
 * PATCH  - 启用/禁用 MCP server
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth-check";
import {
  getMcpServers,
  addMcpServer,
  deleteMcpServer,
  toggleMcpServer,
} from "@/lib/mcp-db";

export async function GET(request: NextRequest) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const servers = await getMcpServers(userId);
    return NextResponse.json({ servers });
  } catch (error) {
    console.error("获取 MCP servers 失败:", error);
    return NextResponse.json(
      { error: "获取 MCP servers 失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, transport, command, args, url, headers, env } = body;

    if (!name || !transport) {
      return NextResponse.json(
        { error: "缺少必要参数: name, transport" },
        { status: 400 }
      );
    }

    if (transport === "stdio" && !command) {
      return NextResponse.json(
        { error: "stdio 传输类型需要提供 command" },
        { status: 400 }
      );
    }

    if (transport === "http" && !url) {
      return NextResponse.json(
        { error: "http 传输类型需要提供 url" },
        { status: 400 }
      );
    }

    const server = await addMcpServer({
      userId,
      name,
      transport,
      command,
      args,
      url,
      headers,
      env,
    });

    return NextResponse.json({ server });
  } catch (error) {
    console.error("添加 MCP server 失败:", error);
    return NextResponse.json(
      { error: "添加 MCP server 失败" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "缺少 id 参数" }, { status: 400 });
    }

    const deleted = await deleteMcpServer(id, userId);
    if (!deleted) {
      return NextResponse.json(
        { error: "MCP server 不存在或无权限" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("删除 MCP server 失败:", error);
    return NextResponse.json(
      { error: "删除 MCP server 失败" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, enabled } = body;

    if (!id || typeof enabled !== "boolean") {
      return NextResponse.json(
        { error: "缺少参数: id, enabled" },
        { status: 400 }
      );
    }

    const updated = await toggleMcpServer(id, userId, enabled);
    if (!updated) {
      return NextResponse.json(
        { error: "MCP server 不存在或无权限" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("更新 MCP server 失败:", error);
    return NextResponse.json(
      { error: "更新 MCP server 失败" },
      { status: 500 }
    );
  }
}
