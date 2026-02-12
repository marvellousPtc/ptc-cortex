## 背景

用 LangChain + Next.js 搭建 AI 聊天机器人的过程中，踩了不少坑。这些坑有的是文档过时、有的是环境差异、有的是架构设计的暗坑。记录下来，希望后来人能少走弯路。

## 坑 1：MemoryVectorStore 导入路径变了

### 现象

按照 LangChain 文档写的导入：

```typescript
import { MemoryVectorStore } from "langchain/vectorstores/memory";
```

直接报错：

```
Module not found: Can't resolve 'langchain/vectorstores/memory'
```

### 原因

LangChain JS 做过一次大的拆包重构，很多模块从 `langchain` 主包移到了独立子包。`MemoryVectorStore` 被移到了 `@langchain/classic` 包里，但官方文档没有全部更新。

### 解决

安装新包，换导入路径：

```bash
pnpm add @langchain/classic
```

```typescript
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
```

### 教训

LangChain JS 版本迭代很快，文档经常跟不上代码。遇到 `Module not found` 先去 npm 搜包名，看看是不是被移走了。

## 坑 2：HuggingFace 模型下载超时

### 现象

首次运行 RAG 时，`@huggingface/transformers` 需要下载 Embedding 模型（`Xenova/all-MiniLM-L6-v2`，约 23MB）。在国内网络环境下，直连 HuggingFace 会超时：

```
ConnectTimeoutError: Connect Timeout Error
  at connTimeout (node:internal/deps/undici/undici:...)
```

等了好几分钟，最后超时失败。

### 原因

HuggingFace 的服务器在国外，国内直连不稳定，小模型 23MB 的下载都可能失败。

### 解决

`@huggingface/transformers` 支持设置镜像源。在代码中加一行：

```typescript
const { pipeline, env } = await import("@huggingface/transformers");
env.remoteHost = "https://hf-mirror.com";  // 使用国内镜像
```

`hf-mirror.com` 是 HuggingFace 的国内镜像站，下载速度从几 KB/s 变成了几 MB/s，几秒就搞定了。

### 教训

用到海外资源（HuggingFace、npm 某些包、Docker 镜像等）时，国内环境要优先考虑镜像源。

## 坑 3：HuggingFaceTransformersEmbeddings 类不可用

### 现象

LangChain 文档推荐使用 `HuggingFaceTransformersEmbeddings` 类来做本地 Embedding：

```typescript
import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/hf_transformers";
```

但实际运行时报错或行为异常。

### 原因

这个类依赖的 `@xenova/transformers` 包已经被重命名为 `@huggingface/transformers`，内部 API 也有变化。LangChain 社区包的适配没跟上。

### 解决

自己封装一个 `LocalEmbeddings` 类，直接用 `@huggingface/transformers`：

```typescript
class LocalEmbeddings extends Embeddings {
  private pipe: any = null;

  private async getPipeline() {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.remoteHost = "https://hf-mirror.com";
    this.pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "fp32" });
    return this.pipe;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const pipe = await this.getPipeline();
    const results: number[][] = [];
    for (const text of texts) {
      const output = await pipe(text, { pooling: "mean", normalize: true });
      results.push(Array.from(output.data as Float32Array));
    }
    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [result] = await this.embedDocuments([text]);
    return result;
  }
}
```

代码量不多，而且更可控 —— 你知道每一步在做什么。

### 教训

第三方封装出问题时，不要死磕，直接看底层库的 API 自己封装一个。代码量可能就多十几行，但稳定性高得多。

## 坑 4：SSH 隧道端口冲突

### 现象

连接远端 PostgreSQL 时，先想通过 SSH 隧道转发：

```bash
ssh -L 5432:127.0.0.1:5432 root@8.134.248.1 -N
```

报错：

```
bind [127.0.0.1]:5432: Address already in use
channel_setup_fwd_listener_tcpip: cannot listen to port: 5432
```

### 原因

本地已经有一个 PostgreSQL 在跑（或者其他程序占了 5432 端口），所以 SSH 隧道无法绑定这个端口。

### 解决

换一个本地端口：

```bash
ssh -L 15432:127.0.0.1:5432 root@8.134.248.1 -N
```

