"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useTheme } from "next-themes";

/* ====== Color Utilities ====== */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = l; } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToHex(h, s, Math.min(1, l + amount));
}

function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToHex(h, s, Math.max(0, l - amount));
}

function deriveAccentVars(hex: string, isDark: boolean): Record<string, string> {
  const [r, g, b] = hexToRgb(hex);
  if (isDark) {
    const lightHex = lighten(hex, 0.2);
    const [lr, lg, lb] = hexToRgb(lightHex);
    const brighterHex = lighten(hex, 0.35);
    const secondHex = lighten(hex, 0.1);
    return {
      "--c-accent": lightHex,
      "--c-accent-soft": `rgba(${lr}, ${lg}, ${lb}, 0.08)`,
      "--c-accent-border": `rgba(${lr}, ${lg}, ${lb}, 0.18)`,
      "--c-accent-text": brighterHex,
      "--c-green-soft": `rgba(${lr}, ${lg}, ${lb}, 0.08)`,
      "--c-green-text": lightHex,
      "--c-user-bubble": `linear-gradient(135deg, ${hex}, ${lightHex})`,
      "--c-ai-avatar-from": `rgba(${lr}, ${lg}, ${lb}, 0.14)`,
      "--c-ai-avatar-to": `rgba(${lr}, ${lg}, ${lb}, 0.05)`,
      "--c-inline-code-bg": `rgba(${lr}, ${lg}, ${lb}, 0.1)`,
      "--c-inline-code-text": brighterHex,
      "--c-blockquote-border": `rgba(${lr}, ${lg}, ${lb}, 0.25)`,
      "--c-link": brighterHex,
      "--c-btn-gradient": `linear-gradient(135deg, ${darken(hex, 0.05)}, ${secondHex})`,
      "--c-btn-shadow": `rgba(${lr}, ${lg}, ${lb}, 0.25)`,
      "--c-logo-gradient": `linear-gradient(135deg, ${lightHex}, ${brighterHex})`,
    };
  }
  const darkHex = darken(hex, 0.08);
  const secondHex = lighten(hex, 0.15);
  return {
    "--c-accent": hex,
    "--c-accent-soft": `rgba(${r}, ${g}, ${b}, 0.06)`,
    "--c-accent-border": `rgba(${r}, ${g}, ${b}, 0.15)`,
    "--c-accent-text": darkHex,
    "--c-green-soft": `rgba(${r}, ${g}, ${b}, 0.06)`,
    "--c-green-text": hex,
    "--c-user-bubble": `linear-gradient(135deg, ${darkHex}, ${secondHex})`,
    "--c-ai-avatar-from": `rgba(${r}, ${g}, ${b}, 0.12)`,
    "--c-ai-avatar-to": `rgba(${r}, ${g}, ${b}, 0.04)`,
    "--c-inline-code-bg": `rgba(${r}, ${g}, ${b}, 0.06)`,
    "--c-inline-code-text": darkHex,
    "--c-blockquote-border": `rgba(${r}, ${g}, ${b}, 0.25)`,
    "--c-link": darkHex,
    "--c-btn-gradient": `linear-gradient(135deg, ${darkHex}, ${secondHex})`,
    "--c-btn-shadow": `rgba(${r}, ${g}, ${b}, 0.25)`,
    "--c-logo-gradient": `linear-gradient(135deg, ${hex}, ${secondHex})`,
  };
}

/* ====== HSV Utilities ====== */
function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  const r1 = r / 255, g1 = g / 255, b1 = b / 255;
  const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r1) h = ((g1 - b1) / d + (g1 < b1 ? 6 : 0)) / 6;
    else if (max === g1) h = ((b1 - r1) / d + 2) / 6;
    else h = ((r1 - g1) / d + 4) / 6;
  }
  return [h * 360, max === 0 ? 0 : d / max, max];
}

function hsvToHex(h: number, s: number, v: number): string {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const PRESET_COLORS = [
  "#475569", "#64748b", "#6b7280", "#71717a",
  "#ef4444", "#f97316", "#f59e0b", "#eab308",
  "#84cc16", "#22c55e", "#14b8a6", "#06b6d4",
  "#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6",
  "#a855f7", "#d946ef", "#ec4899", "#f43f5e",
];

function ColorPicker({ value, onChange, onClose }: { value: string; onChange: (hex: string) => void; onClose: () => void }) {
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(value));
  const [hexInput, setHexInput] = useState(value);
  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const hueBarRef = useRef<HTMLCanvasElement>(null);
  const draggingSV = useRef(false);
  const draggingHue = useRef(false);

  const currentHex = hsvToHex(hsv[0], hsv[1], hsv[2]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => { setHexInput(currentHex); onChangeRef.current(currentHex); }, [currentHex]);

  useEffect(() => {
    const canvas = svCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    const hueColor = hsvToHex(hsv[0], 1, 1);
    const whiteGrad = ctx.createLinearGradient(0, 0, w, 0);
    whiteGrad.addColorStop(0, "#ffffff");
    whiteGrad.addColorStop(1, hueColor);
    ctx.fillStyle = whiteGrad;
    ctx.fillRect(0, 0, w, h);
    const blackGrad = ctx.createLinearGradient(0, 0, 0, h);
    blackGrad.addColorStop(0, "rgba(0,0,0,0)");
    blackGrad.addColorStop(1, "#000000");
    ctx.fillStyle = blackGrad;
    ctx.fillRect(0, 0, w, h);
  }, [hsv[0]]);

  useEffect(() => {
    const canvas = hueBarRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
    for (let i = 0; i <= 6; i++) {
      grad.addColorStop(i / 6, hsvToHex(i * 60, 1, 1));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const handleSV = (e: React.MouseEvent | MouseEvent) => {
    const canvas = svCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    setHsv([hsv[0], s, v]);
  };

  const handleHue = (e: React.MouseEvent | MouseEvent) => {
    const bar = hueBarRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const h = Math.max(0, Math.min(360, ((e.clientX - rect.left) / rect.width) * 360));
    setHsv([h, hsv[1], hsv[2]]);
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (draggingSV.current) handleSV(e);
      if (draggingHue.current) handleHue(e);
    };
    const onUp = () => { draggingSV.current = false; draggingHue.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  });

  const handleHexSubmit = () => {
    const cleaned = hexInput.startsWith("#") ? hexInput : `#${hexInput}`;
    if (/^#[0-9a-fA-F]{6}$/.test(cleaned)) {
      setHsv(hexToHsv(cleaned));
    } else {
      setHexInput(currentHex);
    }
  };

  return (
    <div className="color-picker-popover" onClick={(e) => e.stopPropagation()}>
      {/* SV Area */}
      <div className="relative rounded-xl overflow-hidden" style={{ cursor: "crosshair" }}>
        <canvas ref={svCanvasRef} width={240} height={160}
          className="w-full h-[160px] rounded-xl"
          onMouseDown={(e) => { draggingSV.current = true; handleSV(e); }} />
        <div className="pointer-events-none absolute w-3.5 h-3.5 rounded-full border-2 border-white -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`,
            boxShadow: "0 0 0 1px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.2)",
          }} />
      </div>

      {/* Hue Bar */}
      <div className="relative mt-3 rounded-full overflow-hidden" style={{ cursor: "pointer" }}>
        <canvas ref={hueBarRef} width={240} height={14}
          className="w-full h-[14px] rounded-full"
          onMouseDown={(e) => { draggingHue.current = true; handleHue(e); }} />
        <div className="pointer-events-none absolute top-1/2 w-4 h-4 rounded-full border-2 border-white -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${(hsv[0] / 360) * 100}%`,
            boxShadow: "0 0 0 1px rgba(0,0,0,0.2), 0 2px 4px rgba(0,0,0,0.15)",
            background: hsvToHex(hsv[0], 1, 1),
          }} />
      </div>

      {/* Hex Input */}
      <div className="flex items-center gap-2 mt-3">
        <div className="w-7 h-7 rounded-lg border border-line shrink-0" style={{ background: currentHex }} />
        <div className="flex-1 flex items-center rounded-lg border border-line bg-input-bg px-2.5 h-7">
          <span className="text-[11px] text-ink-faint mr-0.5">#</span>
          <input
            className="flex-1 bg-transparent text-[12px] font-mono text-ink outline-none w-0"
            value={hexInput.replace("#", "")}
            onChange={(e) => setHexInput(`#${e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6)}`)}
            onBlur={handleHexSubmit}
            onKeyDown={(e) => e.key === "Enter" && handleHexSubmit()}
            maxLength={6}
          />
        </div>
      </div>

      {/* Preset Colors */}
      <div className="grid grid-cols-10 gap-1.5 mt-3">
        {PRESET_COLORS.map((c) => (
          <button key={c} className="w-full aspect-square rounded-md border border-transparent hover:border-ink-faint transition-colors hover:scale-110 active:scale-95"
            style={{ background: c, boxShadow: currentHex === c ? `0 0 0 2px var(--c-panel), 0 0 0 3.5px ${c}` : undefined }}
            onClick={() => setHsv(hexToHsv(c))} />
        ))}
      </div>

      {/* Close Button */}
      <button onClick={onClose}
        className="w-full mt-3 h-7 rounded-lg text-[12px] font-medium text-ink-muted hover:text-ink hover:bg-card-hover transition-colors">
        完成
      </button>
    </div>
  );
}

