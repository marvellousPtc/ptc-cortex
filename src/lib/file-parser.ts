/**
 * ========== 文件解析工具 ==========
 *
 * 支持解析多种文件格式：
 * - PDF → 提取文本
 * - Excel (.xlsx/.xls) → 提取表格数据
 * - CSV → 提取表格数据
 * - TXT/Markdown → 直接读取文本
 */

import fs from "fs";
import path from "path";

/**
 * 解析上传的文件，返回文本内容
 */
export async function parseFile(filePath: string): Promise<string> {
  // filePath 可能是 /uploads/xxx.pdf 或绝对路径
  const absolutePath = filePath.startsWith("/uploads/")
    ? path.join(process.cwd(), "public", filePath)
    : filePath;

  if (!fs.existsSync(absolutePath)) {
    return `错误：文件不存在 (${filePath})`;
  }

  const ext = path.extname(absolutePath).toLowerCase();
  const fileSize = fs.statSync(absolutePath).size;

  // 限制文件大小（10MB）
  if (fileSize > 10 * 1024 * 1024) {
    return "错误：文件太大（超过 10MB），请使用更小的文件。";
  }

  try {
    switch (ext) {
      case ".pdf":
        return await parsePDF(absolutePath);
      case ".xlsx":
      case ".xls":
        return parseExcel(absolutePath);
      case ".csv":
        return parseCSV(absolutePath);
      case ".txt":
      case ".md":
      case ".json":
        return parseText(absolutePath);
      default:
        return `不支持的文件格式: ${ext}。支持的格式: PDF, Excel, CSV, TXT, Markdown`;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return `文件解析出错: ${msg}`;
  }
}

/** 解析 PDF */
async function parsePDF(filePath: string): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);

  const text = data.text.trim();
  if (!text) return "PDF 文件没有提取到文本内容（可能是扫描件/图片 PDF）。";

  // 限制返回长度（避免太长塞爆上下文）
  const maxLen = 5000;
  if (text.length > maxLen) {
    return `[PDF 共 ${data.numpages} 页，${text.length} 字，以下为前 ${maxLen} 字]\n\n${text.slice(0, maxLen)}\n\n... (内容已截断)`;
  }

  return `[PDF 共 ${data.numpages} 页，${text.length} 字]\n\n${text}`;
}

/** 解析 Excel */
function parseExcel(filePath: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx");
  const workbook = XLSX.readFile(filePath);
  const results: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

    if (json.length === 0) continue;

    results.push(`### 工作表: ${sheetName}`);

    // 转成 Markdown 表格
    const headers = (json[0] as unknown[]).map((h) => String(h || ""));
    results.push("| " + headers.join(" | ") + " |");
    results.push("| " + headers.map(() => "---").join(" | ") + " |");

    const maxRows = 50; // 限制行数
    for (let i = 1; i < Math.min(json.length, maxRows + 1); i++) {
      const row = (json[i] as unknown[]).map((c) => String(c ?? ""));
      results.push("| " + row.join(" | ") + " |");
    }

    if (json.length > maxRows + 1) {
      results.push(`\n... (共 ${json.length - 1} 行，已截断显示前 ${maxRows} 行)`);
    }
  }

  return results.join("\n") || "Excel 文件为空。";
}

/** 解析 CSV */
function parseCSV(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");

  if (lines.length === 0) return "CSV 文件为空。";

  // 转成 Markdown 表格
  const results: string[] = [];
  const headers = lines[0].split(",").map((h) => h.trim());
  results.push("| " + headers.join(" | ") + " |");
  results.push("| " + headers.map(() => "---").join(" | ") + " |");

  const maxRows = 50;
  for (let i = 1; i < Math.min(lines.length, maxRows + 1); i++) {
    const row = lines[i].split(",").map((c) => c.trim());
    results.push("| " + row.join(" | ") + " |");
  }

  if (lines.length > maxRows + 1) {
    results.push(`\n... (共 ${lines.length - 1} 行，已截断显示前 ${maxRows} 行)`);
  }

  return results.join("\n");
}

/** 解析纯文本 */
function parseText(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf-8");
  const maxLen = 5000;
  if (content.length > maxLen) {
    return `[文件共 ${content.length} 字，以下为前 ${maxLen} 字]\n\n${content.slice(0, maxLen)}\n\n... (内容已截断)`;
  }
  return content;
}
