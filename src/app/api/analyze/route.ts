/*
 * ========== 第七课：Output Parser（输出解析器） ==========
 *
 * 核心问题：AI 的输出是自由文本，但我们的代码需要结构化数据。
 *
 * LangChain 提供了几种 Output Parser：
 *
 *   1. StructuredOutputParser —— 用 Zod schema 约束输出为 JSON（我们用这个）
 *   2. StringOutputParser      —— 最简单，直接拿字符串
 *   3. CommaSeparatedListOutputParser —— 输出逗号分隔的列表
 *   4. JsonOutputParser        —— 输出任意 JSON
 *
 * 工作原理：
 *   1. 用 Zod 定义你想要的数据结构
 *   2. Parser 自动生成一段「格式说明」（format instructions）
 *   3. 把格式说明塞进 prompt，告诉 AI "请按这个格式输出"
 *   4. AI 输出后，Parser 自动解析 JSON 字符串 → JS 对象
 *
 * 流程：
 *   定义 Schema → 生成格式说明 → 拼入 Prompt → AI 回复 → Parser 解析 → 结构化对象
 */

import { NextRequest, NextResponse } from "next/server";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";

// ====== 第一步：用 Zod 定义你想要的输出结构 ======
// 这就是 Output Parser 的核心 —— 提前声明 AI 应该返回什么格式
const analysisSchema = z.object({
  summary: z
    .string()
    .describe("用一两句话概括文本的主要内容"),
  sentiment: z
    .enum(["positive", "negative", "neutral", "mixed"])
    .describe("文本的整体情感倾向：positive(积极), negative(消极), neutral(中性), mixed(混合)"),
  sentimentScore: z
    .number()
    .min(0)
    .max(1)
    .describe("情感强度分数，0-1 之间，越接近 1 表示情感越强烈"),
  keywords: z
    .array(z.string())
    .describe("文本中的 3-5 个关键词"),
  category: z
    .enum(["technology", "business", "life", "education", "news", "opinion", "other"])
    .describe("文本的分类：technology(科技), business(商业), life(生活), education(教育), news(新闻), opinion(观点), other(其他)"),
  language: z
    .enum(["zh", "en", "mixed"])
    .describe("文本的语言：zh(中文), en(英文), mixed(中英混合)"),
  wordCount: z
    .number()
    .describe("文本的大致字数"),
  readingTime: z
    .string()
    .describe("预计阅读时间，如 '约2分钟'"),
});

// 这个类型就是解析后的 JS 对象类型
type AnalysisResult = z.infer<typeof analysisSchema>;

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();

    if (!text || text.trim().length === 0) {
      return NextResponse.json(
        { error: "请输入要分析的文本" },
        { status: 400 }
      );
    }

    // ====== 第二步：创建 Parser，自动生成格式说明 ======
    const parser = StructuredOutputParser.fromZodSchema(analysisSchema);

    // parser.getFormatInstructions() 会返回一段文字，告诉 AI 应该怎么输出
    // 大概长这样：
    // "You must format your output as a JSON value that adheres to a given schema..."
    // "```json\n{ "summary": string, "sentiment": "positive" | "negative" | ... }\n```"
    const formatInstructions = parser.getFormatInstructions();

    // ====== 第三步：把格式说明拼入 Prompt ======
    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        "你是一个专业的文本分析助手。请认真分析用户提供的文本，并严格按照指定格式输出分析结果。\n\n{format_instructions}",
      ],
      [
        "human",
        "请分析以下文本：\n\n{text}",
      ],
    ]);

    const model = new ChatOpenAI({
      model: "deepseek-chat",
      temperature: 0.1, // 结构化输出用低温度，减少"创造力"，提高格式准确性
      apiKey: process.env.DEEPSEEK_API_KEY,
      configuration: {
        baseURL: process.env.DEEPSEEK_BASE_URL,
      },
    });

    // ====== 第四步：用 pipe 串联 Prompt → Model → Parser ======
    // 这就是 LangChain 的链式调用：
    //   prompt 格式化消息 → model 生成回复 → parser 解析 JSON
    const chain = prompt.pipe(model).pipe(parser);

    // ====== 第五步：执行链，拿到结构化结果 ======
    const result: AnalysisResult = await chain.invoke({
      format_instructions: formatInstructions,
      text: text,
    });

    // result 已经是一个类型安全的 JS 对象了！
    // { summary: "...", sentiment: "positive", sentimentScore: 0.85, ... }
    console.log("📊 分析结果:", result);

    return NextResponse.json({ analysis: result });
  } catch (error) {
    console.error("Analyze API Error:", error);

    // 如果 AI 输出格式不对，Parser 会报解析错误
    // 这种情况在低温度 + 好 prompt 下很少发生
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "分析失败", details: errorMessage },
      { status: 500 }
    );
  }
}