/* ====== Types ====== */
interface ThinkingBlock { content: string; isComplete: boolean; }
interface ToolCallBlock { name: string; input: Record<string, unknown>; result?: string; isComplete: boolean; }
interface Message { role: "user" | "assistant"; content: string; thinking?: ThinkingBlock; toolCalls?: ToolCallBlock[]; }
interface Session { id: string; title: string; persona: string; created_at: string; updated_at: string; }
interface CustomPersona { id: string; name: string; emoji: string; description: string; prompt: string; temperature: number; }
interface AnalysisResult { summary: string; sentiment: "positive" | "negative" | "neutral" | "mixed"; sentimentScore: number; keywords: string[]; category: string; language: string; wordCount: number; readingTime: string; }
interface UserInfo { name: string; image: string | null; }
interface McpServer { id: string; name: string; transport: "stdio" | "http"; command: string | null; args: string | null; url: string | null; headers: string | null; env: string | null; enabled: boolean; created_at: string; }

/* ====== Preset MCP Servers ====== */
interface PresetMcp {
  id: string;
  name: string;
  description: string;
  icon: string;
  transport: "stdio";
  command: string;
  args: string[];
  envKeys?: string[];
  envLabels?: Record<string, string>;
  envPlaceholders?: Record<string, string>;
  configHint?: string;
}

const PRESET_MCP_SERVERS: PresetMcp[] = [
  {
    id: "playwright",
    name: "Playwright",
    description: "浏览器自动化，截图、网页交互、UI 测试",
    icon: "🎭",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
  },
  {
    id: "filesystem",
    name: "Filesystem",
    description: "文件系统读写，目录浏览和文件管理",
    icon: "📁",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "抓取任意网页内容，获取 URL 数据",
    icon: "🌐",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
  },
  {
    id: "memory",
    name: "Memory",
    description: "知识图谱记忆，持久化存储和检索信息",
    icon: "🧠",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description: "分步推理思考，适合解决复杂多步问题",
    icon: "🔗",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
  },
  {
    id: "github",
    name: "GitHub",
    description: "GitHub 仓库管理、Issues、PR 操作",
    icon: "🐙",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    envLabels: { GITHUB_PERSONAL_ACCESS_TOKEN: "GitHub Token" },
    envPlaceholders: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_xxxxxxxxxxxx" },
    configHint: "GitHub Settings → Developer settings → Personal access tokens",
  },
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Brave 搜索引擎，高质量联网搜索",
    icon: "🦁",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    envKeys: ["BRAVE_API_KEY"],
    envLabels: { BRAVE_API_KEY: "Brave API Key" },
    envPlaceholders: { BRAVE_API_KEY: "BSA_xxxxxxxxxxxx" },
    configHint: "在 brave.com/search/api 获取",
  },
  {
    id: "sqlite",
    name: "SQLite",
    description: "SQLite 数据库查询和管理操作",
    icon: "🗃️",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite"],
  },
];

/* ====== Tool display helpers ====== */
const getToolIcon = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes("search") || n.includes("web") || n.includes("brave")) return "🔍";
  if (n.includes("image") || n.includes("generate") || n.includes("jimeng")) return "🎨";
  if (n.includes("weather")) return "🌤️";
  if (n.includes("time") || n.includes("clock")) return "🕐";
  if (n.includes("calc")) return "🔢";
  if (n.includes("file") || n.includes("parse") || n.includes("filesystem")) return "📄";
  if (n.includes("knowledge") || n.includes("memory")) return "📚";
  if (n.includes("blog") || n.includes("db") || n.includes("sql") || n.includes("query")) return "🗃️";
  if (n.includes("browser") || n.includes("playwright") || n.includes("navigate") || n.includes("screenshot") || n.includes("snapshot")) return "🎭";
  if (n.includes("github")) return "🐙";
  if (n.includes("fetch")) return "🌐";
  if (n.includes("thinking") || n.includes("sequen")) return "🔗";
  return "⚡";
};

const getToolDisplayName = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes("search") || n.includes("web") || n.includes("brave")) return "联网搜索";
  if (n.includes("image") || n.includes("generate") || n.includes("jimeng")) return "图片生成";
  if (n.includes("weather")) return "天气查询";
  if (n.includes("time") || n.includes("clock")) return "时间查询";
  if (n.includes("calc")) return "数学计算";
  if (n.includes("file") || n.includes("parse") || n.includes("filesystem")) return "文件处理";
  if (n.includes("knowledge") || n.includes("memory")) return "知识检索";
  if (n.includes("blog") || n.includes("db") || n.includes("sql") || n.includes("query")) return "数据查询";
  if (n.includes("browser") || n.includes("playwright") || n.includes("navigate") || n.includes("screenshot") || n.includes("snapshot")) return "浏览器操作";
  if (n.includes("github")) return "GitHub";
  if (n.includes("fetch")) return "网页获取";
  if (n.includes("thinking") || n.includes("sequen")) return "深度思考";
  const parts = name.split("__");
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
};

const BUILTIN_PERSONAS = [
  { id: "assistant", name: "通用助手", emoji: "✨", desc: "友好简洁，有问必答" },
  { id: "cat", name: "猫娘小喵", emoji: "🐱", desc: "可爱撒娇，句尾带喵~" },
  { id: "coder", name: "编程导师", emoji: "💻", desc: "代码示例，通俗易懂" },
  { id: "poet", name: "文艺诗人", emoji: "🎭", desc: "诗意表达，富有哲理" },
  { id: "wife", name: "老婆小美", emoji: "💕", desc: "性感妩媚，甜蜜撒娇" },
];

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";


