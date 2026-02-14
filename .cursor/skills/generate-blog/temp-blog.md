到这一步，我们的 AI 已经有了不少能力：联网搜索、图片生成、图片理解、文件解析、长期记忆、知识库检索、数据库查询。但承载这些能力的核心循环——ReAct 模式，还是我们手写的 `while` 循环。

手写循环有什么问题？能用，但不好维护。随着工具越来越多、流程越来越复杂，手写的循环变得又长又脆弱。这节课我们用 LangGraph 重构它。

## 什么是 LangGraph

LangGraph 是 LangChain 团队开发的工作流编排框架。核心概念：

- **State（状态）**：流经图的数据，在我们的场景中是消息列表
- **Node（节点）**：处理状态的函数（调用 LLM、执行工具等）
- **Edge（边）**：节点之间的连接，支持条件分支

它把 Agent 的执行流程从"一段代码"变成"一张图"：

```
用户消息 → [LLM节点] → 判断是否需要工具？
                          ├── 是 → [工具节点] → 回到 LLM
                          └── 否 → 输出最终回答
```

## 重构前 vs 重构后

### 重构前：手写 while 循环

```typescript
// 伪代码，实际更复杂
let response = await modelWithTools.invoke(messages);
while (response.tool_calls?.length > 0) {
  for (const toolCall of response.tool_calls) {
    const result = await executeTool(toolCall);
    messages.push(new ToolMessage(result));
  }
  response = await modelWithTools.invoke(messages);
}
// 最后输出 response.content
```

问题：
1. 循环终止条件需要自己判断
2. 错误处理需要自己写
3. 流式输出需要自己处理
4. 加新逻辑（审批、人工介入）需要改循环内部

### 重构后：LangGraph createReactAgent

```typescript
import { createReactAgent } from "@langchain/langgraph/prebuilt";

export function createAgent(
  systemPrompt: string,
  temperature: number = 0.7,
  tools?: StructuredToolInterface[]
) {
  const model = new ChatOpenAI({
    model: "deepseek-chat",
    temperature,
    apiKey: process.env.DEEPSEEK_API_KEY,
    configuration: { baseURL: process.env.DEEPSEEK_BASE_URL },
  });

  return createReactAgent({
    llm: model,
    tools: tools || ALL_TOOLS,
    prompt: systemPrompt,
  });
}
```

整个 ReAct 循环——"LLM 判断 → 调工具 → 把结果喂回 → 再判断"——被 `createReactAgent` 一行封装了。

## streamEvents：细粒度的流式事件

LangGraph 最强大的特性之一是 `streamEvents`。它把 Agent 执行过程中的每个细节都暴露为事件：

```typescript
const eventStream = agent.streamEvents(
  { messages: inputMessages },
  { version: "v2" }
);

for await (const event of eventStream) {
  switch (event.event) {
    case "on_tool_start":
      // 工具开始调用 → 通知前端"正在查询"
      console.log(`🔧 调用工具: ${event.name}`, event.data?.input);
      controller.enqueue(encoder.encode("> 🔍 正在查询中...\n\n"));
      break;

    case "on_tool_end":
      // 工具调用完成 → 拿到结果
      const result = event.data?.output?.content;
      console.log(`📋 工具结果: ${result?.slice(0, 300)}`);
      break;

    case "on_chat_model_stream":
      // LLM 逐字输出 → 流式推给前端
      const token = event.data?.chunk?.content;
      if (token) lastAIContent += token;
      break;

    case "on_chat_model_end":
      // LLM 一轮回复完成 → 判断是工具调用还是最终回答
      const hasToolCalls = event.data?.output?.tool_calls?.length > 0;
      if (!hasToolCalls && lastAIContent) {
        // 最终回答，推给前端
        fullReply = lastAIContent;
        controller.enqueue(encoder.encode(lastAIContent));
      }
      break;
  }
}
```

事件类型说明：

