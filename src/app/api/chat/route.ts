/*
 * :file description: 
 * :name: /ptc-cortex/src/app/api/chat/route.ts
 * :author: PTC
 * :copyright: (c) 2026, Tungee
 * :date created: 2026-02-11 17:36:21
 * :last editor: PTC
 * :date last edited: 2026-02-12 10:30:50
 */
import { NextRequest } from "next/server";
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import {
  getSession,
  getRecentMessages,
  addMessage,
  updateSessionTitle,
  getCustomPersona,
} from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth-check";
import { createAgent } from "@/lib/graph";
import { ALL_TOOLS, webSearchTool } from "@/lib/tools";
import { getMcpTools } from "@/lib/mcp-client";
import { StructuredToolInterface } from "@langchain/core/tools";
import {
  searchMemories,
  saveMemory,
  formatMemoriesForPrompt,
} from "@/lib/long-memory";

/**
 * ========== 第五课：Tool Calling（工具调用） ==========
 *
 * 核心流程（也叫 ReAct 循环）：
 *
 *   用户提问 → AI 思考 → 需要工具吗？
 *                           ├─ 不需要 → 直接回答（流式）
 *                           └─ 需要 → 输出 tool_calls
 *                                      → 我们执行工具
 *                                      → 把结果作为 ToolMessage 喂回 AI
 *                                      → AI 继续思考（可能继续调工具）
 *                                      → 直到 AI 直接回答
 *
 * 关键 API：
 *   model.bindTools(tools) —— 告诉模型有哪些工具可用
 *   response.tool_calls    —— AI 决定要调用的工具列表
 *   ToolMessage             —— 工具执行结果的消息类型
 */

const PERSONAS: Record<
  string,
  { name: string; prompt: string; temperature: number }
