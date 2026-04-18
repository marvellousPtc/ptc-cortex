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

    -- 消息树：parent_id 形成分支结构，用于编辑/重新生成时保留历史版本
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES chat_messages(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_chat_messages_parent ON chat_messages(parent_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);

    -- 会话当前活跃叶子节点：UI 从这个叶子沿 parent_id 回溯得到当前对话链
    ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS active_leaf_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL;

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

    -- AI 用量表：每次调用 AI 记一行，用 (user_id, date) 做每日次数限流
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS ai_usage (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      date DATE NOT NULL,
      endpoint TEXT NOT NULL DEFAULT 'chat',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date ON ai_usage(user_id, date);
  `);

  // 一次性回填：给旧数据中没有 parent_id 的消息按时间顺序补上链式指针
  await pool.query(`
    WITH ordered AS (
      SELECT id, session_id,
             LAG(id) OVER (PARTITION BY session_id ORDER BY created_at ASC, id ASC) AS prev_id
      FROM chat_messages
      WHERE session_id IN (
        SELECT DISTINCT session_id FROM chat_messages WHERE parent_id IS NULL
      )
    )
    UPDATE chat_messages m
    SET parent_id = o.prev_id
    FROM ordered o
    WHERE m.id = o.id AND o.prev_id IS NOT NULL AND m.parent_id IS NULL;
  `);

  // 一次性回填：给没有 active_leaf_id 的会话指向最新消息
  await pool.query(`
    UPDATE chat_sessions s
    SET active_leaf_id = latest.id
    FROM (
      SELECT DISTINCT ON (session_id) session_id, id
      FROM chat_messages
      ORDER BY session_id, created_at DESC, id DESC
    ) latest
    WHERE s.id = latest.session_id AND s.active_leaf_id IS NULL;
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
  active_leaf_id: number | null;
}

export interface Message {
  id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  parent_id: number | null;
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

/** 添加一条消息（可选指定 parent_id 以形成分支），并把会话的 active_leaf_id 指向新节点 */
export async function addMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  parentId: number | null = null
): Promise<Message> {
  await ensureTables();
  const pool = getPool();
  const { rows } = await pool.query(
    "INSERT INTO chat_messages (session_id, role, content, parent_id) VALUES ($1, $2, $3, $4) RETURNING *",
    [sessionId, role, content, parentId]
  );
  const msg = rows[0] as Message;

  // 同时更新会话的 updated_at 和 active_leaf_id（新消息即当前叶子）
  await pool.query(
    "UPDATE chat_sessions SET updated_at = NOW(), active_leaf_id = $2 WHERE id = $1",
    [sessionId, msg.id]
  );

  return msg;
}

/**
 * 从会话的 active_leaf_id 沿 parent_id 向上回溯，得到当前活跃的消息链（按时间正序）
 * 如果会话没有 active_leaf_id（空会话），返回 []
 */
export async function getActiveMessages(
  sessionId: string
): Promise<Message[]> {
  await ensureTables();
  const pool = getPool();
  const { rows } = await pool.query(
    `WITH RECURSIVE chain AS (
       SELECT m.* FROM chat_messages m
       JOIN chat_sessions s ON s.id = m.session_id
       WHERE s.id = $1 AND m.id = s.active_leaf_id
       UNION ALL
       SELECT m.* FROM chat_messages m
       JOIN chain c ON m.id = c.parent_id
     )
     SELECT * FROM chain ORDER BY created_at ASC, id ASC`,
    [sessionId]
  );
  return rows as Message[];
}

/**
 * 返回某条消息所有共享同一 parent_id 的兄弟（含自身），按创建时间排序
 * 用于前端渲染 `< 2/3 >` 版本切换器
 */
export async function getSiblings(messageId: number): Promise<Message[]> {
  await ensureTables();
  const pool = getPool();
  const { rows: self } = await pool.query(
    "SELECT session_id, parent_id FROM chat_messages WHERE id = $1",
    [messageId]
  );
  if (!self[0]) return [];
  const { session_id, parent_id } = self[0] as {
    session_id: string;
    parent_id: number | null;
  };

  if (parent_id === null) {
    // 根消息：同一 session 下所有 parent_id IS NULL 的消息
    const { rows } = await pool.query(
      "SELECT * FROM chat_messages WHERE session_id = $1 AND parent_id IS NULL ORDER BY created_at ASC, id ASC",
      [session_id]
    );
    return rows as Message[];
  }
  const { rows } = await pool.query(
    "SELECT * FROM chat_messages WHERE parent_id = $1 ORDER BY created_at ASC, id ASC",
    [parent_id]
  );
  return rows as Message[];
}

/**
 * 切换分支：把会话 active_leaf_id 指向目标节点
 * 前端传进来的可能是中间节点，我们要沿其最新的子节点向下走到叶子
 */
export async function setActiveLeaf(
  sessionId: string,
  messageId: number,
  userId: string
): Promise<Message[]> {
  await ensureTables();
  const pool = getPool();

  // 鉴权：确保 session 属于该 user，消息属于该 session
  const { rows: check } = await pool.query(
    `SELECT m.id FROM chat_messages m
     JOIN chat_sessions s ON s.id = m.session_id
     WHERE m.id = $1 AND s.id = $2 AND s.user_id = $3`,
    [messageId, sessionId, userId]
  );
  if (!check[0]) throw new Error("消息不存在或无权访问");

  // 沿最新子节点向下走到叶子
  let leafId = messageId;
  while (true) {
    const { rows } = await pool.query(
      "SELECT id FROM chat_messages WHERE parent_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1",
      [leafId]
    );
    if (!rows[0]) break;
    leafId = rows[0].id;
  }

  await pool.query(
    "UPDATE chat_sessions SET active_leaf_id = $1 WHERE id = $2 AND user_id = $3",
    [leafId, sessionId, userId]
  );

  return await getActiveMessages(sessionId);
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

// ===== AI 用量限制 =====

const AI_DAILY_LIMIT = parseInt(process.env.AI_DAILY_LIMIT || "20", 10);

/** 检查用户是否为管理员（查 ink-and-code 共享的 users 表） */
export async function isUserAdmin(userId: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT is_admin FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  return rows[0]?.is_admin === true;
}

/** 获取用户今日 AI 使用次数 */
export async function getTodayUsageCount(userId: string): Promise<number> {
  await ensureTables();
  const pool = getPool();
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM ai_usage WHERE user_id = $1 AND date = $2`,
    [userId, today]
  );
  return rows[0]?.count ?? 0;
}

/** 记录一次 AI 使用 */
export async function recordAiUsage(
  userId: string,
  endpoint: string = "chat"
): Promise<void> {
  await ensureTables();
  const pool = getPool();
  const today = new Date().toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO ai_usage (id, user_id, date, endpoint, created_at) VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
    [userId, today, endpoint]
  );
}

/** 检查用量限制，返回 null 表示通过，否则返回错误信息 */
export async function checkRateLimit(
  userId: string,
  opts: { isDeveloper?: boolean } = {}
): Promise<{ error: string; remaining: number } | null> {
  if (opts.isDeveloper) return null;

  const admin = await isUserAdmin(userId);
  if (admin) return null;

  const used = await getTodayUsageCount(userId);
  if (used >= AI_DAILY_LIMIT) {
    return {
      error: `今日对话次数已用完（${AI_DAILY_LIMIT} 次/天），明天再来吧`,
      remaining: 0,
    };
  }
  return null;
}

/** 获取用量信息（供 API 返回给前端） */
export async function getUsageInfo(
  userId: string,
  opts: { isDeveloper?: boolean } = {}
) {
  const admin = await isUserAdmin(userId);
  const isDeveloper = !!opts.isDeveloper;
  const used = await getTodayUsageCount(userId);
  const unlimited = admin || isDeveloper;
  return {
    isAdmin: admin,
    isDeveloper,
    used,
    limit: unlimited ? -1 : AI_DAILY_LIMIT,
    remaining: unlimited ? -1 : Math.max(0, AI_DAILY_LIMIT - used),
  };
}

// ===== 工具函数 =====

/** 生成简短唯一 ID */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
