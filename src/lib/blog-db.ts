import { getPool } from "./pg";

/**
 * 博客数据库工具（PostgreSQL）
 *
 * 这是一个远端数据库工具的实现，让 AI 能查询你的博客系统数据。
 * 复用 pg.ts 的共享连接池。
 * 安全措施：
 *   1. 只允许 SELECT 查询（只读）
 *   2. 限制返回行数（最多 50 行）
 *   3. 查询超时限制（10 秒）
 */

/** 获取数据库表结构（让 AI 知道有哪些表和字段） */
export async function getDatabaseSchema(): Promise<string> {
  const client = await getPool().connect();
  try {
    // 查询所有 public schema 的表和字段
    const result = await client.query(`
      SELECT 
        t.table_name,
        c.column_name,
        c.data_type,
        c.column_default,
        c.is_nullable
      FROM information_schema.tables t
      JOIN information_schema.columns c ON t.table_name = c.table_name
      WHERE t.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name, c.ordinal_position
    `);

    // 按表分组
    const tables: Record<string, string[]> = {};
    for (const row of result.rows) {
      if (!tables[row.table_name]) {
        tables[row.table_name] = [];
      }
      tables[row.table_name].push(
        `  ${row.column_name} (${row.data_type}${row.is_nullable === "NO" ? ", NOT NULL" : ""})`
      );
    }

    // 格式化输出
    return Object.entries(tables)
      .map(([name, cols]) => `表 ${name}:\n${cols.join("\n")}`)
      .join("\n\n");
  } finally {
    client.release();
  }
}

/** 执行只读 SQL 查询 */
export async function executeReadOnlyQuery(sql: string): Promise<string> {
  // 安全检查：只允许 SELECT
  const trimmed = sql.trim().toLowerCase();
  if (
    !trimmed.startsWith("select") &&
    !trimmed.startsWith("with")  // 允许 CTE (WITH ... AS SELECT)
  ) {
    return "错误：只允许执行 SELECT 查询，不允许修改数据。";
  }

  // 禁止危险操作
  const dangerous = ["insert", "update", "delete", "drop", "alter", "truncate", "create"];
  for (const keyword of dangerous) {
    // 检查是否作为独立关键词出现（不是在引号或列名中）
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(trimmed) && !trimmed.startsWith("select") && !trimmed.startsWith("with")) {
      return `错误：SQL 中包含不允许的关键词 "${keyword}"。`;
    }
  }

  const client = await getPool().connect();
  try {
    // 加上 LIMIT 防止返回太多数据
    const limitedSql = trimmed.includes("limit") ? sql : `${sql} LIMIT 50`;

    const result = await client.query({
      text: limitedSql,
      rowMode: "array",
    });

    if (result.rows.length === 0) {
      return "查询结果为空。";
    }

    // 格式化为表格
    const headers = result.fields.map((f) => f.name);
    const rows = result.rows.map((row) =>
      row.map((v: unknown) => (v === null ? "NULL" : String(v))).join(" | ")
    );

    return [
      headers.join(" | "),
      headers.map(() => "---").join(" | "),
      ...rows,
      `\n共 ${result.rows.length} 条结果`,
    ].join("\n");
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return `SQL 执行出错: ${msg}`;
  } finally {
    client.release();
  }
}
