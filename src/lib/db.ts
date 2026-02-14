import { getPool } from "./pg";

/**
 * ========== 持久化记忆（PostgreSQL 版 · 按用户隔离） ==========
 *
 * 数据库设计：
 * - chat_sessions 表：管理会话，通过 user_id 隔离不同用户
 * - chat_messages 表：存储每条消息（关联到某个会话）
 * - chat_custom_personas 表：自定义角色，按 user_id 隔离
 */

// 标记是否已初始化表
let tablesInitialized = false;

/** 初始化表结构（幂等，多次调用安全） */
async function ensureTables() {
  if (tablesInitialized) return;

  const pool = getPool();
  await pool.query(`
    -- 会话表：每个对话一条记录，user_id 标识归属用户
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '新对话',
      persona TEXT NOT NULL DEFAULT 'assistant',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- 兼容已有表：如果 user_id 列不存在则添加
    ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT '';

    -- 用户索引
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);

    -- 消息表：每条聊天消息一条记录
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- 自定义角色表，user_id 标识归属用户
    CREATE TABLE IF NOT EXISTS chat_custom_personas (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '🤖',
      description TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL,
      temperature REAL NOT NULL DEFAULT 0.7,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- 兼容已有表
    ALTER TABLE chat_custom_personas ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS idx_chat_custom_personas_user ON chat_custom_personas(user_id);
  `);
  tablesInitialized = true;
}

// ===== 类型定义 =====

export interface Session {
  id: string;
  user_id: string;
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
  user_id: string;
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
  persona: string = "assistant",
  userId: string
): Promise<Session> {
  await ensureTables();
  const pool = getPool();
  const id = generateId();
  await pool.query(
    "INSERT INTO chat_sessions (id, user_id, persona) VALUES ($1, $2, $3)",
    [id, userId, persona]
  );
  return (await getSession(id, userId))!;
}

/** 获取单个会话（校验 user_id 防越权） */
export async function getSession(
  id: string,
  userId: string
): Promise<Session | undefined> {
  await ensureTables();
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM chat_sessions WHERE id = $1 AND user_id = $2",
    [id, userId]
  );
  return rows[0] as Session | undefined;
}

/** 获取某用户所有会话（按最近更新排序） */
export async function getAllSessions(userId: string): Promise<Session[]> {
  await ensureTables();
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM chat_sessions WHERE user_id = $1 ORDER BY updated_at DESC",
    [userId]
  );
  return rows as Session[];
}

/** 更新会话标题 */
export async function updateSessionTitle(
  id: string,
  title: string,
  userId: string
): Promise<void> {
  await ensureTables();
  const pool = getPool();
  await pool.query(
    "UPDATE chat_sessions SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3",
    [title, id, userId]
  );
}

/** 更新会话的人设 */
export async function updateSessionPersona(
  id: string,
  persona: string,
  userId: string
): Promise<void> {
  await ensureTables();
  const pool = getPool();
  await pool.query(
    "UPDATE chat_sessions SET persona = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3",
    [persona, id, userId]
  );
}

/** 删除会话（级联删除消息，校验 user_id） */
export async function deleteSession(
  id: string,
  userId: string
): Promise<void> {
  await ensureTables();
  const pool = getPool();
  await pool.query(
    "DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2",
    [id, userId]
  );
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
  temperature: number = 0.7,
  userId: string
): Promise<CustomPersona> {
  await ensureTables();
  const pool = getPool();
  const id = "custom_" + generateId();
  const { rows } = await pool.query(
    "INSERT INTO chat_custom_personas (id, user_id, name, emoji, description, prompt, temperature) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
    [id, userId, name, emoji, description, prompt, temperature]
  );
  return rows[0] as CustomPersona;
}

/** 获取某用户所有自定义角色 */
export async function getAllCustomPersonas(
  userId: string
): Promise<CustomPersona[]> {
  await ensureTables();
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM chat_custom_personas WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
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

/** 删除自定义角色（校验 user_id） */
export async function deleteCustomPersona(
  id: string,
  userId: string
): Promise<void> {
  await ensureTables();
  const pool = getPool();
  await pool.query(
    "DELETE FROM chat_custom_personas WHERE id = $1 AND user_id = $2",
    [id, userId]
  );
}

// ===== 工具函数 =====

/** 生成简短唯一 ID */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
