import { Embeddings } from "@langchain/core/embeddings";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import fs from "fs";
import path from "path";

/**
 * ========== 第六课：RAG（检索增强生成） ==========
 *
 * 本模块实现了两种检索方案：
 *
 * 1. 向量检索（主方案）
 *    用 @huggingface/transformers 在本地运行 Embedding 模型，
 *    把文字转成向量，用余弦相似度搜索。
 *    优点：理解语义，"年假" ≈ "休假"
 *
 * 2. BM25 关键词检索（备用方案）
 *    经典信息检索算法，基于词频匹配。
 *    优点：零依赖，速度快
 *
 * 生产环境最佳实践：混合检索 = 向量检索 + BM25，先粗筛再精排。
 */

// ========================================
// 一、向量检索（@huggingface/transformers）
// ========================================

/**
 * 本地 Embedding 模型
 *
 * 用 @huggingface/transformers 在本地运行 all-MiniLM-L6-v2 模型
 * 这个模型只有 23MB，专门用于文本相似度计算，输出 384 维向量
 *
 * 第一次运行会自动下载模型并缓存，之后不需要再下载
 */
class LocalEmbeddings extends Embeddings {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null;

  constructor() {
    super({});
  }

  private async getPipeline() {
    if (!this.pipe) {
      console.log("🧠 正在加载 Embedding 模型（首次需要下载 ~23MB）...");
      const { pipeline, env } = await import("@huggingface/transformers");

      // 使用 HuggingFace 国内镜像，解决下载超时问题
      // 如果你能直连 HuggingFace，可以注释掉这行
      env.remoteHost = "https://hf-mirror.com";

      this.pipe = await pipeline(
        "feature-extraction",           // 任务类型：提取文本特征向量
        "Xenova/all-MiniLM-L6-v2",     // 模型：小巧高效的文本相似度模型
        { dtype: "fp32" }
      );
      console.log("🧠 Embedding 模型加载完成！");
    }
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

// ========================================
// 二、BM25 关键词检索（备用方案）
// ========================================

interface BM25Chunk {
  content: string;
  source: string;
  tokens: string[];
}

function tokenize(text: string): string[] {
  const stopWords = new Set([
    "的", "了", "在", "是", "我", "有", "和", "就",
    "不", "人", "都", "一", "一个", "上", "也", "很",
    "到", "说", "要", "去", "你", "会", "着", "没有",
    "看", "好", "自己", "这",
  ]);
  return text
    .replace(/[，。！？、；：""''（）【】\s\n\r]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w))
    .map((w) => w.toLowerCase());
}

function bm25Score(
  queryTokens: string[],
  docTokens: string[],
  avgDocLen: number,
  totalDocs: number,
  docFrequency: Map<string, number>
): number {
  const k1 = 1.5;
  const b = 0.75;
  const docLen = docTokens.length;
  const termFreq = new Map<string, number>();
  for (const token of docTokens) {
    termFreq.set(token, (termFreq.get(token) || 0) + 1);
  }
  let score = 0;
  for (const queryToken of queryTokens) {
    const tf = termFreq.get(queryToken) || 0;
    if (tf === 0) continue;
    const df = docFrequency.get(queryToken) || 0;
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
    const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLen)));
    score += idf * tfNorm;
  }
  return score;
}

// ========================================
// 三、知识库管理（统一入口）
// ========================================

let vectorStore: MemoryVectorStore | null = null;
let bm25Chunks: BM25Chunk[] = [];
let isInitialized = false;
let isInitializing = false;
let useVectorSearch = true; // 是否使用向量检索

