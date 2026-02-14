/**
 * ========== LangGraph 工作流编排 ==========
 *
 * 把之前手写的 while 循环 ReAct 模式，重构为 LangGraph 的状态图。
 *
 * LangGraph 核心概念：
 *   - State（状态）：流经图的数据，这里是消息列表
 *   - Node（节点）：处理状态的函数（调用 LLM、执行工具等）
 *   - Edge（边）：节点之间的连接，可以是条件分支
 *
 * 优势：
 *   1. 可视化：图结构清晰，容易理解和调试
 *   2. 可扩展：加新节点（如审批、人工介入）很方便
 *   3. 内置容错：自动处理工具执行错误
 *   4. 支持流式：原生 stream 支持
 *
 * 我们用 createReactAgent —— LangGraph 内置的 ReAct Agent，
 * 它封装了 "LLM → 判断是否调工具 → 执行工具 → 循环" 的完整流程。
 */

import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ALL_TOOLS } from "@/lib/tools";
import { BaseMessage } from "@langchain/core/messages";
import { StructuredToolInterface } from "@langchain/core/tools";

/**
 * 创建一个 ReAct Agent（工具模式）
 *
 * @param systemPrompt - AI 的人设/系统提示
 * @param temperature - 温度参数
 * @param tools - 可选，自定义工具列表（默认使用 ALL_TOOLS）
 * @returns 编译好的 Agent（可以 invoke 或 stream）
 */
export function createAgent(
  systemPrompt: string,
  temperature: number = 0.7,
  tools?: StructuredToolInterface[]
) {
  const model = new ChatOpenAI({
    model: "deepseek-chat",
    temperature,
    apiKey: process.env.DEEPSEEK_API_KEY,
    configuration: {
      baseURL: process.env.DEEPSEEK_BASE_URL,
    },
  });

  const agent = createReactAgent({
    llm: model,
    tools: tools || ALL_TOOLS,
    // 系统提示作为 prompt
    prompt: systemPrompt,
  });

  return agent;
}

/**
 * 创建推理模型实例（深度推理模式，无工具）
 *
 * deepseek-reasoner 会返回 reasoning_content（思考链），
 * 但不支持 function calling，所以不使用 Agent。
 */
export function createReasoningModel() {
  return new ChatOpenAI({
    model: "deepseek-reasoner",
    apiKey: process.env.DEEPSEEK_API_KEY,
    configuration: {
      baseURL: process.env.DEEPSEEK_BASE_URL,
    },
  });
}

/**
 * 运行 Agent 并收集最终回复
 * 支持流式回调
 */
export async function runAgent(
  agent: ReturnType<typeof createAgent>,
  messages: BaseMessage[],
  onToken?: (token: string) => void,
  onToolCall?: () => void
): Promise<string> {
  let fullReply = "";
  let toolCallNotified = false;

  // 使用 streamEvents 获取细粒度的流式事件
  const eventStream = agent.streamEvents(
    { messages },
    { version: "v2" }
  );

  for await (const event of eventStream) {
    // 检测工具调用开始
    if (event.event === "on_tool_start" && !toolCallNotified) {
      toolCallNotified = true;
      onToolCall?.();
    }

    // 捕获 LLM 的流式 token 输出
    if (event.event === "on_chat_model_stream") {
      const chunk = event.data?.chunk;
      if (chunk) {
        const content =
          typeof chunk.content === "string" ? chunk.content : "";
        if (content) {
          // 只收集最后一轮（非工具调用轮）的输出
          fullReply += content;
          onToken?.(content);
        }
      }
    }
  }

  return fullReply;
}
