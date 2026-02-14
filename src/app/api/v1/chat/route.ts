/**
 * ========== 外部 API：无状态流式聊天 ==========
 *
 * 供其他项目（如 ink-and-code）调用的无状态 API。
 * - 不管理 session，调用方自己维护对话历史
 * - API Key 鉴权
 * - 结构化 SSE 事件：token / tool_start / tool_end / done
 * - 支持工具筛选、温度等配置
 */

import { NextRequest } from "next/server";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { verifyApiKey } from "@/lib/auth";
import { createAgent } from "@/lib/graph";
import { ALL_TOOLS, webSearchTool } from "@/lib/tools";

// 工具名称映射表，供调用方按名称筛选
const TOOL_NAME_MAP: Record<string, (typeof ALL_TOOLS)[number]> = {};
for (const t of ALL_TOOLS) {
  TOOL_NAME_MAP[t.name] = t;
}

interface RequestMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface RequestBody {
  messages: RequestMessage[];
  tools?: string[];
  temperature?: number;
  webSearchEnabled?: boolean;
}

/**
 * 发送一条 SSE 事件
 */
function sseEvent(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  // ====== 鉴权 ======
  const auth = verifyApiKey(request);
  if (!auth.ok) {
    return new Response(
      JSON.stringify({ error: auth.error }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const body: RequestBody = await request.json();
    const {
      messages,
      tools: toolNames,
      temperature = 0.7,
      webSearchEnabled = true,
    } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "messages 不能为空" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ====== 构建 LangChain 消息 ======
    let systemPrompt = "";
    const inputMessages: (HumanMessage | AIMessage)[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemPrompt += (systemPrompt ? "\n" : "") + msg.content;
      } else if (msg.role === "user") {
        inputMessages.push(new HumanMessage(msg.content));
      } else if (msg.role === "assistant") {
        inputMessages.push(new AIMessage(msg.content));
      }
    }

    // 默认系统提示
    if (!systemPrompt) {
      systemPrompt = "你是一个友好的AI助手，请用中文回复。";
    }

    // 注入当前日期
    const now = new Date();
    const dateStr = now.toLocaleDateString("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    });
    systemPrompt += `\n[当前日期: ${dateStr}]`;

    // ====== 筛选工具 ======
    let selectedTools = [...ALL_TOOLS];
    let toolsExplicitlyEmpty = false;

    if (toolNames !== undefined) {
      if (Array.isArray(toolNames) && toolNames.length === 0) {
        // 传空数组 → 纯对话不用工具
        selectedTools = [];
        toolsExplicitlyEmpty = true;
      } else if (Array.isArray(toolNames) && toolNames.length > 0) {
        // 按名称筛选
        selectedTools = toolNames
          .map((name) => TOOL_NAME_MAP[name])
          .filter(Boolean);
      }
    }

    // webSearchEnabled 控制
    if (!webSearchEnabled) {
      selectedTools = selectedTools.filter((t) => t !== webSearchTool);
    }

    // ====== 创建 Agent ======
    // 传 undefined 让 createAgent 使用默认工具；传空数组时也用 undefined（createReactAgent 需要至少有工具）
    // 纯对话模式：不绑定任何工具
    const agent = createAgent(
      systemPrompt,
      temperature,
      toolsExplicitlyEmpty ? [] : (selectedTools.length > 0 ? selectedTools : undefined)
    );

    // ====== 流式响应 ======
    const encoder = new TextEncoder();

    const readableStream = new ReadableStream({
      async start(controller) {
        let fullReply = "";

        try {
          const eventStream = agent.streamEvents(
            { messages: inputMessages },
            { version: "v2" }
          );

          let lastAIContent = "";

          for await (const event of eventStream) {
            // 工具调用开始
            if (event.event === "on_tool_start") {
              const toolEvent = sseEvent("tool_start", {
                tool: event.name,
                input: event.data?.input || {},
              });
              controller.enqueue(encoder.encode(toolEvent));
              console.log(`[v1] 🔧 调用工具: ${event.name}`, event.data?.input);
            }

            // 工具调用结束
            if (event.event === "on_tool_end") {
              const output = event.data?.output;
              const resultText = output?.content
                ? String(output.content)
                : String(output);

              // 提取来源信息
              const sources: string[] = [];
              if (event.name === "web_search" && resultText) {
                const lines = resultText.split("\n");
                for (const line of lines) {
                  const srcMatch = line.match(/^来源:\s*(.+)$/);
                  if (srcMatch) {
                    sources.push(srcMatch[1].trim());
                  }
                }
              }

              const toolEndEvent = sseEvent("tool_end", {
                tool: event.name,
                ...(sources.length > 0 ? { sources } : {}),
              });
              controller.enqueue(encoder.encode(toolEndEvent));
              console.log(`[v1] 📋 工具结果: ${resultText.slice(0, 300)}...`);
            }

            // LLM 流式 token
            if (event.event === "on_chat_model_stream") {
              const chunk = event.data?.chunk;
              if (chunk) {
                const content =
                  typeof chunk.content === "string" ? chunk.content : "";
                if (content) {
                  lastAIContent += content;
                }
              }
            }

            // LLM 回复结束（每轮）
            if (event.event === "on_chat_model_end") {
              const output = event.data?.output;
              const hasToolCalls =
                output?.tool_calls && output.tool_calls.length > 0;

              if (!hasToolCalls && lastAIContent) {
                // 最终回答 → 逐 token 发送
                fullReply = lastAIContent;
                const chunkSize = 5;
                for (let i = 0; i < lastAIContent.length; i += chunkSize) {
                  const tokenEvent = sseEvent("token", {
                    content: lastAIContent.slice(i, i + chunkSize),
                  });
                  controller.enqueue(encoder.encode(tokenEvent));
                }
              }

              lastAIContent = "";
            }
          }

          // 发送 done 事件
          const doneEvent = sseEvent("done", { content: fullReply });
          controller.enqueue(encoder.encode(doneEvent));
        } catch (error) {
          console.error("[v1] Stream error:", error);
          const errorEvent = sseEvent("error", {
            message: error instanceof Error ? error.message : "内部错误",
          });
          controller.enqueue(encoder.encode(errorEvent));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    console.error("[v1] Chat API Error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "AI 回复失败", details: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
