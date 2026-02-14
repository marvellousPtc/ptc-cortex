/**
 * ========== MCP Servers 数据库管理 ==========
 *
 * 存储用户配置的 MCP server 信息。
 * 支持 stdio 和 HTTP 两种传输方式。
 */

import { getPool } from "./pg";

export interface McpServerConfig {
  id: string;
  user_id: string;
  name: string;
  transport: "stdio" | "http";
  command: string | null;
  args: string | null; // JSON array string
  url: string | null;
  headers: string | null; // JSON object string
  env: string | null; // JSON object string — 环境变量
  enabled: boolean;
  created_at: string;
}

/**
 * 建表（如果不存在）
 */
export async function initMcpServersTable(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_mcp_servers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      transport TEXT NOT NULL DEFAULT 'stdio',
      command TEXT,
      args TEXT,
      url TEXT,
      headers TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // 为 user_id 加索引
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chat_mcp_servers_user_id ON chat_mcp_servers(user_id)
  `);
  // 新增 env 列（兼容已有表）
  await pool.query(`
    ALTER TABLE chat_mcp_servers ADD COLUMN IF NOT EXISTS env TEXT
  `);
}

// 应用启动时自动建表
initMcpServersTable().catch((err) =>
  console.warn("MCP servers 建表失败:", err)
);

/**
 * 获取用户的所有 MCP server 配置
 */
export async function getMcpServers(
  userId: string
): Promise<McpServerConfig[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM chat_mcp_servers WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

/**
 * 获取用户已启用的 MCP server 配置
 */
export async function getEnabledMcpServers(
  userId: string
): Promise<McpServerConfig[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM chat_mcp_servers WHERE user_id = $1 AND enabled = true ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

/**
 * 添加 MCP server
 */
export async function addMcpServer(params: {
  userId: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}): Promise<McpServerConfig> {
  const pool = getPool();
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO chat_mcp_servers (id, user_id, name, transport, command, args, url, headers, env)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      id,
      params.userId,
      params.name,
      params.transport,
      params.command || null,
      params.args ? JSON.stringify(params.args) : null,
      params.url || null,
      params.headers ? JSON.stringify(params.headers) : null,
      params.env ? JSON.stringify(params.env) : null,
    ]
  );
  return rows[0];
}

/**
 * 删除 MCP server（校验 userId 防越权）
 */
export async function deleteMcpServer(
  id: string,
  userId: string
): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `DELETE FROM chat_mcp_servers WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * 切换 MCP server 启用/禁用
 */
export async function toggleMcpServer(
  id: string,
  userId: string,
  enabled: boolean
): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE chat_mcp_servers SET enabled = $3 WHERE id = $1 AND user_id = $2`,
    [id, userId, enabled]
  );
  return (result.rowCount ?? 0) > 0;
}