export default function Home() {
  const { setTheme: setNextTheme, resolvedTheme } = useTheme();
  const [accentHex, setAccentHex] = useState("#475569");
  const [mounted, setMounted] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [reasoningMode, setReasoningMode] = useState(false);
  const [customPersonas, setCustomPersonas] = useState<CustomPersona[]>([]);
  const [personaModalOpen, setPersonaModalOpen] = useState(false);
  const [newPersona, setNewPersona] = useState({ name: "", emoji: "🤖", description: "", prompt: "", temperature: 0.7 });
  const [personaPickerOpen, setPersonaPickerOpen] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [analyzeText, setAnalyzeText] = useState("");
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [newMcp, setNewMcp] = useState<{ name: string; transport: "stdio" | "http"; command: string; args: string; url: string; headers: string }>({ name: "", transport: "stdio", command: "npx", args: "", url: "", headers: "" });
  const [mcpTab, setMcpTab] = useState<"market" | "installed" | "custom">("market");
  const [mcpTutorialOpen, setMcpTutorialOpen] = useState(false);
  const [presetInstalling, setPresetInstalling] = useState<PresetMcp | null>(null);
  const [presetEnvValues, setPresetEnvValues] = useState<Record<string, string>>({});
  const [thinkingToggled, setThinkingToggled] = useState<Set<number>>(new Set());
  const [toolToggled, setToolToggled] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  /* ====== Theme ====== */
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("accentHex");
    if (saved && /^#[0-9a-fA-F]{6}$/.test(saved)) setAccentHex(saved);
  }, []);

  useEffect(() => {
    if (!colorPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) setColorPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colorPickerOpen]);

  useEffect(() => {
    const isDark = resolvedTheme === "dark";
    const vars = deriveAccentVars(accentHex, isDark);
    const root = document.documentElement;
    Object.entries(vars).forEach(([key, val]) => root.style.setProperty(key, val));
  }, [resolvedTheme, accentHex]);

  const toggleTheme = () => {
    setNextTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  const changeAccentColor = (hex: string) => {
    setAccentHex(hex);
    localStorage.setItem("accentHex", hex);
  };

  /* ====== Data loading ====== */
  const loadSessions = useCallback(async () => { try { const res = await fetch(`${BASE}/api/sessions`); if (!res.ok) return; const data = await res.json(); setSessions(data.sessions || []); } catch {} }, []);
  const loadMessages = useCallback(async (sid: string) => { try { const res = await fetch(`${BASE}/api/sessions?id=${sid}`); if (!res.ok) return; const data = await res.json(); setMessages((data.messages || []).map((m: { role: string; content: string }) => ({ role: m.role, content: m.content }))); } catch {} }, []);
  const loadCustomPersonas = useCallback(async () => { try { const res = await fetch(`${BASE}/api/personas`); if (!res.ok) return; const data = await res.json(); setCustomPersonas(data.personas || []); } catch {} }, []);
  const loadMcpServers = useCallback(async () => { try { const res = await fetch(`${BASE}/api/mcp-servers`); if (res.ok) { const data = await res.json(); setMcpServers(data.servers || []); } } catch {} }, []);

  useEffect(() => { loadSessions(); loadCustomPersonas(); loadMcpServers(); }, [loadSessions, loadCustomPersonas, loadMcpServers]);
  useEffect(() => {
    fetch(`${BASE}/api/user`).then(r => r.ok ? r.json() : null).then(d => { if (d) setUserInfo(d); }).catch(() => {});
  }, []);
  useEffect(() => { if (currentSessionId) loadMessages(currentSessionId); }, [currentSessionId, loadMessages]);
  useEffect(() => {
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, userScrolledUp]);

  const handleMessagesScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setUserScrolledUp(distanceFromBottom > 150);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setUserScrolledUp(false);
  };

  const allPersonas = [
    ...BUILTIN_PERSONAS.map((p) => ({ ...p, isBuiltin: true })),
    ...customPersonas.map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, desc: p.description, isBuiltin: false })),
  ];

  /* ====== Actions ====== */
  const createNewSession = async (persona: string = "assistant") => {
    try {
      const res = await fetch(`${BASE}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ persona }) });
      if (!res.ok) { alert("创建会话失败"); return; }
      const data = await res.json();
      if (!data.session) return;
      setSessions((prev) => [data.session, ...prev]);
      setCurrentSessionId(data.session.id);
      setMessages([]);
      setPersonaPickerOpen(false);
    } catch { alert("网络错误"); }
  };

  const deleteSessionById = async (id: string) => {
    try { await fetch(`${BASE}/api/sessions?id=${id}`, { method: "DELETE" }); } catch {}
    setSessions((prev) => prev.filter((s) => s?.id !== id));
    if (currentSessionId === id) { setCurrentSessionId(null); setMessages([]); }
  };

  const handleCreatePersona = async () => {
    if (!newPersona.name.trim() || !newPersona.prompt.trim()) return;
    const res = await fetch(`${BASE}/api/personas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newPersona) });
    const data = await res.json();
    if (data.persona) { setCustomPersonas((prev) => [data.persona, ...prev]); setNewPersona({ name: "", emoji: "🤖", description: "", prompt: "", temperature: 0.7 }); setPersonaModalOpen(false); }
  };

  const handleDeletePersona = async (id: string) => {
    await fetch(`${BASE}/api/personas?id=${id}`, { method: "DELETE" });
    setCustomPersonas((prev) => prev.filter((p) => p.id !== id));
  };

  const handleAddMcpServer = async () => {
    if (!newMcp.name.trim()) return;
    if (newMcp.transport === "stdio" && !newMcp.command.trim()) return;
    if (newMcp.transport === "http" && !newMcp.url.trim()) return;
    const body: Record<string, unknown> = { name: newMcp.name, transport: newMcp.transport };
    if (newMcp.transport === "stdio") {
      body.command = newMcp.command;
      body.args = newMcp.args.split(/\s+/).filter(Boolean);
    } else {
      body.url = newMcp.url;
      if (newMcp.headers.trim()) { try { body.headers = JSON.parse(newMcp.headers); } catch { alert("Headers 格式错误，请输入合法 JSON"); return; } }
    }
    try {
      const res = await fetch(`${BASE}/api/mcp-servers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) { const data = await res.json(); setMcpServers(prev => [data.server, ...prev]); setNewMcp({ name: "", transport: "stdio", command: "npx", args: "", url: "", headers: "" }); }
      else { const data = await res.json(); alert(data.error || "添加失败"); }
    } catch { alert("网络错误"); }
  };

  const handleDeleteMcpServer = async (id: string) => {
    await fetch(`${BASE}/api/mcp-servers?id=${id}`, { method: "DELETE" });
    setMcpServers(prev => prev.filter(s => s.id !== id));
  };

  const handleToggleMcpServer = async (id: string, enabled: boolean) => {
    await fetch(`${BASE}/api/mcp-servers`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, enabled }) });
    setMcpServers(prev => prev.map(s => s.id === id ? { ...s, enabled } : s));
  };

  const handleInstallPreset = async (preset: PresetMcp) => {
    if (preset.envKeys && preset.envKeys.length > 0) {
      setPresetInstalling(preset);
      setPresetEnvValues({});
      return;
    }
    await doInstallPreset(preset, {});
  };

  const doInstallPreset = async (preset: PresetMcp, envVals: Record<string, string>) => {
    const body: Record<string, unknown> = {
      name: preset.name,
      transport: preset.transport,
      command: preset.command,
      args: preset.args,
    };
    if (Object.keys(envVals).length > 0) {
      body.env = envVals;
    }
    try {
      const res = await fetch(`${BASE}/api/mcp-servers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) {
        const data = await res.json();
        setMcpServers(prev => [data.server, ...prev]);
        setPresetInstalling(null);
        setPresetEnvValues({});
      } else {
        const data = await res.json();
        alert(data.error || "安装失败");
      }
    } catch { alert("网络错误"); }
  };

  const isPresetInstalled = (presetId: string) => {
    const preset = PRESET_MCP_SERVERS.find(p => p.id === presetId);
    if (!preset) return false;
    return mcpServers.some(s => s.name === preset.name);
  };

  /* ====== Send Message (SSE) ====== */
  const sendMessage = async () => {
    if (!input.trim() || loading || !currentSessionId) return;
    const userMessage: Message = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages); setInput(""); setLoading(true);
    setThinkingToggled(new Set());
    setToolToggled(new Set());
    try {
      const response = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: userMessage.content, sessionId: currentSessionId, webSearchEnabled, reasoningMode }) });
      if (!response.ok) { const data = await response.json(); setMessages([...newMessages, { role: "assistant", content: `错误: ${data.error}` }]); return; }
      const reader = response.body?.getReader(); const decoder = new TextDecoder();
      if (!reader) throw new Error("无法获取响应流");
      const aiIdx = newMessages.length;
      setMessages([...newMessages, { role: "assistant", content: "", thinking: undefined, toolCalls: undefined }]);

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            setMessages((prev) => {
              const updated = [...prev];
              const msg = { ...updated[aiIdx] };

              switch (data.type) {
                case "thinking":
                  msg.thinking = {
                    content: (msg.thinking?.content || "") + data.content,
                    isComplete: false,
                  };
                  break;
                case "thinking_end":
                  if (msg.thinking) {
                    msg.thinking = { ...msg.thinking, isComplete: true };
                  }
                  break;
                case "tool_start":
                  msg.toolCalls = [
                    ...(msg.toolCalls || []),
                    { name: data.name, input: data.input || {}, isComplete: false },
                  ];
                  break;
                case "tool_end": {
                  const calls = [...(msg.toolCalls || [])];
                  for (let i = calls.length - 1; i >= 0; i--) {
                    if (calls[i].name === data.name && !calls[i].isComplete) {
                      calls[i] = { ...calls[i], result: data.result, isComplete: true };
                      break;
                    }
                  }
                  msg.toolCalls = calls;
                  break;
                }
                case "content":
                  msg.content = (msg.content || "") + data.content;
                  break;
                case "error":
                  msg.content = (msg.content || "") + `\n[${data.content}]`;
                  break;
                case "done":
                  break;
              }

              updated[aiIdx] = msg;
              return updated;
            });
          } catch { /* skip malformed SSE */ }
        }
      }
      loadSessions();
    } catch { setMessages((prev) => [...prev.filter((m) => m.content !== ""), { role: "assistant", content: "网络错误，请检查服务是否正常运行" }]); }
    finally { setLoading(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !currentSessionId) return;
    const fd = new FormData(); fd.append("file", file);
    try { const res = await fetch(`${BASE}/api/upload`, { method: "POST", body: fd }); const data = await res.json(); if (data.url) { setInput(file.type.startsWith("image/") ? `请分析这张图片: ${window.location.origin}${BASE}${data.url}` : `请解析这个文件: ${data.filename} (路径: ${data.url})`); } }
    catch { alert("文件上传失败"); } e.target.value = "";
  };

  const handleAnalyze = async () => {
    if (!analyzeText.trim() || analyzeLoading) return;
    setAnalyzeLoading(true); setAnalysisResult(null);
    try { const res = await fetch(`${BASE}/api/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: analyzeText.trim() }) }); const data = await res.json(); if (data.analysis) setAnalysisResult(data.analysis); else alert(data.error || "分析失败"); }
    catch { alert("网络错误"); } finally { setAnalyzeLoading(false); }
  };

  const sentimentMap: Record<string, { label: string; emoji: string }> = {
    positive: { label: "积极", emoji: "😊" }, negative: { label: "消极", emoji: "😟" },
    neutral: { label: "中性", emoji: "😐" }, mixed: { label: "混合", emoji: "🤔" },
  };
  const categoryMap: Record<string, string> = { technology: "科技", business: "商业", life: "生活", education: "教育", news: "新闻", opinion: "观点", other: "其他" };

  const currentSession = sessions.find((s) => s?.id === currentSessionId);
  const currentPersona = allPersonas.find((p) => p?.id === (currentSession?.persona || "assistant"));

  const toggleThinking = (index: number) => {
    setThinkingToggled(prev => { const s = new Set(prev); if (s.has(index)) s.delete(index); else s.add(index); return s; });
  };
  const toggleTool = (key: string) => {
    setToolToggled(prev => { const s = new Set(prev); if (s.has(key)) s.delete(key); else s.add(key); return s; });
  };
  const isThinkingExpanded = (index: number, isComplete: boolean) => {
    const toggled = thinkingToggled.has(index);
    return isComplete ? toggled : !toggled;
  };
  const isToolExpanded = (key: string, isComplete: boolean) => {
    const toggled = toolToggled.has(key);
    return isComplete ? toggled : !toggled;
  };

  /* ====== Inline SVG Icons ====== */
  const SunIcon = <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>;
  const MoonIcon = <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>;
  const PlusIcon = <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>;
  const TrashIcon = <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>;
  const CloseIcon = <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>;
  const GlobeIcon = <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>;
  const SendIcon = <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>;
  const ChevronIcon = <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>;
  const CheckIcon = <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>;

  return (
    <div className="flex h-screen bg-page text-ink overflow-hidden transition-colors duration-300">

      {/* ═══ Sidebar ═══ */}
      <aside className={`${sidebarOpen ? "w-[260px]" : "w-0"} shrink-0 overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]`}>
        <div className="flex h-full w-[260px] flex-col bg-panel sidebar-border">

          {/* Sidebar Header */}
          <div className="px-4 pt-5 pb-4">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white text-[13px] font-bold shadow-sm"
                style={{ background: "var(--c-logo-gradient)" }}>
                C
              </div>
              <div className="flex flex-col">
                <span className="text-[15px] font-semibold tracking-tight leading-tight">Cortex</span>
                <span className="text-[10px] text-ink-faint leading-tight">AI 智能助手</span>
              </div>
            </div>
            <button
              onClick={() => setPersonaPickerOpen(true)}
              className="btn-press w-full flex items-center justify-center gap-2 rounded-xl h-[38px] text-[13px] font-medium text-white hover:brightness-110 transition-all"
              style={{ background: "var(--c-btn-gradient)", boxShadow: `0 2px 8px var(--c-btn-shadow)` }}
            >
              {PlusIcon}
              <span>新建对话</span>
            </button>
          </div>

          {/* Session List */}
          <div className="flex-1 overflow-y-auto px-2.5 py-1 space-y-px min-h-0">
            {sessions.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-ink-faint">
                <svg className="w-8 h-8 mb-3 opacity-40" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                <p className="text-xs">暂无对话</p>
              </div>
            )}
            {sessions.map((session) => {
              const persona = allPersonas.find((p) => p.id === session.persona);
              const isActive = currentSessionId === session.id;
              return (
                <div key={session.id}
                  className={`session-item group flex items-center gap-2.5 rounded-xl px-3 py-2.5 cursor-pointer ${
                    isActive
                      ? "bg-accent-soft text-accent-text font-medium"
                      : "text-ink-secondary hover:bg-card-hover hover:text-ink"
                  }`}
                  onClick={() => setCurrentSessionId(session.id)}
                >
                  <span className="text-[15px] shrink-0">{persona?.emoji || "✨"}</span>
                  <span className="flex-1 truncate text-[13px] leading-snug">{session.title}</span>
                  <button onClick={(e) => { e.stopPropagation(); deleteSessionById(session.id); }}
                    className="opacity-0 group-hover:opacity-100 shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-ink-faint hover:text-red-500 hover:bg-red-500/10 transition-all"
                  >
                    {TrashIcon}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Sidebar Footer */}
          <div className="p-3 border-t border-line space-y-px">
            <div className="relative" ref={colorPickerRef}>
              <button onClick={() => setColorPickerOpen(!colorPickerOpen)}
                className={`btn-press w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] text-ink-muted hover:text-ink hover:bg-card-hover ${colorPickerOpen ? "bg-card-hover text-ink" : ""}`}>
                <span className="w-4 h-4 rounded-full shrink-0 border border-line" style={{ background: accentHex }} />
                主题色
                <span className="ml-auto text-[11px] text-ink-faint font-mono">{accentHex}</span>
              </button>
              {colorPickerOpen && (
                <ColorPicker value={accentHex} onChange={changeAccentColor} onClose={() => setColorPickerOpen(false)} />
              )}
            </div>

            <button onClick={() => setPersonaModalOpen(true)}
              className="btn-press w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] text-ink-muted hover:text-ink hover:bg-card-hover">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
              角色管理
            </button>
            <button onClick={() => { setMcpModalOpen(true); setMcpTab("market"); }}
              className="btn-press w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] text-ink-muted hover:text-ink hover:bg-card-hover">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.491 48.491 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 005.427-.63 48.05 48.05 0 00.582-4.717.532.532 0 00-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.959.401v0a.656.656 0 00.658-.663 48.422 48.422 0 00-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 01-.61-.58v0z" /></svg>
              MCP 工具
              {mcpServers.filter(s => s.enabled).length > 0 && (
                <span className="ml-auto text-[10px] font-semibold rounded-full bg-green-soft text-green-text px-1.5 py-0.5 min-w-[20px] text-center">
                  {mcpServers.filter(s => s.enabled).length}
                </span>
              )}
            </button>
          </div>
        </div>
      </aside>

      {/* ═══ Main Area ═══ */}
      <div className="flex flex-1 flex-col min-w-0">

        {/* Header */}
        <header className="shrink-0 flex items-center gap-3 px-5 h-[52px] border-b border-line bg-panel/80 backdrop-blur-md z-10">
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            className="btn-press rounded-lg p-1.5 text-ink-muted hover:text-ink hover:bg-card-hover" aria-label="Toggle sidebar">
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d={sidebarOpen ? "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" : "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"} />
            </svg>
          </button>

          <div className="h-5 w-px bg-line shrink-0" />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {currentPersona && <span className="text-[14px]">{currentPersona.emoji}</span>}
              <h1 className="text-[13px] font-semibold truncate tracking-tight">
                {currentSession ? currentSession.title : "Cortex"}
              </h1>
              {currentPersona && (
                <span className="text-[11px] text-ink-faint font-medium px-1.5 py-0.5 rounded-md bg-card-hover shrink-0">
                  {currentPersona.name}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-0.5">
            <a href="/"
              className="btn-press shrink-0 rounded-lg p-1.5 text-ink-muted hover:text-ink hover:bg-card-hover" title="返回首页">
              <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>
            </a>
            <button onClick={() => { setAnalyzeOpen(true); setAnalysisResult(null); }}
              className="btn-press shrink-0 rounded-lg p-1.5 text-ink-muted hover:text-ink hover:bg-card-hover" title="文本分析">
              <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>
            </button>
            <button onClick={toggleTheme} suppressHydrationWarning
              className="btn-press shrink-0 rounded-lg p-1.5 text-ink-muted hover:text-ink hover:bg-card-hover" title={mounted ? (resolvedTheme === "light" ? "暗色模式" : "亮色模式") : "切换主题"}>
              {!mounted ? SunIcon : resolvedTheme === "light" ? MoonIcon : SunIcon}
            </button>

            {userInfo && (
              <div className="shrink-0 ml-1 pl-2 border-l border-line flex items-center" title={userInfo.name}>
                {userInfo.image ? (
                  <img src={userInfo.image} alt={userInfo.name} className="w-7 h-7 rounded-full object-cover ring-1 ring-line" />
                ) : (
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white"
                    style={{ background: "var(--c-logo-gradient)" }}>
                    {userInfo.name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* ═══ Messages ═══ */}
        <div className="flex-1 overflow-y-auto relative" ref={scrollContainerRef} onScroll={handleMessagesScroll}>
          {userScrolledUp && loading && (
            <button onClick={scrollToBottom}
              className="sticky top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-medium bg-panel border border-line hover:bg-card-hover transition-all"
              style={{ marginBottom: "-36px", boxShadow: "var(--c-shadow-md)" }}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
              回到最新
            </button>
          )}

          <div className="mx-auto max-w-[720px] px-5 py-8 space-y-5">
            {/* Welcome Screen */}
            {!currentSessionId ? (
              <div className="flex flex-col items-center justify-center min-h-[65vh] select-none">
                <div className="welcome-icon w-14 h-14 rounded-2xl flex items-center justify-center text-[28px] mb-6"
                  style={{ background: "linear-gradient(135deg, var(--c-accent-soft), transparent)" }}>
                  ✨
                </div>
                <h2 className="welcome-gradient text-2xl font-bold tracking-tight mb-2">开始新对话</h2>
                <p className="text-[13px] text-ink-muted mb-8 max-w-xs text-center leading-relaxed">
                  联网搜索 · 图片生成 · 文件解析 · MCP 扩展
                </p>
                <button onClick={() => setPersonaPickerOpen(true)}
                  className="btn-press rounded-full px-7 py-2.5 text-[13px] font-semibold text-white hover:brightness-110 transition-all"
                  style={{ background: "var(--c-btn-gradient)", boxShadow: `0 4px 14px var(--c-btn-shadow)` }}>
                  选择角色
                </button>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[65vh] select-none">
                <div className="welcome-icon w-12 h-12 rounded-2xl flex items-center justify-center text-[24px] mb-4"
                  style={{ background: "linear-gradient(135deg, var(--c-accent-soft), transparent)" }}>
                  {currentPersona?.emoji || "✨"}
                </div>
                <h2 className="text-[17px] font-semibold tracking-tight mb-1">{currentPersona?.name}</h2>
                <p className="text-[12px] text-ink-muted">{currentPersona?.desc}</p>
              </div>
            ) : (
              messages.map((msg, index) => (
                <div key={index} className={`msg-enter flex gap-3.5 ${msg.role === "user" ? "justify-end" : ""}`}>

                  {/* AI Avatar */}
                  {msg.role === "assistant" && (
                    <div className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-sm mt-0.5"
                      style={{ background: "linear-gradient(135deg, var(--c-ai-avatar-from), var(--c-ai-avatar-to))" }}>
                      {currentPersona?.emoji || "✨"}
                    </div>
                  )}

                  {/* ── Assistant Message ── */}
                  {msg.role === "assistant" ? (
                    <div className="flex-1 min-w-0 max-w-[82%]">

                      {/* Thinking Block */}
                      {msg.thinking && msg.thinking.content && (
                        <div className="mb-1">
                          <div className="ds-toggle" onClick={() => toggleThinking(index)}>
                            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" /></svg>
                            <span className={!msg.thinking.isComplete ? "shimmer-text" : ""}>{msg.thinking.isComplete ? "已思考" : "正在思考"}</span>
                            <span className={`ds-chevron ${isThinkingExpanded(index, msg.thinking.isComplete ?? false) ? "rotate-180" : ""}`}>{ChevronIcon}</span>
                          </div>
                          {isThinkingExpanded(index, msg.thinking.isComplete ?? false) && (
                            <div className="ds-thinking-content">
                              {msg.thinking.content}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Tool Calls */}
                      {msg.toolCalls && msg.toolCalls.length > 0 && msg.toolCalls.map((tc, tcIdx) => {
                        const key = `${index}-${tcIdx}`;
                        const expanded = isToolExpanded(key, tc.isComplete);
                        return (
                          <div key={tcIdx} className="mb-1">
                            <div className="ds-toggle" onClick={() => tc.isComplete && toggleTool(key)}>
                              {tc.isComplete ? (
                                <span className="text-green-text shrink-0">{CheckIcon}</span>
                              ) : (
                                <span className="text-[13px] shrink-0">{getToolIcon(tc.name)}</span>
                              )}
                              <span className={!tc.isComplete ? "shimmer-text" : ""}>
                                {getToolDisplayName(tc.name)}
                                {!tc.isComplete && "..."}
                              </span>
                              {tc.isComplete && (
                                <span className={`ds-chevron ${expanded ? "rotate-180" : ""}`}>{ChevronIcon}</span>
                              )}
                            </div>
                            {expanded && tc.result && (
                              <div className="ds-thinking-content">
                                {tc.result.replace(/!\[.*?\]\(.*?\)\n?/g, "").trim() || tc.result}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Content */}
                      {(msg.content || msg.toolCalls?.some(tc => !tc.isComplete && tc.name.toLowerCase().match(/image|generate|jimeng/))) && (
                        <div className="rounded-2xl bg-card px-4 py-3.5 markdown-body text-[14px] leading-[1.75] mt-1"
                          style={{ boxShadow: "var(--c-shadow)" }}>
                          {msg.content && (
                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{
                              img: ({ src, alt }) => (
                                <img src={src} alt={alt || ''} className="rounded-xl max-w-full max-h-[400px] object-contain my-2" />
                              )
                            }}>{(() => {
                              const seen = new Set<string>();
                              return msg.content.replace(/!\[.*?\]\((.*?)\)\n?/g, (match: string, url: string) => {
                                if (seen.has(url)) return "";
                                seen.add(url);
                                return match;
                              });
                            })()}</ReactMarkdown>
                          )}
                          {msg.toolCalls?.some(tc => !tc.isComplete && tc.name.toLowerCase().match(/image|generate|jimeng/)) && (
                            <div className="skeleton-image mt-3" />
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* ── User Message ── */
                    <div className="max-w-[75%] rounded-2xl px-4 py-3 text-[14px] leading-[1.7] text-white"
                      style={{ background: "var(--c-user-bubble)", boxShadow: `0 2px 10px var(--c-btn-shadow)` }}>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  )}

                  {/* User Avatar */}
                  {msg.role === "user" && (
                    userInfo?.image ? (
                      <img src={userInfo.image} alt={userInfo.name} className="shrink-0 w-7 h-7 rounded-lg object-cover mt-0.5" />
                    ) : (
                      <div className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-semibold text-white mt-0.5"
                        style={{ background: "var(--c-logo-gradient)" }}>
                        {userInfo?.name?.charAt(0).toUpperCase() || "U"}
                      </div>
                    )
                  )}
                </div>
              ))
            )}

            {/* Loading indicator */}
            {loading && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="msg-enter flex gap-3.5 items-start">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
                  style={{ background: "linear-gradient(135deg, var(--c-ai-avatar-from), var(--c-ai-avatar-to))" }}>
                  {currentPersona?.emoji || "✨"}
                </div>
                <div className="ds-toggle" style={{ cursor: "default" }}>
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" /></svg>
                  <span className="shimmer-text">正在思考</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* ═══ Input Area ═══ */}
        {currentSessionId && (
          <div className="shrink-0 px-5 pb-4 pt-2">
            <div className="mx-auto max-w-[720px]">
              <div className="input-float rounded-2xl border border-line bg-card overflow-hidden">
                <div className="px-4 pt-3 pb-1.5">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={`给 ${currentPersona?.name || "AI"} 发消息...`}
                    rows={1}
                    disabled={loading}
                    className="w-full bg-transparent text-[14px] placeholder:text-ink-faint outline-none resize-none leading-relaxed disabled:opacity-50"
                    style={{ maxHeight: "180px" }}
                  />
                </div>
                <div className="flex items-center justify-between px-3 pb-2.5">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setReasoningMode(!reasoningMode)} disabled={loading}
                      className={`btn-press flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all disabled:opacity-30 ${
                        reasoningMode
                          ? "bg-accent-soft text-accent-text"
                          : "text-ink-faint hover:text-ink-muted hover:bg-card-hover"
                      }`}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                      深度思考
                    </button>
                    <button onClick={() => setWebSearchEnabled(!webSearchEnabled)} disabled={loading}
                      className={`btn-press flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all disabled:opacity-30 ${
                        webSearchEnabled
                          ? "bg-accent-soft text-accent-text"
                          : "text-ink-faint hover:text-ink-muted hover:bg-card-hover"
                      }`}>
                      {GlobeIcon}
                      联网搜索
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input ref={fileInputRef} type="file" accept="image/*,.pdf,.xlsx,.xls,.csv,.doc,.docx,.txt" onChange={handleFileUpload} className="hidden" />
                    <button onClick={() => fileInputRef.current?.click()} disabled={loading}
                      className="btn-press rounded-lg p-2 text-ink-faint hover:text-ink-muted hover:bg-card-hover transition-colors disabled:opacity-30" title="上传文件">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" /></svg>
                    </button>
                    <button onClick={sendMessage} disabled={loading || !input.trim()}
                      className="btn-press shrink-0 rounded-xl p-2 transition-all disabled:opacity-20"
                      style={{ background: input.trim() ? "var(--c-accent)" : "var(--c-ink-faint)", color: "#fff" }}>
                      {SendIcon}
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-center text-[11px] text-ink-faint mt-2.5 select-none">AI 生成内容仅供参考</p>
            </div>
          </div>
        )}
      </div>

      {/* ═══════ Persona Picker Modal ═══════ */}
      {personaPickerOpen && (
        <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-xl" onClick={() => setPersonaPickerOpen(false)}>
          <div className="modal-glass w-full max-w-lg mx-4 border border-line" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b border-line">
              <h2 className="text-[16px] font-semibold tracking-tight">选择角色</h2>
              <button onClick={() => setPersonaPickerOpen(false)} className="btn-press rounded-xl p-1.5 text-ink-muted hover:text-ink hover:bg-card-hover">{CloseIcon}</button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-2.5 max-h-[60vh] overflow-y-auto">
              {allPersonas.map((p) => (
                <button key={p.id} onClick={() => createNewSession(p.id)}
                  className="persona-card btn-press flex items-center gap-3 rounded-xl bg-card hover:bg-card-hover border border-line px-4 py-3.5 text-left group">
                  <span className="text-2xl group-hover:scale-110 transition-transform duration-200">{p.emoji}</span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium truncate">{p.name}</p>
                    <p className="text-[11px] text-ink-muted truncate mt-0.5">{p.desc}</p>
                  </div>
                </button>
              ))}
              <button onClick={() => { setPersonaPickerOpen(false); setPersonaModalOpen(true); }}
                className="persona-card btn-press flex items-center gap-3 rounded-xl border border-dashed border-line hover:border-accent-border px-4 py-3.5 text-left group">
                <span className="w-9 h-9 rounded-lg bg-card-hover flex items-center justify-center text-ink-faint group-hover:text-accent-text transition-colors">{PlusIcon}</span>
                <div>
                  <p className="text-[13px] font-medium text-ink-muted group-hover:text-ink">创建新角色</p>
                  <p className="text-[11px] text-ink-faint mt-0.5">自定义人设</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ Persona Manager Modal ═══════ */}
      {personaModalOpen && (
        <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-xl" onClick={() => setPersonaModalOpen(false)}>
          <div className="modal-glass w-full max-w-xl mx-4 border border-line max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b border-line">
              <h2 className="text-[16px] font-semibold tracking-tight">角色管理</h2>
              <button onClick={() => setPersonaModalOpen(false)} className="btn-press rounded-xl p-1.5 text-ink-muted hover:text-ink hover:bg-card-hover">{CloseIcon}</button>
            </div>
            <div className="p-6 space-y-4 border-b border-line">
              <h3 className="text-[13px] font-medium text-ink-secondary">创建角色</h3>
              <div className="grid grid-cols-[auto_1fr] gap-3">
                <div>
                  <label className="text-[11px] text-ink-muted mb-1 block">Emoji</label>
                  <input value={newPersona.emoji} onChange={(e) => setNewPersona({ ...newPersona, emoji: e.target.value })}
                    className="w-14 h-10 rounded-xl bg-input-bg border border-line text-center text-lg outline-none focus:border-accent focus:ring-2 focus:ring-accent/10 transition-all" maxLength={4} />
                </div>
                <div>
                  <label className="text-[11px] text-ink-muted mb-1 block">名称</label>
                  <input value={newPersona.name} onChange={(e) => setNewPersona({ ...newPersona, name: e.target.value })} placeholder="例：旅行顾问"
                    className="w-full h-10 rounded-xl bg-input-bg border border-line px-3 text-[13px] placeholder:text-ink-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent/10 transition-all" />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-ink-muted mb-1 block">简介</label>
                <input value={newPersona.description} onChange={(e) => setNewPersona({ ...newPersona, description: e.target.value })} placeholder="一句话描述"
                  className="w-full h-10 rounded-xl bg-input-bg border border-line px-3 text-[13px] placeholder:text-ink-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent/10 transition-all" />
              </div>
              <div>
                <label className="text-[11px] text-ink-muted mb-1 block">系统提示词</label>
                <textarea value={newPersona.prompt} onChange={(e) => setNewPersona({ ...newPersona, prompt: e.target.value })}
                  placeholder={"定义角色的性格和说话风格..."} rows={3}
                  className="w-full rounded-xl bg-input-bg border border-line px-3 py-2.5 text-[13px] placeholder:text-ink-faint outline-none resize-none focus:border-accent focus:ring-2 focus:ring-accent/10 transition-all" />
              </div>
              <div>
                <label className="text-[11px] text-ink-muted mb-1 block">温度 ({newPersona.temperature})</label>
                <input type="range" min="0" max="1" step="0.05" value={newPersona.temperature} onChange={(e) => setNewPersona({ ...newPersona, temperature: parseFloat(e.target.value) })} className="w-full" />
                <div className="flex justify-between text-[10px] text-ink-faint mt-1"><span>精确</span><span>创意</span></div>
              </div>
              <button onClick={handleCreatePersona} disabled={!newPersona.name.trim() || !newPersona.prompt.trim()}
                className="btn-press w-full rounded-xl bg-accent px-4 py-3 text-[13px] font-semibold text-white disabled:opacity-30 hover:brightness-110 transition-all"
                style={{ boxShadow: `0 2px 8px var(--c-btn-shadow)` }}>
                创建角色
              </button>
            </div>
            {customPersonas.length > 0 && (
              <div className="p-6 space-y-2">
                <h3 className="text-[13px] font-medium text-ink-secondary mb-3">已创建</h3>
                {customPersonas.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-xl bg-card border border-line px-4 py-3">
                    <span className="text-lg">{p.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate">{p.name}</p>
                      <p className="text-[11px] text-ink-muted truncate">{p.description}</p>
                    </div>
                    <button onClick={() => handleDeletePersona(p.id)}
                      className="btn-press shrink-0 rounded-lg p-1.5 text-ink-faint hover:text-red-500 hover:bg-red-500/10 transition-all" title="删除">
                      {TrashIcon}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════ Analysis Modal ═══════ */}
      {analyzeOpen && (
        <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-xl" onClick={() => setAnalyzeOpen(false)}>
          <div className="modal-glass w-full max-w-2xl max-h-[85vh] overflow-y-auto border border-line mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-6 py-5">
              <div>
                <h2 className="text-[16px] font-semibold tracking-tight">文本分析</h2>
                <p className="text-[12px] text-ink-muted mt-0.5">结构化分析文本内容</p>
              </div>
              <button onClick={() => setAnalyzeOpen(false)} className="btn-press rounded-xl p-1.5 text-ink-muted hover:text-ink hover:bg-card-hover">{CloseIcon}</button>
            </div>
            <div className="px-6 py-5">
              <textarea value={analyzeText} onChange={(e) => setAnalyzeText(e.target.value)} placeholder="粘贴文本，获取结构化分析..."
                className="w-full h-28 rounded-xl bg-input-bg border border-line px-4 py-3 text-[13px] placeholder:text-ink-faint outline-none resize-none focus:border-accent focus:ring-2 focus:ring-accent/10 transition-all" />
              <button onClick={handleAnalyze} disabled={analyzeLoading || !analyzeText.trim()}
                className="btn-press mt-3 w-full rounded-xl bg-accent px-6 py-3 text-[13px] font-semibold text-white disabled:opacity-30 hover:brightness-110 transition-all"
                style={{ boxShadow: `0 2px 8px var(--c-btn-shadow)` }}>
                {analyzeLoading ? "分析中..." : "开始分析"}
              </button>
            </div>
            {analysisResult && (
              <div className="px-6 pb-6 space-y-3">
                <div className="h-px bg-line" />
                <div className="rounded-xl bg-accent-soft border border-accent-border p-4">
                  <h3 className="text-[11px] font-semibold text-accent-text uppercase tracking-wider mb-1.5">摘要</h3>
                  <p className="text-[13px] text-ink-secondary leading-relaxed">{analysisResult.summary}</p>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-xl bg-card border border-line p-4">
                    <h3 className="text-[11px] text-ink-muted uppercase tracking-wider mb-2">情感</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{sentimentMap[analysisResult.sentiment]?.emoji}</span>
                      <span className="rounded-full bg-accent-soft text-accent-text px-2.5 py-0.5 text-[12px] font-medium">{sentimentMap[analysisResult.sentiment]?.label}</span>
                    </div>
                  </div>
                  <div className="rounded-xl bg-card border border-line p-4">
                    <h3 className="text-[11px] text-ink-muted uppercase tracking-wider mb-2">强度</h3>
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-bold">{Math.round(analysisResult.sentimentScore * 100)}%</span>
                      <div className="flex-1 h-1.5 bg-card-hover rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${analysisResult.sentimentScore * 100}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl bg-card border border-line p-4">
                  <h3 className="text-[11px] text-ink-muted uppercase tracking-wider mb-2">关键词</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {analysisResult.keywords.map((kw, i) => (
                      <span key={i} className="rounded-full bg-accent-soft text-accent-text px-2.5 py-0.5 text-[12px]">{kw}</span>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: "分类", value: categoryMap[analysisResult.category] || analysisResult.category },
                    { label: "语言", value: analysisResult.language === "zh" ? "中文" : analysisResult.language === "en" ? "英文" : "中英混合" },
                    { label: "字数", value: String(analysisResult.wordCount) },
                    { label: "阅读", value: analysisResult.readingTime },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl bg-card border border-line p-3 text-center">
                      <p className="text-[10px] text-ink-faint uppercase tracking-wider">{item.label}</p>
                      <p className="text-[13px] font-medium text-ink-secondary mt-1">{item.value}</p>
                    </div>
                  ))}
                </div>
                <details className="rounded-xl bg-card border border-line">
                  <summary className="px-4 py-3 text-[12px] text-ink-muted cursor-pointer hover:text-ink-secondary">原始 JSON</summary>
                  <pre className="px-4 pb-4 text-[11px] text-ink-muted overflow-x-auto font-mono">{JSON.stringify(analysisResult, null, 2)}</pre>
                </details>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════ MCP Modal ═══════ */}
      {mcpModalOpen && (
        <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-xl" onClick={() => setMcpModalOpen(false)}>
          <div className="modal-glass w-full max-w-2xl mx-4 border border-line max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div className="shrink-0 px-6 py-5 border-b border-line">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[16px] font-semibold tracking-tight">MCP 工具</h2>
                  <p className="text-[12px] text-ink-muted mt-0.5">扩展 AI 的外部能力</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setMcpTutorialOpen(!mcpTutorialOpen)}
                    className={`btn-press text-[11px] px-2 py-1 rounded-lg border transition-all ${mcpTutorialOpen ? "border-accent-border bg-accent-soft text-accent-text" : "border-line text-ink-muted hover:bg-card-hover"}`}
                  >
                    <svg className="w-3.5 h-3.5 inline mr-1" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" /></svg>
                    帮助
                  </button>
                  <button onClick={() => setMcpModalOpen(false)} className="btn-press rounded-lg p-1 text-ink-muted hover:text-ink hover:bg-card-hover">{CloseIcon}</button>
                </div>
              </div>

              {mcpTutorialOpen && (
                <div className="mt-4 p-4 rounded-xl border border-accent-border bg-accent-soft space-y-2.5">
                  <div>
                    <h4 className="text-[11px] font-semibold text-accent-text mb-1">什么是 MCP？</h4>
                    <p className="text-[12px] text-ink-secondary leading-relaxed">
                      MCP 是开放协议，让 AI 安全连接外部工具与数据。安装后 AI 可以浏览网页、操作文件、搜索等。
                    </p>
                  </div>
                  <div>
                    <h4 className="text-[11px] font-semibold text-accent-text mb-1">快速开始</h4>
                    <ol className="text-[12px] text-ink-secondary leading-relaxed space-y-0.5 list-decimal pl-4">
                      <li>「市场」标签页浏览工具，点击安装</li>
                      <li>部分工具需填写 API Key</li>
                      <li>「已安装」中开启/关闭工具</li>
                      <li>对话时 AI 自动调用已开启的工具</li>
                    </ol>
                  </div>
                </div>
              )}

              {/* Tabs */}
              <div className="flex gap-1 mt-4 border-b border-line -mx-6 px-6">
                {([
                  { key: "market" as const, label: "市场", icon: "🏪" },
                  { key: "installed" as const, label: `已安装 (${mcpServers.length})`, icon: "📦" },
                  { key: "custom" as const, label: "自定义", icon: "⚙️" },
                ]).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setMcpTab(tab.key)}
                    className={`btn-press relative flex items-center gap-1.5 px-3.5 py-2.5 text-[12px] font-medium transition-colors ${
                      mcpTab === tab.key ? "text-accent-text tab-active" : "text-ink-muted hover:text-ink-secondary hover:bg-card-hover rounded-lg"
                    }`}
                  >
                    <span>{tab.icon}</span>
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto">

              {/* Market */}
              {mcpTab === "market" && (
                <div className="p-5">
                  <div className="grid grid-cols-2 gap-2.5">
                    {PRESET_MCP_SERVERS.map((preset) => {
                      const installed = isPresetInstalled(preset.id);
                      return (
                        <div key={preset.id} className="mcp-card p-4 rounded-xl border border-line bg-card">
                          <div className="flex items-start gap-3">
                            <span className="text-xl shrink-0 mt-0.5">{preset.icon}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <h4 className="text-[13px] font-medium truncate">{preset.name}</h4>
                                {preset.envKeys && (
                                  <span className="shrink-0 text-[9px] rounded px-1 py-0.5 bg-orange-500/10 text-orange-600">配置</span>
                                )}
                              </div>
                              <p className="text-[11px] text-ink-muted mt-0.5 leading-relaxed">{preset.description}</p>
                            </div>
                          </div>
                          <div className="mt-3 flex items-center gap-2">
                            <span className="text-[10px] text-ink-faint font-mono truncate flex-1">{preset.command} {preset.args.slice(0, 2).join(" ")}</span>
                            {installed ? (
                              <span className="shrink-0 text-[11px] text-green-text flex items-center gap-1 bg-green-soft px-2 py-1 rounded-lg font-medium">
                                {CheckIcon} 已装
                              </span>
                            ) : (
                              <button
                                onClick={() => handleInstallPreset(preset)}
                                className="btn-press shrink-0 text-[11px] bg-accent text-white px-3 py-1.5 rounded-lg font-semibold hover:brightness-110 transition-all"
                              >
                                安装
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Installed */}
              {mcpTab === "installed" && (
                <div className="p-5">
                  {mcpServers.length === 0 ? (
                    <div className="text-center py-14">
                      <p className="text-2xl mb-3 opacity-60">📦</p>
                      <p className="text-[13px] text-ink-muted">暂无已安装的工具</p>
                      <p className="text-[11px] text-ink-faint mt-1">在「市场」中一键安装</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {mcpServers.map((s) => (
                        <div key={s.id} className="flex items-center gap-3 rounded-xl bg-card border border-line px-4 py-3">
                          <button onClick={() => handleToggleMcpServer(s.id, !s.enabled)}
                            className={`toggle-track shrink-0 w-9 h-[22px] rounded-full relative ${s.enabled ? "bg-green-500" : "bg-ink-faint"}`}
                            style={{ opacity: s.enabled ? 1 : 0.3 }}>
                            <div className={`toggle-thumb absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm ${s.enabled ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-[13px] font-medium truncate">{s.name}</p>
                              <span className={`text-[9px] rounded px-1 py-0.5 ${s.transport === "stdio" ? "bg-blue-500/10 text-blue-600" : "bg-orange-500/10 text-orange-600"}`}>
                                {s.transport.toUpperCase()}
                              </span>
                            </div>
                            <p className="text-[11px] text-ink-muted truncate">
                              {s.transport === "stdio"
                                ? `${s.command} ${s.args ? JSON.parse(s.args).join(" ") : ""}`
                                : s.url}
                            </p>
                          </div>
                          <button onClick={() => handleDeleteMcpServer(s.id)}
                            className="btn-press shrink-0 rounded-lg p-1.5 text-ink-faint hover:text-red-500 hover:bg-red-500/10 transition-all" title="删除">
                            {TrashIcon}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Custom */}
              {mcpTab === "custom" && (
                <div className="p-5 space-y-3.5">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-ink-muted mb-1 block">名称</label>
                      <input value={newMcp.name} onChange={(e) => setNewMcp({ ...newMcp, name: e.target.value })} placeholder="例：filesystem"
                        className="w-full h-10 rounded-xl bg-input-bg border border-line px-3 text-[13px] placeholder:text-ink-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent/10 transition-all" />
                    </div>
                    <div>
                      <label className="text-[11px] text-ink-muted mb-1 block">类型</label>
                      <select value={newMcp.transport} onChange={(e) => setNewMcp({ ...newMcp, transport: e.target.value as "stdio" | "http" })}
                        className="w-full h-10 rounded-xl bg-input-bg border border-line px-3 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/10 transition-all">
                        <option value="stdio">Stdio</option>
                        <option value="http">HTTP</option>
                      </select>
                    </div>
                  </div>

                  {newMcp.transport === "stdio" ? (
                    <>
                      <div>
                        <label className="text-[11px] text-ink-muted mb-1 block">命令</label>
                        <input value={newMcp.command} onChange={(e) => setNewMcp({ ...newMcp, command: e.target.value })} placeholder="npx"
                          className="w-full h-10 rounded-xl bg-input-bg border border-line px-3 text-[13px] placeholder:text-ink-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent/10 transition-all" />
                      </div>
                      <div>
                        <label className="text-[11px] text-ink-muted mb-1 block">参数（空格分隔）</label>
                        <input value={newMcp.args} onChange={(e) => setNewMcp({ ...newMcp, args: e.target.value })} placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                          className="w-full h-10 rounded-xl bg-input-bg border border-line px-3 text-[13px] placeholder:text-ink-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent/10 transition-all" />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="text-[11px] text-ink-muted mb-1 block">URL</label>
                        <input value={newMcp.url} onChange={(e) => setNewMcp({ ...newMcp, url: e.target.value })} placeholder="https://example.com/mcp"
                          className="w-full h-10 rounded-xl bg-input-bg border border-line px-3 text-[13px] placeholder:text-ink-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent/10 transition-all" />
                      </div>
                      <div>
                        <label className="text-[11px] text-ink-muted mb-1 block">Headers（JSON，可选）</label>
                        <input value={newMcp.headers} onChange={(e) => setNewMcp({ ...newMcp, headers: e.target.value })} placeholder='{"Authorization":"Bearer xxx"}'
                          className="w-full h-10 rounded-xl bg-input-bg border border-line px-3 text-[13px] placeholder:text-ink-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent/10 font-mono transition-all" />
                      </div>
                    </>
                  )}

                  <button onClick={handleAddMcpServer}
                    disabled={!newMcp.name.trim() || (newMcp.transport === "stdio" ? !newMcp.command.trim() : !newMcp.url.trim())}
                    className="btn-press w-full rounded-xl bg-accent px-4 py-3 text-[13px] font-semibold text-white disabled:opacity-30 hover:brightness-110 transition-all"
                    style={{ boxShadow: `0 2px 8px var(--c-btn-shadow)` }}>
                    添加
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════ Preset Config Dialog ═══════ */}
      {presetInstalling && (
        <div className="modal-overlay fixed inset-0 z-[60] flex items-center justify-center bg-overlay backdrop-blur-xl" onClick={() => setPresetInstalling(null)}>
          <div className="modal-glass w-full max-w-md mx-4 border border-line" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-line">
              <h3 className="text-[15px] font-semibold tracking-tight flex items-center gap-2">
                <span className="text-lg">{presetInstalling.icon}</span>
                安装 {presetInstalling.name}
              </h3>
              {presetInstalling.configHint && (
                <p className="text-[11px] text-ink-muted mt-1">{presetInstalling.configHint}</p>
              )}
            </div>
            <div className="p-6 space-y-3">
              {presetInstalling.envKeys?.map(key => (
                <div key={key}>
                  <label className="text-[11px] text-ink-muted mb-1 block">
                    {presetInstalling.envLabels?.[key] || key}
                  </label>
                  <input
                    value={presetEnvValues[key] || ""}
                    onChange={(e) => setPresetEnvValues(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={presetInstalling.envPlaceholders?.[key] || ""}
                    className="w-full h-10 rounded-xl bg-input-bg border border-line px-3 text-[13px] placeholder:text-ink-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent/10 font-mono transition-all"
                  />
                </div>
              ))}
              <div className="flex gap-2 pt-2">
                <button onClick={() => setPresetInstalling(null)}
                  className="btn-press flex-1 rounded-xl border border-line px-4 py-2.5 text-[13px] text-ink-muted hover:bg-card-hover transition-all">
                  取消
                </button>
                <button
                  onClick={() => doInstallPreset(presetInstalling, presetEnvValues)}
                  disabled={presetInstalling.envKeys?.some(k => !presetEnvValues[k]?.trim())}
                  className="btn-press flex-1 rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-30 hover:brightness-110 transition-all"
                  style={{ boxShadow: `0 2px 8px var(--c-btn-shadow)` }}>
                  确认
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