| 事件 | 含义 | 用途 |
|------|------|------|
| `on_tool_start` | 工具开始执行 | 显示加载状态 |
| `on_tool_end` | 工具执行完毕 | 日志记录、展示来源 |
| `on_chat_model_stream` | LLM 输出一个 token | 流式显示 |
| `on_chat_model_end` | LLM 一轮输出完成 | 判断是否为最终回答 |

## 区分工具调用轮和最终回答轮

ReAct Agent 的 LLM 会被调用多次：第一次可能决定调工具，拿到工具结果后再被调用一次生成最终回答。我们只想把最终回答推给用户。

判断方式：

```typescript
if (event.event === "on_chat_model_end") {
  const hasToolCalls = event.data?.output?.tool_calls?.length > 0;

  if (!hasToolCalls && lastAIContent) {
    // 没有工具调用 = 这是最终回答
    fullReply = lastAIContent;
    // 推给前端...
  }

  // 重置，准备下一轮
  lastAIContent = "";
}
```

如果 LLM 的输出包含 `tool_calls`，说明这轮是"决定调工具"，不是最终回答，跳过。只有没有 `tool_calls` 的那轮才是给用户的最终回复。

## 动态工具注入

重构后的 `createAgent` 接受可选的 `tools` 参数，这让工具动态加载成为可能：

```typescript
export function createAgent(
  systemPrompt: string,
  temperature: number = 0.7,
  tools?: StructuredToolInterface[]  // 可选自定义工具列表
) {
  return createReactAgent({
    llm: model,
    tools: tools || ALL_TOOLS,
  });
}

// 使用时按需过滤
const tools = webSearchEnabled
  ? ALL_TOOLS
  : ALL_TOOLS.filter((t) => t !== webSearchTool);

const agent = createAgent(systemPrompt, 0.7, tools);
```

这个能力让我们后续能做"联网搜索开关"——用户可以自己控制是否启用搜索。

## 为什么用 createReactAgent 而不是自己建图？

LangGraph 提供了底层的 `StateGraph` API，可以自己定义节点和边。但对于标准的 ReAct 模式，`createReactAgent` 是更好的选择：

1. **内置 ReAct 流程**：不用自己画图，工具调用循环自动处理
2. **内置容错**：工具执行出错会被优雅地处理
3. **支持 streamEvents**：不需要额外配置
4. **简洁**：两行代码搞定

如果未来需要更复杂的流程（比如加审批节点、并行执行、条件分支），再用 `StateGraph` 不迟。

## 踩过的坑

### Next.js 打包问题

`@langchain/langgraph` 需要加到 `serverExternalPackages`：

```typescript
// next.config.ts
serverExternalPackages: ["pdf-parse", "xlsx", "@langchain/langgraph"]
```

否则 Webpack 打包时会报各种模块找不到的错误。

### streamEvents 版本

`streamEvents` 需要指定 `version: "v2"`。v1 和 v2 的事件格式不同，v2 是推荐版本：

```typescript
agent.streamEvents({ messages }, { version: "v2" })
```

### 工具调用类型

`createAgent` 的 `tools` 参数类型需要是 `StructuredToolInterface[]`（从 `@langchain/core/tools` 导入），不是普通数组。

## 总结

LangGraph 重构的核心价值：

1. **代码更简洁**：手写循环变成 `createReactAgent` 一行
2. **事件更透明**：`streamEvents` 暴露了每个执行细节
3. **扩展更方便**：动态工具注入、未来加节点都很容易
4. **错误更健壮**：框架内置了容错机制

从手写 while 循环到 LangGraph，本质是从"命令式编程"到"声明式编排"的转变。我们告诉框架"用这些工具、用这个提示"，框架负责"怎么循环、怎么判断、怎么处理错误"。

至此，我们的 AI 智能体有了完整的架构：LangGraph 编排工作流，10 个工具各司其职，长期记忆跨会话记住用户。下一步就是接入微信，让它真正"活"起来。