然后更新 `.env.local`：

```
DATABASE_URL=postgresql://user:pass@127.0.0.1:15432/your_db
```

### 教训

SSH 隧道的本地端口是可以随便选的（只要不冲突），不一定要和远端端口一样。用一个高位端口（如 15432、25432）能避免大部分冲突。

## 坑 5：Tool Calling 最终回答被截断

### 现象

问 AI「我今天写了几篇博客」，它查到了数量（3 篇），回答说「让我再查一下具体是哪些文章」，然后就卡住了 —— 具体文章列表没查出来。

### 原因

原来的代码在 ReAct 循环里有个设计缺陷：

```typescript
while (maxIterations > 0) {
  const response = await modelWithTools.invoke(currentMessages);  // 第一次调用
  
  if (response.tool_calls) {
    // 执行工具...
    continue;
  }
  
  // 没有 tool_calls → 重新 stream 获取最终回答
  const finalStream = await model.stream(currentMessages);  // 第二次调用！！
  // ...
}
```

问题出在「两次调用」：

1. `invoke()` 返回的结果说「不需要调工具了」，但我们把这个结果**扔掉了**
2. 又发了一次 `stream()` 请求，这是一次全新的 API 调用
3. 第二次调用可能产生完全不同的回答 —— 比如又想调工具但走的是流式输出，没法正确处理 tool_calls

而且 `model.stream()` 用的是没绑工具的模型实例，即使 AI 想调工具也调不了。

### 解决

不再做两次调用。`invoke()` 返回最终回答时，直接用 `response.content`：

```typescript
while (maxIterations > 0) {
  const response = await modelWithTools.invoke(currentMessages);
  
  if (response.tool_calls && response.tool_calls.length > 0) {
    // 执行工具...
    continue;
  }
  
  // 直接用 invoke 返回的内容，不再重新请求
  const finalText = typeof response.content === "string" ? response.content : "";
  if (finalText) {
    // 模拟流式效果：分段发送
    const chunkSize = 5;
    for (let i = 0; i < finalText.length; i += chunkSize) {
      controller.enqueue(encoder.encode(finalText.slice(i, i + chunkSize)));
    }
  }
  break;
}
```

### 教训

LLM API 调用**不是幂等的** —— 同样的输入，两次调用可能返回不同的结果。在 ReAct 循环中，拿到一个满意的结果就直接用，不要扔掉重来。

## 坑 6：better-sqlite3 原生模块编译问题

### 现象

安装 `better-sqlite3`（SQLite 的 Node.js 绑定）后，pnpm 报警告：

```
Ignored build scripts: better-sqlite3
```

运行时找不到编译后的 `.node` 文件，模块加载失败。

### 原因

pnpm 默认不执行依赖包的构建脚本（安全考虑），但 `better-sqlite3` 是原生 C++ 模块，必须编译才能用。

### 解决

手动触发编译：

```bash
pnpm rebuild better-sqlite3
```

同时在 `next.config.ts` 中把它排除出 webpack 打包：

```typescript
const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
};
```

### 教训

Node.js 原生模块（C++ addon）和普通 JS 包不一样，需要编译。用 pnpm 时要注意它的安全策略可能会跳过编译步骤。

## 总结

这些坑分为几类：

| 类型 | 具体问题 | 本质原因 |
|---|---|---|
| 包管理 | MemoryVectorStore 路径变化 | LangChain 拆包重构，文档滞后 |
| 网络环境 | HuggingFace 下载超时 | 国内网络对海外资源不友好 |
| 依赖适配 | HuggingFaceTransformersEmbeddings 失效 | 上游库重命名，社区包没跟上 |
| 系统冲突 | SSH 隧道端口被占 | 本地已有服务占用端口 |
| 架构设计 | Tool Calling 回答截断 | 双重 API 调用导致不一致 |
| 原生模块 | better-sqlite3 编译失败 | pnpm 安全策略跳过构建脚本 |

最大的感受：**LangChain 的 JS 生态还在快速迭代中**，文档和实际代码经常有出入。遇到问题时，比起搜文档，直接去 npm 搜包、去 GitHub 看源码往往更快找到答案。