/** 加载并切分文档（两种方案共用） */
async function loadAndSplitDocuments(): Promise<Document[]> {
  const knowledgeDir = path.join(process.cwd(), "knowledge");
  if (!fs.existsSync(knowledgeDir)) {
    console.log("⚠️ knowledge/ 目录不存在");
    return [];
  }

  const files = fs.readdirSync(knowledgeDir).filter((f) => f.endsWith(".txt"));
  const documents: Document[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(knowledgeDir, file), "utf-8");
    documents.push(new Document({ pageContent: content, metadata: { source: file } }));
  }
  console.log(`📄 加载了 ${documents.length} 个文档`);

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 300,
    chunkOverlap: 50,
  });
  const chunks = await splitter.splitDocuments(documents);
  console.log(`✂️  切分成 ${chunks.length} 个文本块`);

  return chunks;
}

/** 初始化知识库 */
async function initKnowledgeBase() {
  if (isInitialized) return;
  if (isInitializing) {
    while (isInitializing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return;
  }

  isInitializing = true;
  console.log("🔄 正在初始化知识库...");

  try {
    const chunks = await loadAndSplitDocuments();
    if (chunks.length === 0) {
      isInitialized = true;
      return;
    }

    // 先建 BM25 索引（一定能成功）
    bm25Chunks = chunks.map((doc) => ({
      content: doc.pageContent,
      source: doc.metadata.source as string,
      tokens: tokenize(doc.pageContent),
    }));

    // 再尝试向量检索（可能因为网络问题失败）
    try {
      console.log("🧠 正在构建向量索引...");
      const embeddings = new LocalEmbeddings();
      vectorStore = await MemoryVectorStore.fromDocuments(chunks, embeddings);
      useVectorSearch = true;
      console.log("✅ 知识库初始化完成（向量检索模式）！");
    } catch (error) {
      console.warn("⚠️ 向量检索初始化失败，回退到 BM25 模式:", error);
      useVectorSearch = false;
      console.log("✅ 知识库初始化完成（BM25 模式）！");
    }

    isInitialized = true;
  } finally {
    isInitializing = false;
  }
}

/** 向量检索 */
async function vectorSearch(query: string, topK: number): Promise<string> {
  if (!vectorStore) return "";
  const results = await vectorStore.similaritySearch(query, topK);
  if (results.length === 0) return "";
  return results
    .map((doc) => `【来源: ${doc.metadata.source} | 方式: 向量检索】\n${doc.pageContent}`)
    .join("\n\n---\n\n");
}

/** BM25 检索 */
function bm25Search(query: string, topK: number): string {
  if (bm25Chunks.length === 0) return "";
  const queryTokens = tokenize(query);
  const docFrequency = new Map<string, number>();
  for (const chunk of bm25Chunks) {
    const uniqueTokens = new Set(chunk.tokens);
    for (const token of uniqueTokens) {
      docFrequency.set(token, (docFrequency.get(token) || 0) + 1);
    }
  }
  const avgDocLen = bm25Chunks.reduce((sum, c) => sum + c.tokens.length, 0) / bm25Chunks.length;
  const scored = bm25Chunks.map((chunk) => ({
    ...chunk,
    score: bm25Score(queryTokens, chunk.tokens, avgDocLen, bm25Chunks.length, docFrequency),
  }));
  scored.sort((a, b) => b.score - a.score);
  const topResults = scored.slice(0, topK).filter((r) => r.score > 0);
  if (topResults.length === 0) return "";
  return topResults
    .map((r) => `【来源: ${r.source} | 方式: BM25 | 分数: ${r.score.toFixed(2)}】\n${r.content}`)
    .join("\n\n---\n\n");
}

/** 搜索知识库（对外暴露的统一接口） */
export async function searchKnowledge(query: string, topK: number = 3): Promise<string> {
  await initKnowledgeBase();

  if (bm25Chunks.length === 0) {
    return "知识库为空，请在 knowledge/ 目录下添加 .txt 文件。";
  }

  // 优先用向量检索，失败或不可用时回退 BM25
  if (useVectorSearch && vectorStore) {
    try {
      const result = await vectorSearch(query, topK);
      if (result) return result;
    } catch (error) {
      console.warn("向量检索出错，回退到 BM25:", error);
    }
  }

  const result = bm25Search(query, topK);
  if (result) return result;

  return "知识库中没有找到与问题相关的信息。";
}