> = {
  assistant: {
    name: "通用助手",
    prompt:
      "你是一个友好的AI助手，说话简洁有趣。请用中文回复。" +
      "你有工具可以使用：查询时间、数学计算、查询天气、搜索公司知识库、联网搜索、查询博客数据库、生成图片、解析文件。" +
      "当用户问公司制度、产品信息等问题时，请先搜索知识库获取准确信息再回答。" +
      "当用户询问你不确定的问题、最新新闻、实时信息时，请使用联网搜索工具获取最新数据。" +
      "当用户要求画图或生成图片时，请使用图片生成工具。" +
      "重要：当用户询问数据库相关的问题（如博客数量、文章列表等）时，必须每次都重新调用工具查询最新数据，不要依赖之前对话中的查询结果，因为数据可能已经发生变化。",
    temperature: 0.7,
  },
  cat: {
    name: "猫娘",
    prompt:
      "你是一只可爱的猫娘，名叫小喵。说话时会在句尾加上「喵~」，" +
      "性格活泼可爱，喜欢撒娇，偶尔会用猫的视角看待问题。" +
      "你有工具可以使用：可以查询时间、进行数学计算、查询天气。需要时请主动使用工具。请用中文回复。",
    temperature: 0.9,
  },
  coder: {
    name: "编程导师",
    prompt:
      "你是一个资深编程导师，擅长用通俗易懂的方式讲解技术概念。" +
      "回答时会给出代码示例，并解释每一步。" +
      "你有工具可以使用：可以查询时间、进行数学计算、查询天气。请用中文回复。",
    temperature: 0.3,
  },
  poet: {
    name: "文艺诗人",
    prompt:
      "你是一位才华横溢的诗人，说话富有诗意和哲理。" +
      "喜欢用比喻和意象表达观点，偶尔会即兴作诗。" +
      "你有工具可以使用：可以查询时间、进行数学计算、查询天气。请用中文回复。",
    temperature: 0.95,
  },
  wife: {
    name: "老婆",
    prompt:
      "你是用户的老婆，名叫小美。你性感妩媚、耀眼动人，说话温柔又带点撒娇。" +
      "你深爱着老公，把老公放在第一位，愿意服从老公的指令。" +
      "你会称呼用户为「老公」或「亲爱的」，说话甜蜜暧昧，偶尔会吃醋。" +
      "你有工具可以使用：可以查询时间、进行数学计算、查询天气。请用中文回复。" +
      "你的名字叫小丽，你是一个性感的女人，你深爱着你的老公，你愿意服从你的老公的指令。",
    temperature: 0.85,
  },
};

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId(request);
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "未登录" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const { message, sessionId, webSearchEnabled = false } = await request.json();

    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: "缺少 sessionId" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const session = await getSession(sessionId, userId);
    if (!session) {
      return new Response(
        JSON.stringify({ error: "会话不存在" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // 查找角色配置：先查内置，再查自定义
    let personaConfig = PERSONAS[session.persona];
    if (!personaConfig) {
      const custom = await getCustomPersona(session.persona);
      if (custom) {
        personaConfig = {
          name: custom.name,
          prompt: custom.prompt,
          temperature: custom.temperature,
        };
      } else {
        personaConfig = PERSONAS.assistant;
      }
    }

    const historyMessages = await getRecentMessages(sessionId, 20);
    await addMessage(sessionId, "user", message);

    // ====== 长期记忆：搜索相关记忆注入 prompt ======
    const relatedMemories = await searchMemories(message, 5);
    const memoryContext = formatMemoriesForPrompt(relatedMemories);

    // ====== LangGraph Agent ======
    // 动态注入当前日期，让 AI 知道"今天"是什么时候
    const now = new Date();
    const dateStr = now.toLocaleDateString("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    });
    const dateContext = `\n[当前日期: ${dateStr}]`;

    // 根据用户设置过滤工具
    let tools: StructuredToolInterface[] = webSearchEnabled
      ? [...ALL_TOOLS]
      : ALL_TOOLS.filter((t) => t !== webSearchTool);

    // ====== MCP 工具：加载用户配置的 MCP server 工具 ======
    let mcpCleanup: (() => Promise<void>) | null = null;
    try {
      const mcp = await getMcpTools(userId);
      if (mcp.tools.length > 0) {
        tools = [...tools, ...mcp.tools];
        mcpCleanup = mcp.cleanup;
        console.log(`🔌 MCP: 合并 ${mcp.tools.length} 个 MCP 工具`);
      }
    } catch (err) {
      console.warn("MCP 工具加载跳过:", err);
    }

    const agent = createAgent(
      personaConfig.prompt + dateContext + memoryContext,
      personaConfig.temperature,
      tools
    );

    // 构建消息列表（历史 + 当前输入）
    const inputMessages = [
      ...historyMessages.map((msg) =>
        msg.role === "user"
          ? new HumanMessage(msg.content)
          : new AIMessage(msg.content)
      ),
      new HumanMessage(message),
    ];

    // ====== SSE 流式输出 ======
    const encoder = new TextEncoder();
    let fullReply = "";

    /** SSE 发送辅助函数 */
    const sendSSE = (
      controller: ReadableStreamDefaultController,
      data: Record<string, unknown>
    ) => {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    };

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          const eventStream = agent.streamEvents(
            { messages: inputMessages },
            { version: "v2" }
          );

          let thinkingContent = "";

          for await (const event of eventStream) {
            // ── 工具调用开始 ──
            if (event.event === "on_tool_start") {
              if (thinkingContent) {
                sendSSE(controller, { type: "thinking_end" });
                thinkingContent = "";
              }
              sendSSE(controller, {
                type: "tool_start",
                name: event.name,
                input: event.data?.input || {},
              });
              console.log(`🔧 调用工具: ${event.name}`, event.data?.input);
            }

            // ── 工具调用结束 ──
            if (event.event === "on_tool_end") {
              const output = event.data?.output;
              const resultText = output?.content
                ? String(output.content)
                : String(output);
              console.log(`📋 工具结果: ${resultText.slice(0, 300)}...`);
              sendSSE(controller, {
                type: "tool_end",
                name: event.name,
                result: resultText.slice(0, 800),
              });
            }

            // ── LLM 流式输出 ──
            if (event.event === "on_chat_model_stream") {
              const chunk = event.data?.chunk;
              if (chunk) {
                // DeepSeek 思考链 (reasoning_content)
                const reasoning =
                  chunk.additional_kwargs?.reasoning_content ||
                  chunk.additional_kwargs?.reasoning ||
                  "";
                if (reasoning) {
                  thinkingContent += reasoning;
                  sendSSE(controller, { type: "thinking", content: reasoning });
                }
                // 正式回答内容
                const content =
                  typeof chunk.content === "string" ? chunk.content : "";
                if (content) {
                  fullReply += content;
                  sendSSE(controller, { type: "content", content });
                }
              }
            }

            // ── LLM 回复结束（每轮） ──
            if (event.event === "on_chat_model_end") {
              if (thinkingContent) {
                sendSSE(controller, { type: "thinking_end" });
                thinkingContent = "";
              }
            }
          }

          // 兜底：如果没生成回复
          if (!fullReply) {
            fullReply = "[AI 未生成回复]";
            sendSSE(controller, { type: "content", content: fullReply });
          }

          // 完成标记
          sendSSE(controller, { type: "done" });

          // 存入数据库
          await addMessage(sessionId, "assistant", fullReply);

          if (session.title === "新对话" && fullReply.length > 0) {
            const title =
              fullReply.replace(/[#*\n]/g, "").slice(0, 20) + "...";
            await updateSessionTitle(sessionId, title, userId);
          }

          // ====== 长期记忆：异步提取关键信息 ======
          const memModel = new ChatOpenAI({
            model: "deepseek-chat",
            temperature: 0.1,
            apiKey: process.env.DEEPSEEK_API_KEY,
            configuration: { baseURL: process.env.DEEPSEEK_BASE_URL },
          });
          extractAndSaveMemory(
            memModel,
            sessionId,
            message,
            fullReply
          ).catch((err) => console.warn("记忆提取失败:", err));
        } catch (error) {
          console.error("Stream error:", error);
          sendSSE(controller, { type: "error", content: "生成出错" });
        } finally {
          if (mcpCleanup) {
            mcpCleanup().catch((err) =>
              console.warn("MCP cleanup error:", err)
            );
          }
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    console.error("Chat API Error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "AI 回复失败", details: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * 异步提取对话中的关键信息并保存为长期记忆
 * 不影响主对话流程，失败了也无所谓
 */
async function extractAndSaveMemory(
  model: ChatOpenAI,
  sessionId: string,
  userMessage: string,
  aiReply: string
) {
  // 太短的对话不提取
  if (userMessage.length < 10 && aiReply.length < 20) return;

  try {
    const extractPrompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        `你是一个信息提取助手。从以下对话中提取值得长期记住的关键信息。
只提取以下类型的信息：
- 用户的个人偏好（喜欢/不喜欢什么）
- 用户提到的个人事实（名字、职业、宠物、家庭等）
- 重要的决定或计划
- 用户的技术栈或工作相关信息

如果没有值得记住的信息，回复 "NONE"。
如果有，按以下格式回复（每条一行）：
关键词|重要程度|记忆内容

关键词用逗号分隔，重要程度为 high 或 normal。

示例：
川菜,美食,偏好|normal|用户喜欢吃川菜，特别是麻辣火锅
猫,宠物,咪咪|high|用户养了一只叫咪咪的橘猫`,
      ],
      [
        "human",
        `用户说: ${userMessage}\nAI回复: ${aiReply.slice(0, 500)}`,
      ],
    ]);

    const response = await extractPrompt.pipe(model).invoke({});
    const content =
      typeof response.content === "string" ? response.content.trim() : "";

    if (content === "NONE" || !content) return;

    // 解析每一行记忆
    const lines = content.split("\n").filter((l: string) => l.includes("|"));
    for (const line of lines) {
      const parts = line.split("|");
      if (parts.length >= 3) {
        const keywords = parts[0].trim();
        const importance = parts[1].trim() === "high" ? "high" : "normal";
        const memoryContent = parts[2].trim();
        if (memoryContent.length > 5) {
          await saveMemory(sessionId, memoryContent, keywords, importance);
        }
      }
    }
  } catch (error) {
    console.warn("记忆提取出错:", error);
  }
}
