/*
 * :date created: 2026-02-14 16:10:21
 * :file description: 
 * :name: /langchain-chat/src/lib/mcp-client.ts
 * :date last edited: 2026-02-14 22:51:16
 * :last editor: PTC
 * :author: PTC
 * :copyright: (c) 2026, Tungee
 */
/**
 * ========== MCP 客户端集成层 ==========
 *
 * 从数据库加载用户配置的 MCP servers，
 * 用 @langchain/mcp-adapters 连接并获取 LangChain 工具。
 */

import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { getEnabledMcpServers, McpServerConfig } from "./mcp-db";
import { StructuredToolInterface } from "@langchain/core/tools";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

/**
 * 将 base64 图片保存到 public/uploads 并返回可访问的 URL
 */
function saveBase64Image(base64Data: string, mimeType: string = "image/png"): string {
  const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
  const filename = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const dir = join(process.cwd(), "public", "uploads");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, filename);
  writeFileSync(filePath, Buffer.from(base64Data, "base64"));
  return `${BASE}/uploads/${filename}`;
}

/**
 * 将数据库中的 MCP server 配置转换为 MultiServerMCPClient 的格式
 */
function buildMcpServerConfigs(
  servers: McpServerConfig[]
): Record<string, Record<string, unknown>> {
  const configs: Record<string, Record<string, unknown>> = {};

  for (const server of servers) {
    if (server.transport === "stdio" && server.command) {
      let args: string[] = [];
      if (server.args) {
        try {
          args = JSON.parse(server.args);
        } catch {
          console.warn(`MCP server "${server.name}" args 解析失败:`, server.args);
        }
      }
      // 解析自定义环境变量
      let env: Record<string, string> | undefined;
      if (server.env) {
        try {
          env = JSON.parse(server.env);
        } catch {
          console.warn(`MCP server "${server.name}" env 解析失败:`, server.env);
        }
      }
      configs[server.name] = {
        transport: "stdio",
        command: server.command,
        args,
        ...(env ? { env: { ...process.env, ...env } as Record<string, string> } : {}),
        restart: {
          enabled: true,
          maxAttempts: 2,
          delayMs: 1000,
        },
      };
    } else if (server.transport === "http" && server.url) {
      let headers: Record<string, string> | undefined;
      if (server.headers) {
        try {
          headers = JSON.parse(server.headers);
        } catch {
          console.warn(
            `MCP server "${server.name}" headers 解析失败:`,
            server.headers
          );
        }
      }
      configs[server.name] = {
        transport: "sse",
        url: server.url,
        ...(headers ? { headers } : {}),
        reconnect: {
          enabled: true,
          maxAttempts: 2,
          delayMs: 1000,
        },
      };
    }
  }

  return configs;
}

/**
 * 获取用户的 MCP 工具。
 * 返回 { tools, cleanup } —— 调用完后必须调 cleanup() 关闭连接。
 */
export async function getMcpTools(userId: string): Promise<{
  tools: StructuredToolInterface[];
  cleanup: () => Promise<void>;
}> {
  const servers = await getEnabledMcpServers(userId);

  if (servers.length === 0) {
    return { tools: [], cleanup: async () => {} };
  }

  const mcpServerConfigs = buildMcpServerConfigs(servers);

  if (Object.keys(mcpServerConfigs).length === 0) {
    return { tools: [], cleanup: async () => {} };
  }

  try {
    const client = new MultiServerMCPClient({
      throwOnLoadError: false,
      prefixToolNameWithServerName: true,
      onConnectionError: "ignore",
      // 确保所有 MCP 工具的输出都路由到 content（文本），
      // 避免图片等二进制数据以数组格式传给不支持多模态的 LLM
      outputHandling: "content",
      // 将 MCP 工具的复杂返回值转为字符串，图片保存为文件并返回 Markdown 链接
      afterToolCall: (res) => {
        const result = res.result;
        if (typeof result === "string") return { result };
        // 数组类型（含图片、文本等 content block）
        if (Array.isArray(result)) {
          const textParts = result
            .map((block: unknown) => {
              if (typeof block === "string") return block;
              if (block && typeof block === "object") {
                const b = block as Record<string, unknown>;
                // 文本块
                if (b.type === "text" && typeof b.text === "string") return b.text;
                // 图片块 → 保存文件，返回 Markdown 图片
                if (b.type === "image") {
                  try {
                    const data = (b.source as Record<string, unknown>)?.data as string
                      || b.data as string || "";
                    const mime = (b.source as Record<string, unknown>)?.media_type as string
                      || b.mimeType as string || "image/png";
                    if (data) {
                      const url = saveBase64Image(data, mime);
                      return `![截图](${url})`;
                    }
                  } catch {}
                  return "[图片保存失败]";
                }
                // image_url 格式（某些 MCP 返回）
                if (b.type === "image_url" && b.image_url) {
                  try {
                    const imgUrl = b.image_url as Record<string, unknown>;
                    const urlStr = imgUrl.url as string || "";
                    if (urlStr.startsWith("data:")) {
                      const match = urlStr.match(/^data:([^;]+);base64,(.+)$/);
                      if (match) {
                        const savedUrl = saveBase64Image(match[2], match[1]);
                        return `![截图](${savedUrl})`;
                      }
                    }
                    return `![截图](${urlStr})`;
                  } catch {}
                  return "[图片处理失败]";
                }
                if (b.type === "resource") return `[资源: ${b.uri || ""}]`;
              }
              return JSON.stringify(block).slice(0, 500);
            })
            .filter(Boolean);
          return { result: textParts.join("\n") || "[工具无文本输出]" };
        }
        // 其他对象：序列化
        return { result: typeof result === "object" ? JSON.stringify(result).slice(0, 2000) : String(result) };
      },
      mcpServers: mcpServerConfigs as Record<string, never>,
    });

    const rawTools = await client.getTools();

    // Sanitize tool names: DeepSeek API requires names matching ^[a-zA-Z0-9_-]+$
    for (const tool of rawTools) {
      const original = tool.name;
      tool.name = tool.name.replace(/[^a-zA-Z0-9_-]/g, "_");
      if (tool.name !== original) {
        console.log(`🔧 MCP 工具名修正: "${original}" → "${tool.name}"`);
      }
    }

    const tools = rawTools;

    console.log(
      `🔌 MCP: 已加载 ${tools.length} 个工具，来自 ${Object.keys(mcpServerConfigs).length} 个 server`
    );

    return {
      tools: tools as StructuredToolInterface[],
      cleanup: async () => {
        try {
          await client.close();
        } catch (err) {
          console.warn("MCP client close error:", err);
        }
      },
    };
  } catch (error) {
    console.error("MCP 工具加载失败:", error);
    return { tools: [], cleanup: async () => {} };
  }
}
