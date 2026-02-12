/*
 * :file description: 
 * :name: /langchain-chat/src/lib/tools.ts
 * :author: PTC
 * :copyright: (c) 2026, Tungee
 * :date created: 2026-02-12 10:27:29
 * :last editor: PTC
 * :date last edited: 2026-02-12 14:09:57
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * ========== 第五课：Tool Calling（工具调用） ==========
 *
 * LangChain 定义工具有三种方式：
 *   1. tool() 函数 —— 最简单，适合简单工具（我们用这种）
 *   2. DynamicTool —— 动态创建，入参是字符串
 *   3. StructuredTool —— 类的方式，适合复杂工具
 *
 * 每个工具需要：
 *   - name: 工具名（AI 通过名字来决定调哪个）
 *   - description: 描述（AI 通过描述来判断什么时候用）
 *   - schema: 入参结构（用 zod 定义，AI 会按格式传参）
 *   - 函数体: 工具的实际逻辑
 *
 * 关键认知：AI 不会执行工具！它只是"说"我要调用某个工具、传这些参数。
 * 执行是我们代码做的，然后把结果喂回给 AI。
 */

// ===== 工具 1：获取当前时间 =====
// 大模型不知道"现在"是什么时候，这个工具让它能回答时间相关问题
export const getCurrentTimeTool = tool(
  async () => {
    const now = new Date();
    return now.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "long",
    });
  },
  {
    name: "get_current_time",
    description: "获取当前的日期和时间。当用户询问现在几点、今天是几号、今天星期几等时间相关问题时使用。",
    // 这个工具不需要参数，schema 传空对象
    schema: z.object({}),
  }
);

// ===== 工具 2：数学计算器 =====
// 大模型算数经常出错，让它把计算交给真正的计算器
export const calculatorTool = tool(
  async ({ expression }) => {
    try {
      // 安全地计算数学表达式（只允许数字和运算符）
      const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, "");
      if (!sanitized) return "无效的数学表达式";
      // 使用 Function 构造器执行计算（比 eval 稍安全）
      const result = new Function(`return (${sanitized})`)();
      return `${expression} = ${result}`;
    } catch {
      return `计算出错: 无法计算 "${expression}"`;
    }
  },
  {
    name: "calculator",
    description:
      "数学计算器。当用户需要进行数学计算时使用，比如加减乘除、百分比等。传入数学表达式，返回计算结果。",
    schema: z.object({
      expression: z.string().describe("要计算的数学表达式，例如 '127 * 389' 或 '(100 + 50) * 0.8'"),
    }),
  }
);

// ===== 工具 3：天气查询（模拟） =====
// 实际项目中这里会调真实的天气 API
// 但为了学习，我们先用模拟数据，重点理解工具调用机制
export const weatherTool = tool(
  async ({ city }) => {
    // 模拟天气数据（实际应该调天气 API）
    const mockWeather: Record<string, string> = {
      北京: "晴，气温 -2°C ~ 8°C，北风3级，空气质量良",
      上海: "多云，气温 5°C ~ 12°C，东南风2级，空气质量优",
      广州: "阴，气温 15°C ~ 22°C，微风，空气质量优",
      深圳: "多云转晴，气温 16°C ~ 24°C，东风2级，空气质量优",
      杭州: "小雨，气温 4°C ~ 10°C，北风2级，空气质量良",
      成都: "阴，气温 6°C ~ 13°C，微风，空气质量轻度污染",
    };
    return mockWeather[city] || `抱歉，暂未收录「${city}」的天气数据。目前支持的城市：${Object.keys(mockWeather).join("、")}`;
  },
  {
    name: "get_weather",
    description:
      "查询指定城市的天气情况。当用户询问某个城市的天气时使用。",
    schema: z.object({
      city: z.string().describe("要查询天气的城市名，例如 '北京'、'上海'"),
    }),
  }
);

// ===== 工具 4：知识库搜索（RAG） =====
// 这就是 RAG 作为工具的实现 —— AI 需要查公司资料时自动调用
import { searchKnowledge } from "./rag";

export const knowledgeBaseTool = tool(
  async ({ query }) => {
    return await searchKnowledge(query, 3);
  },
  {
    name: "search_knowledge_base",
    description:
      "搜索公司知识库。当用户询问公司制度、产品信息、报销政策、考勤规则、请假制度等公司相关问题时使用。" +
      "传入搜索关键词，返回相关的文档内容。",
    schema: z.object({
      query: z.string().describe("搜索关键词，例如 '年假几天'、'StarChat 价格'、'报销流程'"),
    }),
  }
);

