import { getPool } from "./pg";

/**
 * ========== 第四课：持久化记忆（PostgreSQL 版） ==========
 *
 * 改用 PostgreSQL 替代 SQLite：
 * - 不需要编译原生模块（告别 node-gyp）
 * - 和博客数据库共用一个 PG 实例，统一技术栈
 * - 天然支持多实例部署和并发
 *
 * 数据库设计：
 * - sessions 表：管理会话（对应微信里的"一个聊天窗口"）
 * - messages 表：存储每条消息（关联到某个会话）
 * - custom_personas 表：自定义角色
 */

// 标记是否已初始化表
let tablesInitialized = false;

/** 初始化表结构（幂等，多次调用安全） */
async function ensureTables() {
  if (tablesInitialized) return;

  const pool = getPool();
  await pool.query(`
    -- 会话表：每个对话一条记录
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '新对话',
      persona TEXT NOT NULL DEFAULT 'assistant',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- 消息表：每条聊天消息一条记录
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- 自定义角色表
    CREATE TABLE IF NOT EXISTS chat_custom_personas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '🤖',
      description TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL,
      temperature REAL NOT NULL DEFAULT 0.7,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  tablesInitialized = true;
}

// ===== 类型定义 =====

export interface Session {
  id: string;
  title: string;
  persona: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface CustomPersona {
  id: string;
  name: string;
  emoji: string;
  description: string;
  prompt: string;
  temperature: number;
  created_at: string;
}

// ===== 会话相关操作 =====

/** 创建新会话 */
export async function createSession(
  persona: string = "assistant"
): Promise<Session> {
  await ensureTables();
  const pool = getPool();
  const id = generateId();
  await pool.query(
    "INSERT INTO chat_sessions (id, persona) VALUES ($1, $2)",
    [id, persona]
  );
  return (await getSession(id))!;
}

/** 获取单个会话 */
export async function getSession(
  id: string
): Promise<Session | undefined> {
  await ensureTables();
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM chat_sessions WHERE id = $1",
    [id]
  );
  return rows[0] as Session | undefined;
}

/** 获取所有会话（按最近更新排序） */
export async function getAllSessions(): Promise<Session[]> {
  await ensureTables();
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM chat_sessions ORDER BY updated_at DESC"
  );
  return rows as Session[];
}

/** 更新会话标题 */
export async function updateSessionTitle(
  id: string,
  title: string
): Promise<void> {
  await ensureTables();
  const pool = getPool();
  await pool.query(
    "UPDATE chat_sessions SET title = $1, updated_at = NOW() WHERE id = $2",
    [title, id]
  );
}

/** 更新会话的人设 */
export async function updateSessionPersona(
  id: string,
  persona: string
): Promise<void> {
  await ensureTables();
  const pool = getPool();
  await pool.query(
    "UPDATE chat_sessions SET persona = $1, updated_at = NOW() WHERE id = $2",
    [persona, id]
  );
}

/** 删除会话（级联删除消息） */
export async function deleteSession(id: string): Promise<void> {
  await ensureTables();
  const pool = getPool();
  await pool.query("DELETE FROM chat_sessions WHERE id = $1", [id]);
}

// ===== 消息相关操作 =====

/** 添加一条消息 */
export async function addMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string
): Promise<Message> {
  await ensureTables();
  const pool = getPool();
  const { rows } = await pool.query(
    "INSERT INTO chat_messages (session_id, role, content) VALUES ($1, $2, $3) RETURNING *",
    [sessionId, role, content]
  );

  // 同时更新会话的 updated_at
  await pool.query(
    "UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1",
    [sessionId]
  );

  return rows[0] as Message;
}

/** 获取某个会话的所有消息 */
export async function getMessages(sessionId: string): Promise<Message[]> {
  await ensureTables();
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC",
    [sessionId]
  );
  return rows as Message[];
}

/** 获取某个会话最近 N 条消息（用于控制 token 用量） */
export async function getRecentMessages(
  sessionId: string,
  limit: number = 20
): Promise<Message[]> {
  await ensureTables();
  const pool = getPool();
  // 取最近 N 条，但要按时间正序返回
  const { rows } = await pool.query(
    `SELECT * FROM (
      SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2
    ) sub ORDER BY created_at ASC`,
    [sessionId, limit]
  );
  return rows as Message[];
}

// ===== 自定义角色操作 =====

/** 创建自定义角色 */
export async function createCustomPersona(
  name: string,
  emoji: string,
  description: string,
  prompt: string,
  temperature: number = 0.7
): Promise<CustomPersona> {
  await ensureTables();
  const pool = getPool();
  const id = "custom_" + generateId();
  const { rows } = await pool.query(
    "INSERT INTO chat_custom_personas (id, name, emoji, description, prompt, temperature) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
    [id, name, emoji, description, prompt, temperature]
  );
  return rows[0] as CustomPersona;
}

/** 获取所有自定义角色 */
export async function getAllCustomPersonas(): Promise<CustomPersona[]> {
  await ensureTables();
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM chat_custom_personas ORDER BY created_at DESC"
  );
  return rows as CustomPersona[];
}

/** 获取单个自定义角色 */
export async function getCustomPersona(
  id: string
): Promise<CustomPersona | undefined> {
  await ensureTables();
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM chat_custom_personas WHERE id = $1",
    [id]
  );
  return rows[0] as CustomPersona | undefined;
}

/** 删除自定义角色 */
export async function deleteCustomPersona(id: string): Promise<void> {
  await ensureTables();
  const pool = getPool();
  await pool.query("DELETE FROM chat_custom_personas WHERE id = $1", [id]);
}

// ===== 工具函数 =====

/** 生成简短唯一 ID */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
