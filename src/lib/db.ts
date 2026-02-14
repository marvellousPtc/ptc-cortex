import Database from "better-sqlite3";
import path from "path";

/**
 * ========== 第四课：持久化记忆 ==========
 *
 * 为什么用 SQLite？
 * - 零配置：不需要装 MySQL/PostgreSQL，一个文件就是一个数据库
 * - 够用：对于单机的微信机器人，SQLite 性能绰绰有余
 * - 学习成本低：SQL 语法通用，以后迁移到其他数据库也方便
 *
 * 数据库设计：
 * - sessions 表：管理会话（对应微信里的"一个聊天窗口"）
 * - messages 表：存储每条消息（关联到某个会话）
 *
 * 未来接入微信时：
 * - 每个微信用户/群 = 一个 session
 * - session_id 可以用微信的 openid 或群 id
 */

// 数据库文件存在项目根目录的 data 文件夹里
const DB_PATH = path.join(process.cwd(), "data", "chat.db");

// 确保 data 目录存在
import fs from "fs";
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 创建数据库连接（单例模式，整个应用共享一个连接）
let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    // WAL 模式：并发性能更好（允许同时读写）
    db.pragma("journal_mode = WAL");
    initTables();
  }
  return db;
}

// 初始化表结构
function initTables() {
  db.exec(`
    -- 会话表：每个对话一条记录
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '新对话',
      persona TEXT NOT NULL DEFAULT 'assistant',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 消息表：每条聊天消息一条记录
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- 自定义角色表
    CREATE TABLE IF NOT EXISTS custom_personas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '🤖',
      description TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL,
      temperature REAL NOT NULL DEFAULT 0.7,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ===== 会话相关操作 =====

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

/** 创建新会话 */
export function createSession(persona: string = "assistant"): Session {
  const id = generateId();
  const db = getDb();
  db.prepare(
    "INSERT INTO sessions (id, persona) VALUES (?, ?)"
  ).run(id, persona);
  return getSession(id)!;
}

/** 获取单个会话 */
export function getSession(id: string): Session | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
    | Session
    | undefined;
}

/** 获取所有会话（按最近更新排序） */
export function getAllSessions(): Session[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM sessions ORDER BY updated_at DESC")
    .all() as Session[];
}

/** 更新会话标题 */
export function updateSessionTitle(id: string, title: string) {
  const db = getDb();
  db.prepare(
    "UPDATE sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(title, id);
}

/** 更新会话的人设 */
export function updateSessionPersona(id: string, persona: string) {
  const db = getDb();
  db.prepare(
    "UPDATE sessions SET persona = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(persona, id);
}

/** 删除会话（级联删除消息） */
export function deleteSession(id: string) {
  const db = getDb();
  // SQLite 的 ON DELETE CASCADE 需要开启外键支持
  db.pragma("foreign_keys = ON");
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

// ===== 消息相关操作 =====

/** 添加一条消息 */
export function addMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string
): Message {
  const db = getDb();
  const result = db
    .prepare(
      "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)"
    )
    .run(sessionId, role, content);

  // 同时更新会话的 updated_at
  db.prepare(
    "UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(sessionId);

  return db
    .prepare("SELECT * FROM messages WHERE id = ?")
    .get(result.lastInsertRowid) as Message;
}

/** 获取某个会话的所有消息 */
export function getMessages(sessionId: string): Message[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC"
    )
    .all(sessionId) as Message[];
}

/** 获取某个会话最近 N 条消息（用于控制 token 用量） */
export function getRecentMessages(
  sessionId: string,
  limit: number = 20
): Message[] {
  const db = getDb();
  // 取最近 N 条，但要按时间正序返回
  const rows = db
    .prepare(
      `SELECT * FROM (
        SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
      ) sub ORDER BY created_at ASC`
    )
    .all(sessionId, limit) as Message[];
  return rows;
}

// ===== 自定义角色操作 =====

export interface CustomPersona {
  id: string;
  name: string;
  emoji: string;
  description: string;
  prompt: string;
  temperature: number;
  created_at: string;
}

/** 创建自定义角色 */
export function createCustomPersona(
  name: string,
  emoji: string,
  description: string,
  prompt: string,
  temperature: number = 0.7
): CustomPersona {
  const id = "custom_" + generateId();
  const db = getDb();
  db.prepare(
    "INSERT INTO custom_personas (id, name, emoji, description, prompt, temperature) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, name, emoji, description, prompt, temperature);
  return db.prepare("SELECT * FROM custom_personas WHERE id = ?").get(id) as CustomPersona;
}

/** 获取所有自定义角色 */
export function getAllCustomPersonas(): CustomPersona[] {
  const db = getDb();
  return db.prepare("SELECT * FROM custom_personas ORDER BY created_at DESC").all() as CustomPersona[];
}

/** 获取单个自定义角色 */
export function getCustomPersona(id: string): CustomPersona | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM custom_personas WHERE id = ?").get(id) as CustomPersona | undefined;
}

/** 删除自定义角色 */
export function deleteCustomPersona(id: string) {
  const db = getDb();
  db.prepare("DELETE FROM custom_personas WHERE id = ?").run(id);
}

// ===== 工具函数 =====

/** 生成简短唯一 ID */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
