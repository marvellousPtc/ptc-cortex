/**
 * ========== 长期记忆 ==========
 *
 * 短期记忆（已有）：SQLite 存最近 20 条消息，会话级别
 * 长期记忆（本模块）：提取对话中的关键事实，跨会话持久保存
 *
 * 工作原理：
 * 1. 对话结束后，用 AI 从对话中提取关键信息（偏好、事实、重要决定等）
 * 2. 将提取的记忆存入 SQLite（带关键词，方便检索）
 * 3. 新对话开始时，根据用户输入搜索相关记忆，注入到 system prompt
 *
 * 这样 AI 就能"记住"用户的偏好：
 * - "你之前说喜欢吃川菜"
 * - "你的项目用的是 Next.js + TypeScript"
 * - "你养了一只叫咪咪的猫"
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "chat.db");
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initMemoryTable();
  }
  return db;
}

function initMemoryTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS long_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      content TEXT NOT NULL,
      keywords TEXT NOT NULL DEFAULT '',
      importance TEXT NOT NULL DEFAULT 'normal',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_memories_keywords ON long_memories(keywords);
  `);
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
export function saveMemory(
  sessionId: string,
  content: string,
  keywords: string,
  importance: string = "normal"
): void {
  const database = getDb();
  database
    .prepare(
      "INSERT INTO long_memories (session_id, content, keywords, importance) VALUES (?, ?, ?, ?)"
    )
    .run(sessionId, content, keywords, importance);
  console.log(`🧠 保存长期记忆: ${content.slice(0, 50)}...`);
}

/**
 * 搜索相关记忆
 * 使用简单的关键词匹配（LIKE 查询）
 */
export function searchMemories(query: string, limit: number = 5): LongMemory[] {
  const database = getDb();

  // 分词：把查询拆成关键词
  const tokens = query
    .replace(/[，。！？、；：""''（）【】\s\n\r]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  if (tokens.length === 0) return [];

  // 用 LIKE 搜索每个关键词（匹配 content 和 keywords 字段）
  const conditions = tokens
    .map(
      () => "(content LIKE ? OR keywords LIKE ?)"
    )
    .join(" OR ");

  const params = tokens.flatMap((t) => [`%${t}%`, `%${t}%`]);

  const memories = database
    .prepare(
      `SELECT * FROM long_memories WHERE ${conditions} ORDER BY 
       CASE importance WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
       created_at DESC
       LIMIT ?`
    )
    .all(...params, limit) as LongMemory[];

  return memories;
}

/**
 * 获取所有记忆（调试用）
 */
export function getAllMemories(): LongMemory[] {
  const database = getDb();
  return database
    .prepare("SELECT * FROM long_memories ORDER BY created_at DESC LIMIT 100")
    .all() as LongMemory[];
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
