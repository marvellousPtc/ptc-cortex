/**
 * ========== 长期记忆（PostgreSQL 版） ==========
 *
 * 短期记忆（已有）：PG 存最近 20 条消息，会话级别
 * 长期记忆（本模块）：提取对话中的关键事实，跨会话持久保存
 *
 * 工作原理：
 * 1. 对话结束后，用 AI 从对话中提取关键信息（偏好、事实、重要决定等）
 * 2. 将提取的记忆存入 PostgreSQL（带关键词，方便检索）
 * 3. 新对话开始时，根据用户输入搜索相关记忆，注入到 system prompt
 *
 * 这样 AI 就能"记住"用户的偏好：
 * - "你之前说喜欢吃川菜"
 * - "你的项目用的是 Next.js + TypeScript"
 * - "你养了一只叫咪咪的猫"
 */

import { getPool } from "./pg";

// 标记是否已初始化表
let tableInitialized = false;

async function ensureMemoryTable() {
  if (tableInitialized) return;

  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_long_memories (
      id SERIAL PRIMARY KEY,
      session_id TEXT,
      content TEXT NOT NULL,
      keywords TEXT NOT NULL DEFAULT '',
      importance TEXT NOT NULL DEFAULT 'normal',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_chat_memories_keywords ON chat_long_memories(keywords);
  `);
  tableInitialized = true;
}

export interface LongMemory {
  id: number;
  session_id: string;
  content: string;
  keywords: string;
  importance: string;
  created_at: string;
}

/**
 * 保存一条长期记忆
 */
export async function saveMemory(
  sessionId: string,
  content: string,
  keywords: string,
  importance: string = "normal"
): Promise<void> {
  await ensureMemoryTable();
  const pool = getPool();
  await pool.query(
    "INSERT INTO chat_long_memories (session_id, content, keywords, importance) VALUES ($1, $2, $3, $4)",
    [sessionId, content, keywords, importance]
  );
  console.log(`🧠 保存长期记忆: ${content.slice(0, 50)}...`);
}

/**
 * 搜索相关记忆
 * 使用简单的关键词匹配（LIKE 查询）
 */
export async function searchMemories(
  query: string,
  limit: number = 5
): Promise<LongMemory[]> {
  await ensureMemoryTable();
  const pool = getPool();

  // 分词：把查询拆成关键词
  const tokens = query
    .replace(/[，。！？、；：""''（）【】\s\n\r]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  if (tokens.length === 0) return [];

  // 用 LIKE 搜索每个关键词（匹配 content 和 keywords 字段）
  // PG 参数占位符：$1, $2, $3, ...
  const conditions: string[] = [];
  const params: string[] = [];
  let paramIndex = 1;

  for (const token of tokens) {
    conditions.push(
      `(content LIKE $${paramIndex} OR keywords LIKE $${paramIndex + 1})`
    );
    params.push(`%${token}%`, `%${token}%`);
    paramIndex += 2;
  }

  const { rows } = await pool.query(
    `SELECT * FROM chat_long_memories WHERE ${conditions.join(" OR ")} ORDER BY
     CASE importance WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
     created_at DESC
     LIMIT $${paramIndex}`,
    [...params, limit]
  );

  return rows as LongMemory[];
}

/**
 * 获取所有记忆（调试用）
 */
export async function getAllMemories(): Promise<LongMemory[]> {
  await ensureMemoryTable();
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM chat_long_memories ORDER BY created_at DESC LIMIT 100"
  );
  return rows as LongMemory[];
}

/**
 * 格式化记忆为 prompt 注入文本
 */
export function formatMemoriesForPrompt(memories: LongMemory[]): string {
  if (memories.length === 0) return "";

  const memoryTexts = memories.map((m) => `- ${m.content}`).join("\n");

  return (
    "\n\n[长期记忆 - 你记得关于这个用户的以下信息]\n" +
    memoryTexts +
    "\n[请在回答时自然地参考这些信息，但不要刻意提及'我记得'，除非用户主动问起]"
  );
}
