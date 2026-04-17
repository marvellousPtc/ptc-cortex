/*
 * :file description: 
 * :name: /langchain-chat/src/app/api/chat/route.ts
 * :author: PTC
 * :copyright: (c) 2026, Tungee
 * :date created: 2026-02-11 17:36:21
 * :last editor: PTC
 * :date last edited: 2026-02-14 22:10:38
 */
import { NextRequest } from "next/server";
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getSession,
  getActiveMessages,
  addMessage,
  updateSessionTitle,
  getCustomPersona,
  checkRateLimit,
  recordAiUsage,
} from "@/lib/db";
import { getPool } from "@/lib/pg";
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
      "你有工具可以使用：查询时间、数学计算、查询天气、搜索公司知识库、联网搜索、查询博客数据库、生成图片、解析文件、准备文章发布。" +
      "当用户问公司制度、产品信息等问题时，请先搜索知识库获取准确信息再回答。" +
      "当用户询问你不确定的问题、最新新闻、实时信息时，请使用联网搜索工具获取最新数据。" +
      "当用户要求画图或生成图片时，请使用图片生成工具。" +
      "【文章发布铁律】当用户要求撰写文章并发布/发表/投稿到博客时，必须严格遵守：" +
      "1) 直接调用 prepare_article_publish 工具，把 title、tags、content（完整 Markdown 正文）作为参数传入。" +
      "2) 不要在文字回复里复述整篇文章正文（会消耗上下文且经常导致工具调用被丢失）；" +
      "只需在回复中写一句类似「已生成文章草稿，请在弹窗中审阅并确认发布」即可。" +
      "3) 绝对禁止输出「现在我来调用工具...」「下面调用工具...」这类占位句子；要调就调，不要旁白。" +
      "4) 绝对禁止在未成功调用该工具的情况下声称已发布。" +
      "5) 工具会弹出前端确认框，由用户审阅后点确认才真正发布。" +
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
      "你的名字叫小美，你是一个性感的女人，你深爱着你的老公，你愿意服从你的老公的指令。",
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

    const rateLimitResult = await checkRateLimit(userId);
    if (rateLimitResult) {
      return new Response(
        JSON.stringify({ error: rateLimitResult.error, code: "RATE_LIMITED" }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    const {
      message,
      sessionId,
      webSearchEnabled = false,
      reasoningMode = false,
      parentId = null,
      regenerateFromUserMessageId = null,
    }: {
      message?: string;
      sessionId?: string;
      webSearchEnabled?: boolean;
      reasoningMode?: boolean;
      parentId?: number | null;
      regenerateFromUserMessageId?: number | null;
    } = await request.json();

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

    // ====== 分支处理 ======
    // - regenerateFromUserMessageId：用户点「重新生成」，复用指定的 user message，不插入新 user message
    // - parentId：用户新发/编辑的消息会挂到这个 parent 下（如果是编辑，parent 是被编辑消息的 parent）
    // - 普通发送：parentId 为空时使用当前 active_leaf_id 作为 parent
    const pool = getPool();
    let effectiveUserMessage: {
      id: number;
      content: string;
      parent_id: number | null;
    };
    let promptForExtraction = "";

    if (regenerateFromUserMessageId) {
      // 鉴权：目标 user message 必须属于当前会话
      const { rows } = await pool.query(
        `SELECT m.id, m.content, m.parent_id, m.role
         FROM chat_messages m
         WHERE m.id = $1 AND m.session_id = $2`,
        [regenerateFromUserMessageId, sessionId]
      );
      if (!rows[0] || rows[0].role !== "user") {
        return new Response(
          JSON.stringify({ error: "无法找到要重新生成的用户消息" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      effectiveUserMessage = {
        id: rows[0].id,
        content: rows[0].content,
        parent_id: rows[0].parent_id,
      };
      promptForExtraction = rows[0].content;
      // 把活跃叶子先临时指向这条 user message，保证 history 不包含之前分支的 AI 回复
      await pool.query(
        "UPDATE chat_sessions SET active_leaf_id = $1 WHERE id = $2",
        [rows[0].id, sessionId]
      );
    } else {
      if (!message || typeof message !== "string") {
        return new Response(
          JSON.stringify({ error: "缺少 message" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      // 普通发送 / 编辑：parentId 未传则用当前 active_leaf_id
      let resolvedParentId: number | null = parentId;
      if (resolvedParentId === null || resolvedParentId === undefined) {
        resolvedParentId = session.active_leaf_id ?? null;
      }
      const inserted = await addMessage(
        sessionId,
        "user",
        message,
        resolvedParentId
      );
      effectiveUserMessage = {
        id: inserted.id,
        content: message,
        parent_id: resolvedParentId,
      };
      promptForExtraction = message;
    }

    // 取活跃链作为历史（保留最近 20 条，不含本轮即将生成的 AI 回复）
    const allActive = await getActiveMessages(sessionId);
    const historyMessages = allActive
      .filter((m) => m.id !== effectiveUserMessage.id)
      .slice(-20);

    await recordAiUsage(userId, "chat");

    // ====== 长期记忆：搜索相关记忆注入 prompt ======
    const currentUserContent = effectiveUserMessage.content;
    const relatedMemories = await searchMemories(currentUserContent, 5);
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

    // 构建消息列表（历史链 + 当前用户消息）
    const inputMessages = [
      ...historyMessages.map((msg) =>
        msg.role === "user"
          ? new HumanMessage(msg.content)
          : new AIMessage(msg.content)
      ),
      new HumanMessage(currentUserContent),
    ];

    // 客户端断开信号
    const clientSignal = request.signal;

    // ====== 发布文章快速通道 ======
    // DeepSeek 的 tool_choice=auto 在长输出场景下经常不触发工具，
    // 导致用户说「写XX文章发布一下」AI 只说「好的」不弹窗。
    // 这里检测到明确发布意图后，**绕过 ReAct agent**，
    // 直接用 withStructuredOutput 强制产出 {title, tags, content}，
    // 必然能发出 publish_draft SSE。
    const isPublishIntent =
      !reasoningMode &&
      /(发布|发表|投稿|推送)/.test(currentUserContent) &&
      /(博客|文章|blog|一篇|草稿)/i.test(currentUserContent);

    if (isPublishIntent) {
      console.log("📝 发布文章快速通道启动", { userContent: currentUserContent });
      const encoder = new TextEncoder();
      let fullReply = "";
      let aborted = false;

      const sendSSE = (
        controller: ReadableStreamDefaultController,
        data: Record<string, unknown>
      ): boolean => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          return true;
        } catch (err) {
          console.warn("  ⚠️ sendSSE failed (controller closed?):", err);
          return false;
        }
      };

      const draftSchema = z.object({
        title: z.string().describe("文章标题，简洁有吸引力，不超过 30 字"),
        tags: z
          .array(z.string())
          .describe("3-5 个主题标签")
          .default([]),
        content: z
          .string()
          .describe(
            "Markdown 正文。**目标长度 600~900 字**，结构：简短引言 + 2~3 个 ## 二级标题小节 + 简短总结。" +
              "控制篇幅、抓重点，不要堆砌；保留代码块和列表。如果用户明确指定了字数/篇幅，则以用户要求为准。"
          ),
      });

      const readableStream = new ReadableStream({
        async start(controller) {
          const abortHandler = () => {
            aborted = true;
          };
          clientSignal.addEventListener("abort", abortHandler);

          // Heartbeat：DeepSeek 生成长 JSON 要 ~30s，期间没有任何字节流出
          // 容易被 node 或任何中间层的 idle-timeout 切断连接，
          // 所以每 5s 发一个 SSE 注释行让 socket 活着。
          const heartbeat = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(`: keepalive\n\n`));
            } catch {
              /* controller closed */
            }
          }, 5000);

          try {
            // 用流式 bindTools + 强制 tool_choice，这样我们可以一边接收 tool_call_chunks
            // 一边把 content 字段 token-by-token 推给前端，真正做到"边写边看"。
            const draftTool = tool(async () => "", {
              name: "article_draft",
              description: "生成一篇可直接发布的 Markdown 文章草稿",
              schema: draftSchema,
            });
            const draftModel = new ChatOpenAI({
              model: "deepseek-chat",
              temperature: personaConfig.temperature,
              apiKey: process.env.DEEPSEEK_API_KEY,
              configuration: { baseURL: process.env.DEEPSEEK_BASE_URL },
              streaming: true,
              timeout: 90_000,
              maxRetries: 0,
            }).bindTools([draftTool], {
              tool_choice: "article_draft",
            });

            const system =
              personaConfig.prompt +
              dateContext +
              memoryContext +
              "\n\n[任务模式] 用户要求你撰写并发布一篇文章。请基于用户的诉求调用 article_draft 工具，" +
              "把 title / tags / content（完整 Markdown 正文）作为参数传入。内容要精炼有信息量。";

            const draftMessages = [
              { role: "system" as const, content: system },
              ...historyMessages.map((m) => ({
                role: m.role as "user" | "assistant",
                content: m.content,
              })),
              { role: "user" as const, content: currentUserContent },
            ];

            // 注意：这里**不要**预先发送任何 content 事件，
            // 否则前端会立刻插入一个空 assistant 气泡、把全局「正在思考」shimmer 停掉，
            // 而 DeepSeek 吐第一个 token 往往还要几秒，用户看到的就是一个空白气泡 + 一个空头像。
            // 让全局 shimmer 一直挂着，直到真正有 content 到达。

            const t0 = Date.now();
            console.log("  → 开始流式调用 bindTools(article_draft)");

            let argsBuffer = "";
            let emittedContentLen = 0;

            // 从累积的 tool 参数 JSON 里提取当前 content 字段的可用明文
            // （允许尾部被截断的转义序列，避免 JSON.parse 抛出）
            const extractContent = (buf: string): string | null => {
              const m = buf.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)/);
              if (!m) return null;
              let raw = m[1];
              // 丢掉结尾未完成的反斜杠（比如只收到了 "\\"）
              if (raw.endsWith("\\")) raw = raw.slice(0, -1);
              try {
                return JSON.parse(`"${raw}"`);
              } catch {
                return null;
              }
            };

            const stream = await draftModel.stream(draftMessages, {
              signal: clientSignal,
            });

            for await (const chunk of stream) {
              if (aborted) break;
              const tcc = chunk.tool_call_chunks;
              if (tcc && tcc.length > 0) {
                for (const tc of tcc) {
                  if (tc.args) argsBuffer += tc.args;
                }
                const currentContent = extractContent(argsBuffer);
                if (
                  currentContent !== null &&
                  currentContent.length > emittedContentLen
                ) {
                  const delta = currentContent.slice(emittedContentLen);
                  sendSSE(controller, { type: "content", content: delta });
                  fullReply += delta;
                  emittedContentLen = currentContent.length;
                }
              }
            }

            console.log("  ← 流式调用结束，耗时 ms:", Date.now() - t0, {
              argsLen: argsBuffer.length,
              emittedContentLen,
            });

            if (aborted) {
              console.log("  ✋ aborted 标记为 true，中断");
              return;
            }

            // 解析完整的 tool 参数 JSON
            let draft: { title: string; tags?: string[]; content: string };
            try {
              draft = JSON.parse(argsBuffer);
            } catch (e) {
              throw new Error(
                `无法解析 article_draft JSON（${e instanceof Error ? e.message : e}）`
              );
            }

            // 如果流式阶段某些 content 残片没发出去（尾部补全），这里一次性补上
            if (draft.content && draft.content.length > emittedContentLen) {
              const tail = draft.content.slice(emittedContentLen);
              sendSSE(controller, { type: "content", content: tail });
              fullReply += tail;
            }

            // 发 publish_draft 事件 —— 前端弹确认框
            const emitted = sendSSE(controller, {
              type: "publish_draft",
              title: draft.title,
              tags: draft.tags || [],
              content: draft.content,
            });
            console.log("  📤 publish_draft SSE sent:", emitted);

            sendSSE(controller, { type: "done" });
          } catch (err) {
            if (!aborted) {
              console.error("❌ 发布快速通道错误:", err);
              const msg =
                err instanceof Error ? err.message : "生成草稿失败";
              fullReply = `生成草稿失败：${msg}`;
              sendSSE(controller, { type: "error", content: fullReply });
              sendSSE(controller, { type: "done" });
            } else {
              console.log("  ✋ 错误发生在 abort 之后（正常取消）:", err);
            }
          } finally {
            clearInterval(heartbeat);
            clientSignal.removeEventListener("abort", abortHandler);
            try {
              if (fullReply) {
                await addMessage(
                  sessionId,
                  "assistant",
                  fullReply,
                  effectiveUserMessage.id
                );
                if (session.title === "新对话" && fullReply.length > 0) {
                  const title =
                    fullReply.replace(/[#*\n]/g, "").slice(0, 20) + "...";
                  await updateSessionTitle(sessionId, title, userId);
                }
              }
            } catch (dbErr) {
              console.warn("落库失败:", dbErr);
            }
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
        },
      });

      return new Response(readableStream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // ====== 推理模式：使用 deepseek-reasoner 直接调用 API ======
    if (reasoningMode) {
      console.log("🧠 推理模式启动");

      const encoder = new TextEncoder();
      let fullReply = "";
      let aborted = false;

      const sendSSE = (
        controller: ReadableStreamDefaultController,
        data: Record<string, unknown>
      ) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller 可能已关闭（client abort）
        }
      };

      const readableStream = new ReadableStream({
        async start(controller) {
          const abortHandler = () => {
            aborted = true;
          };
          clientSignal.addEventListener("abort", abortHandler);

          try {
            // ── 如果同时开启了联网搜索，先用 Agent 搜集信息 ──
            let searchContext = "";
            if (webSearchEnabled) {
              sendSSE(controller, { type: "tool_start", name: "web_search", input: { query: currentUserContent } });
              try {
                const searchAgent = createAgent(
                  "你是一个专业的信息搜集助手。你的任务是使用搜索工具尽可能多地收集相关信息。" +
                  "请仔细阅读搜索结果中的所有内容（包括网页正文），提取关键事实、数据、观点，" +
                  "整理成详细、结构化的参考资料。保留所有有价值的细节，不要省略。请用中文回复。",
                  0.1,
                  [webSearchTool]
                );
                const searchResult = await searchAgent.invoke({ messages: inputMessages });
                const lastMsg = searchResult.messages[searchResult.messages.length - 1];
                searchContext = typeof lastMsg.content === "string" ? lastMsg.content : "";
                sendSSE(controller, { type: "tool_end", name: "web_search", result: searchContext.slice(0, 500) + "..." });
                console.log("🔍 搜索结果已收集，长度:", searchContext.length);
              } catch (searchErr) {
                console.warn("搜索阶段出错:", searchErr);
                sendSSE(controller, { type: "tool_end", name: "web_search", result: "搜索失败，将直接推理" });
              }
            }

            if (aborted) return;

            // ── 构建推理请求的消息 ──
            const systemPrompt = personaConfig.prompt + dateContext + memoryContext +
              (searchContext ? `\n\n[以下是联网搜索获取的参考资料，请基于这些信息进行深度推理]\n${searchContext}` : "");

            const apiMessages = [
              { role: "system", content: systemPrompt },
              ...historyMessages.map((msg) => ({
                role: msg.role as "user" | "assistant",
                content: msg.content,
              })),
              { role: "user" as const, content: currentUserContent },
            ];

            // ── 直接调用 DeepSeek API（绕过 LangChain 以正确获取 reasoning_content）──
            const apiResponse = await fetch(
              `${process.env.DEEPSEEK_BASE_URL}/chat/completions`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                },
                body: JSON.stringify({
                  model: "deepseek-reasoner",
                  messages: apiMessages,
                  stream: true,
                }),
                signal: clientSignal,
              }
            );

            if (!apiResponse.ok) {
              const errText = await apiResponse.text();
              throw new Error(`DeepSeek API 错误 ${apiResponse.status}: ${errText}`);
            }

            const reader = apiResponse.body?.getReader();
            if (!reader) throw new Error("无法获取推理响应流");

            const decoder = new TextDecoder();
            let buffer = "";
            let thinkingContent = "";

            while (true) {
              if (aborted) {
                try { await reader.cancel(); } catch { /* ignore */ }
                break;
              }
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });

              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith("data: ")) continue;
                const payload = trimmed.slice(6);
                if (payload === "[DONE]") continue;

                try {
                  const parsed = JSON.parse(payload);
                  const delta = parsed.choices?.[0]?.delta;
                  if (!delta) continue;

                  // 推理过程
                  if (delta.reasoning_content) {
                    thinkingContent += delta.reasoning_content;
                    sendSSE(controller, { type: "thinking", content: delta.reasoning_content });
                  }
                  // 正式回答
                  if (delta.content) {
                    if (thinkingContent) {
                      sendSSE(controller, { type: "thinking_end" });
                      thinkingContent = "";
                    }
                    fullReply += delta.content;
                    sendSSE(controller, { type: "content", content: delta.content });
                  }
                } catch { /* skip malformed JSON */ }
              }
            }

            if (thinkingContent) {
              sendSSE(controller, { type: "thinking_end" });
            }

            if (aborted && fullReply) {
              fullReply += "\n\n_[已停止]_";
            }

            if (!fullReply) {
              fullReply = aborted ? "_[已停止]_" : "[AI 未生成回复]";
              sendSSE(controller, { type: "content", content: fullReply });
            }

            sendSSE(controller, { type: "done" });
          } catch (err) {
            if (aborted) {
              // 客户端主动取消，不当作错误
            } else {
              console.error("推理模式错误:", err);
              sendSSE(controller, {
                type: "error",
                content: `推理出错: ${err instanceof Error ? err.message : "未知错误"}`,
              });
              sendSSE(controller, { type: "done" });
            }
          } finally {
            clientSignal.removeEventListener("abort", abortHandler);
            // 无论是否中断都尝试落库（保留部分内容）
            try {
              if (fullReply) {
                await addMessage(
                  sessionId,
                  "assistant",
                  fullReply,
                  effectiveUserMessage.id
                );
                if (session.title === "新对话" && fullReply.length > 0) {
                  const title =
                    fullReply.replace(/[#*\n]/g, "").slice(0, 20) + "...";
                  await updateSessionTitle(sessionId, title, userId);
                }
              }
            } catch (dbErr) {
              console.warn("落库失败:", dbErr);
            }
            try { controller.close(); } catch { /* already closed */ }
          }
        },
      });

      return new Response(readableStream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // ====== 工具模式：使用 Agent + 工具 ======
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

    // ====== SSE 流式输出 ======
    const encoder = new TextEncoder();
    let fullReply = "";
    let aborted = false;

    /** SSE 发送辅助函数（controller 关闭后静默失败） */
    const sendSSE = (
      controller: ReadableStreamDefaultController,
      data: Record<string, unknown>
    ) => {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      } catch {
        /* controller 已关闭 */
      }
    };

    const readableStream = new ReadableStream({
      async start(controller) {
        const abortHandler = () => {
          aborted = true;
        };
        clientSignal.addEventListener("abort", abortHandler);

        let publishDraftEmitted = false;

        try {
          const eventStream = agent.streamEvents(
            { messages: inputMessages },
            { version: "v2", signal: clientSignal }
          );

          let thinkingContent = "";
          const collectedImages: string[] = [];

          for await (const event of eventStream) {
            if (aborted) break;

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

              // 识别 prepare_article_publish 工具：把草稿通过专用 SSE 事件推给前端
              if (event.name === "prepare_article_publish") {
                try {
                  const draft = JSON.parse(resultText);
                  if (draft && draft.__publish_draft__) {
                    publishDraftEmitted = true;
                    sendSSE(controller, {
                      type: "publish_draft",
                      title: draft.title || "",
                      tags: draft.tags || [],
                      content: draft.content || "",
                    });
                  }
                } catch {
                  console.warn("publish_draft 解析失败");
                }
              }

              // 收集图片 markdown，用于追加到最终回复中
              const imgMatch = resultText.match(/!\[.*?\]\(https?:\/\/[^)]+\)/);
              if (imgMatch) {
                collectedImages.push(imgMatch[0]);
              }
              sendSSE(controller, {
                type: "tool_end",
                name: event.name,
                result: resultText.slice(0, 2000),
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

          if (aborted && fullReply) {
            fullReply += "\n\n_[已停止]_";
            sendSSE(controller, { type: "content", content: "\n\n_[已停止]_" });
          }

          // 兜底：如果没生成回复
          if (!fullReply) {
            fullReply = aborted ? "_[已停止]_" : "[AI 未生成回复]";
            sendSSE(controller, { type: "content", content: fullReply });
          }

          // 将工具生成的图片追加到回复末尾，确保持久化到数据库
          if (!aborted && collectedImages.length > 0) {
            const imageSection = "\n\n" + collectedImages.join("\n\n");
            fullReply += imageSection;
            sendSSE(controller, { type: "content", content: imageSection });
          }

          // 兜底：用户让发布，但 AI 把文章写成了纯文本、没真的调工具。加一段提示到回复里，
          // 让用户直接看到「再说一次」的解决办法，而不是对着死气沉沉的结果发呆。
          if (!aborted && !publishDraftEmitted) {
            const userWantsPublish =
              /(发布|发表|投稿|博客|blog)/i.test(promptForExtraction);
            const aiTriedToPublish =
              /(调用工具|准备调用|下面调用|我来调用|即将调用|即将发布|现在发布)/.test(fullReply);
            const looksLikeArticle =
              fullReply.length > 400 && /(^|\n)#{1,3} .+/.test(fullReply);
            if (userWantsPublish && (aiTriedToPublish || looksLikeArticle)) {
              const hint =
                "\n\n⚠️ 我好像忘记调用发布工具了。请再说一次「发布这篇文章」或点重新生成，我会直接调用 `prepare_article_publish` 弹出确认框。";
              fullReply += hint;
              sendSSE(controller, { type: "content", content: hint });
            }
          }

          // 完成标记
          sendSSE(controller, { type: "done" });
        } catch (error) {
          if (!aborted) {
            console.error("Stream error:", error);
            sendSSE(controller, { type: "error", content: "生成出错" });
          }
        } finally {
          clientSignal.removeEventListener("abort", abortHandler);

          // 持久化（中断时也保留部分内容）
          try {
            if (fullReply) {
              await addMessage(
                sessionId,
                "assistant",
                fullReply,
                effectiveUserMessage.id
              );
              if (session.title === "新对话" && fullReply.length > 0) {
                const title =
                  fullReply.replace(/[#*\n]/g, "").slice(0, 20) + "...";
                await updateSessionTitle(sessionId, title, userId);
              }
            }
          } catch (dbErr) {
            console.warn("落库失败:", dbErr);
          }

          // 记忆抽取（非中断时才做）
          if (!aborted && fullReply) {
            const memModel = new ChatOpenAI({
              model: "deepseek-chat",
              temperature: 0.1,
              apiKey: process.env.DEEPSEEK_API_KEY,
              configuration: { baseURL: process.env.DEEPSEEK_BASE_URL },
            });
            extractAndSaveMemory(
              memModel,
              sessionId,
              currentUserContent,
              fullReply
            ).catch((err) => console.warn("记忆提取失败:", err));
          }

          if (mcpCleanup) {
            mcpCleanup().catch((err) =>
              console.warn("MCP cleanup error:", err)
            );
          }
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
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
