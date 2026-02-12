import { NextRequest } from "next/server";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";

/**
 * ========== 第二课：流式输出 (Streaming) ==========
 *
 * 之前：model.invoke(messages) → 等全部生成完 → 一次性返回
 * 现在：model.stream(messages) → 边生成边返回 → 打字机效果
 *
 * 对比：
 *   invoke()  返回 AIMessage（完整回复）
 *   stream()  返回 AsyncIterator<AIMessageChunk>（一小块一小块的回复）
 *
 * 如果你用原生 fetch 实现流式，需要：
 *   1. 手动设置 SSE headers
 *   2. 手动解析 data: [DONE] 等 SSE 格式
 *   3. 手动处理 chunk 拼接
 *
 * 用 LangChain 的 stream()，这些全省了 —— 直接 for await 遍历就行。
 */

export async function POST(request: NextRequest) {
  const model = new ChatOpenAI({
    model: "deepseek-chat",
    temperature: 0.7,
    apiKey: process.env.DEEPSEEK_API_KEY,
    configuration: {
      baseURL: process.env.DEEPSEEK_BASE_URL,
    },
  });

  try {
    const { message, history } = await request.json();

    const messages = [
      new SystemMessage(
        "你是一个友好的AI助手，说话简洁有趣。请用中文回复。"
      ),
      ...history.map((msg: { role: string; content: string }) =>
        msg.role === "user"
          ? new HumanMessage(msg.content)
          : new AIMessage(msg.content)
      ),
      new HumanMessage(message),
    ];

    // ====== 核心变化：invoke() → stream() ======
    // stream() 返回一个异步迭代器，每次 yield 一小段文本（AIMessageChunk）
    const stream = await model.stream(messages);

    // 用 ReadableStream 把 LangChain 的流转成 HTTP 流式响应
    // 这是 Web Streams API，浏览器和 Next.js 都原生支持
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          // for await...of —— 遍历异步迭代器，每来一小块就推给前端
          for await (const chunk of stream) {
            // chunk.content 就是这一小段文本（可能是一个字、一个词、一小句）
            const text = typeof chunk.content === "string" ? chunk.content : "";
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
          }
        } catch (error) {
          console.error("Stream error:", error);
          controller.enqueue(encoder.encode("\n[生成出错]"));
        } finally {
          controller.close();
        }
      },
    });

    // 返回流式响应（注意 Content-Type 是 text/plain，不是 JSON 了）
    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
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