// ===== 工具 5：联网搜索 =====
// 让 AI 能搜索互联网回答实时问题
import { webSearch } from "./search";

export const webSearchTool = tool(
  async ({ query }) => {
    return await webSearch(query, 5);
  },
  {
    name: "web_search",
    description:
      "搜索互联网获取实时信息。当用户询问最新新闻、实时信息、你不确定的知识点、" +
      "或任何需要联网才能回答的问题时使用。传入搜索关键词，返回搜索结果摘要。",
    schema: z.object({
      query: z.string().describe("搜索关键词，例如 '2024年春节放假安排'、'TypeScript 5.0 新特性'"),
    }),
  }
);

// ===== 工具 6：图片生成 =====
// 接入硅基流动 API，让 AI 能生成图片
import { generateImage } from "./image-gen";

export const imageGenerationTool = tool(
  async ({ prompt }) => {
    const result = await generateImage(prompt);
    // 如果是 URL，用 Markdown 图片格式返回，前端会自动渲染
    if (result.startsWith("http")) {
      return `![${prompt}](${result})`;
    }
    return result;
  },
  {
    name: "generate_image",
    description:
      "根据文字描述生成图片。当用户要求画图、生成图片、创建图像时使用。" +
      "传入图片的描述（建议用英文描述效果更好），返回生成的图片。",
    schema: z.object({
      prompt: z
        .string()
        .describe("图片的详细描述，建议用英文。例如 'a cute cat sitting on a sofa, digital art style'"),
    }),
  }
);

// ===== 工具 7：图片理解 =====
// 用多模态模型分析图片内容
import { analyzeImage } from "./vision";

export const imageUnderstandingTool = tool(
  async ({ imageUrl, question }) => {
    return await analyzeImage(imageUrl, question);
  },
  {
    name: "analyze_image",
    description:
      "分析图片内容。当用户发送了图片 URL 并想了解图片内容时使用。" +
      "传入图片 URL 和用户的问题，返回对图片的分析描述。",
    schema: z.object({
      imageUrl: z.string().describe("图片的 URL 地址"),
      question: z
        .string()
        .describe("关于图片的问题，默认为'请详细描述这张图片的内容'")
        .default("请详细描述这张图片的内容"),
    }),
  }
);

// ===== 工具 8：文件解析 =====
// 解析上传的 PDF、Excel、CSV 等文件
import { parseFile } from "./file-parser";

export const fileParserTool = tool(
  async ({ filePath }) => {
    return await parseFile(filePath);
  },
  {
    name: "parse_file",
    description:
      "解析上传的文件。支持 PDF、Excel(.xlsx/.xls)、CSV、TXT、Markdown 等格式。" +
      "当用户上传了文件并想了解文件内容、提取数据或分析文档时使用。",
    schema: z.object({
      filePath: z.string().describe("文件路径，例如 /uploads/xxx.pdf"),
    }),
  }
);

// ===== 工具 9：博客数据库查询 =====
// 连接远端 PostgreSQL 数据库，让 AI 能回答关于博客的问题
import { getDatabaseSchema, executeReadOnlyQuery } from "./blog-db";

export const blogDbSchemaTool = tool(
  async () => {
    return await getDatabaseSchema();
  },
  {
    name: "get_blog_db_schema",
    description:
      "获取博客数据库的表结构。当用户询问博客相关的问题时，先调用此工具了解数据库有哪些表和字段，" +
      "然后再用 query_blog_db 工具编写 SQL 查询。",
    schema: z.object({}),
  }
);

export const blogDbQueryTool = tool(
  async ({ sql }) => {
    return await executeReadOnlyQuery(sql);
  },
  {
    name: "query_blog_db",
    description:
      "查询博客数据库（只读）。根据 get_blog_db_schema 获取的表结构编写 SELECT SQL 语句来查询数据。" +
      "可以回答的问题举例：'我今天写了几篇博客'、'最近发布的文章'、'有多少篇已发布的文章'等。" +
      "只允许 SELECT 查询，不能修改数据。",
    schema: z.object({
      sql: z.string().describe("要执行的 SELECT SQL 语句，例如 SELECT COUNT(*) FROM articles WHERE created_at >= CURRENT_DATE"),
    }),
  }
);

// 所有工具的集合
export const ALL_TOOLS = [
  getCurrentTimeTool,
  calculatorTool,
  weatherTool,
  knowledgeBaseTool,
  webSearchTool,
  imageGenerationTool,
  imageUnderstandingTool,
  fileParserTool,
  blogDbSchemaTool,
  blogDbQueryTool,
];
