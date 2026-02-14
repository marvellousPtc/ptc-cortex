"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

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

// basePath：部署时通过 NEXT_PUBLIC_BASE_PATH 环境变量设置（如 /chat），本地开发为空
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

export default function Home() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
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
  /* MCP marketplace states */
  const [mcpTab, setMcpTab] = useState<"market" | "installed" | "custom">("market");
  const [mcpTutorialOpen, setMcpTutorialOpen] = useState(false);
  const [presetInstalling, setPresetInstalling] = useState<PresetMcp | null>(null);
  const [presetEnvValues, setPresetEnvValues] = useState<Record<string, string>>({});
  /* Thinking / tool toggle states */
  const [thinkingToggled, setThinkingToggled] = useState<Set<number>>(new Set());
  const [toolToggled, setToolToggled] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ====== Theme ====== */
  useEffect(() => {
    const saved = localStorage.getItem("theme") as "light" | "dark" | null;
    if (saved) setTheme(saved);
    else if (window.matchMedia("(prefers-color-scheme: dark)").matches) setTheme("dark");
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("theme", next);
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
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

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

  /* ====== Install Preset MCP ====== */
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
    // Reset toggle states for new message
    setThinkingToggled(new Set());
    setToolToggled(new Set());
    try {
      const response = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: userMessage.content, sessionId: currentSessionId, webSearchEnabled }) });
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

        // Parse SSE events (data: {...}\n\n)
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

  /* ====== Toggle helpers ====== */
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

  /* ====== Icons (inline SVG helpers) ====== */
  const SunIcon = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>;
  const MoonIcon = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>;
  const PlusIcon = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>;
  const TrashIcon = <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>;
  const CloseIcon = <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
  const GlobeIcon = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>;
  const ClipIcon = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>;
  const SendIcon = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>;
  const ChevronIcon = <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>;
  const SpinnerIcon = <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" /><path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>;
  const BrainIcon = <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>;
  const CheckIcon = <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>;

  return (
    <div data-theme={theme} className="flex h-screen bg-page text-ink overflow-hidden transition-colors duration-300">

      {/* ===== Sidebar ===== */}
      <aside className={`${sidebarOpen ? "w-72" : "w-0"} shrink-0 overflow-hidden transition-all duration-300`}>
        <div className="flex h-full w-72 flex-col bg-panel border-r border-line">
          {/* Logo + New Chat */}
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-linear-to-br from-violet-500 to-blue-500 flex items-center justify-center text-sm font-bold text-white">AI</div>
              <span className="text-sm font-semibold">PTC Cortex</span>
            </div>
            <button
              onClick={() => setPersonaPickerOpen(true)}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-card hover:bg-card-hover border border-line px-4 py-2.5 text-sm text-ink-secondary hover:text-ink transition-all"
            >
              {PlusIcon} 新建对话
            </button>
          </div>

          {/* Session List */}
          <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
            {sessions.length === 0 && <p className="text-xs text-ink-faint text-center py-10">暂无对话</p>}
            {sessions.map((session) => {
              const persona = allPersonas.find((p) => p.id === session.persona);
              const isActive = currentSessionId === session.id;
              return (
                <div key={session.id}
                  className={`group flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm cursor-pointer transition-all ${isActive ? "bg-accent-soft text-accent-text font-medium" : "text-ink-secondary hover:bg-card-hover hover:text-ink"}`}
                  onClick={() => setCurrentSessionId(session.id)}
                >
                  <span className="text-base shrink-0">{persona?.emoji || "✨"}</span>
                  <span className="flex-1 truncate text-[13px]">{session.title}</span>
                  <button onClick={(e) => { e.stopPropagation(); deleteSessionById(session.id); }}
                    className="opacity-0 group-hover:opacity-100 shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-ink-muted hover:text-red-500 hover:bg-red-500/10 transition-all">
                    {TrashIcon}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Bottom */}
          <div className="p-3 border-t border-line space-y-0.5">
            <button onClick={() => setPersonaModalOpen(true)}
              className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-ink-muted hover:text-ink-secondary hover:bg-card-hover transition-all">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
              管理角色
            </button>
            <button onClick={() => { setMcpModalOpen(true); setMcpTab("market"); }}
              className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-ink-muted hover:text-ink-secondary hover:bg-card-hover transition-all">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              MCP 工具
              {mcpServers.filter(s => s.enabled).length > 0 && (
                <span className="ml-auto text-[10px] rounded-full bg-green-500/15 text-green-600 px-1.5 py-0.5">{mcpServers.filter(s => s.enabled).length}</span>
              )}
            </button>
          </div>
        </div>
      </aside>

      {/* ===== Main ===== */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="shrink-0 flex items-center gap-3 px-4 py-3 bg-panel/80 backdrop-blur-xl border-b border-line z-10">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="rounded-lg p-2 text-ink-muted hover:text-ink hover:bg-card-hover transition-all">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={sidebarOpen ? "M11 19l-7-7 7-7m8 14l-7-7 7-7" : "M13 5l7 7-7 7M5 5l7 7-7 7"} /></svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-medium truncate">{currentSession ? currentSession.title : "PTC Cortex"}</h1>
            {currentPersona && <p className="text-xs text-ink-muted truncate">{currentPersona.emoji} {currentPersona.name} · {currentPersona.desc}</p>}
          </div>
          {/* Theme toggle */}
          <button onClick={toggleTheme} className="shrink-0 rounded-lg p-2 text-ink-muted hover:text-ink hover:bg-card-hover transition-all" title={theme === "light" ? "切换暗色" : "切换亮色"}>
            {theme === "light" ? MoonIcon : SunIcon}
          </button>
          {/* Analyze */}
          <button onClick={() => { setAnalyzeOpen(true); setAnalysisResult(null); }}
            className="shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-ink-muted hover:text-ink bg-card hover:bg-card-hover border border-line transition-all">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
            文本分析
          </button>
          {/* User Avatar */}
          {userInfo && (
            <div className="shrink-0 flex items-center gap-2 pl-2 border-l border-line" title={userInfo.name}>
              {userInfo.image ? (
                <img src={userInfo.image} alt={userInfo.name} className="w-8 h-8 rounded-full object-cover border border-line" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-linear-to-br from-violet-500 to-blue-500 flex items-center justify-center text-xs font-bold text-white">
                  {userInfo.name.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-xs text-ink-secondary hidden sm:block max-w-[80px] truncate">{userInfo.name}</span>
            </div>
          )}
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
            {!currentSessionId ? (
              <div className="flex flex-col items-center justify-center py-24">
                <div className="w-20 h-20 rounded-2xl bg-linear-to-br from-violet-500 via-blue-500 to-cyan-400 flex items-center justify-center text-3xl mb-6 shadow-lg shadow-violet-500/20">✨</div>
                <h2 className="text-2xl font-semibold mb-2">开始一段新对话</h2>
                <p className="text-sm text-ink-muted mb-8 text-center max-w-md">支持联网搜索、图片生成、文件解析、知识库检索等多种能力</p>
                <button onClick={() => setPersonaPickerOpen(true)}
                  className="rounded-xl bg-linear-to-r from-violet-600 to-blue-600 px-8 py-3 text-sm font-medium text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all hover:-translate-y-0.5">
                  选择角色开始
                </button>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24">
                <div className="w-16 h-16 rounded-2xl bg-card border border-line flex items-center justify-center text-3xl mb-5">{currentPersona?.emoji || "✨"}</div>
                <h2 className="text-lg font-medium mb-1">{currentPersona?.name}</h2>
                <p className="text-sm text-ink-muted">{currentPersona?.desc}</p>
                <p className="text-xs text-ink-faint mt-4">发送消息开始对话</p>
              </div>
            ) : (
              messages.map((msg, index) => (
                <div key={index} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {/* AI Avatar */}
                  {msg.role === "assistant" && (
                    <div className="shrink-0 w-8 h-8 rounded-lg border border-line flex items-center justify-center text-sm mt-0.5" style={{ background: `linear-gradient(135deg, var(--c-ai-avatar-from), var(--c-ai-avatar-to))` }}>
                      {currentPersona?.emoji || "✨"}
                    </div>
                  )}

                  {/* Assistant message with thinking + tools + content */}
                  {msg.role === "assistant" ? (
                    <div className="max-w-[80%] space-y-2 min-w-0">
                      {/* ── Thinking Block ── */}
                      {msg.thinking && msg.thinking.content && (
                        <div className="thinking-block rounded-xl overflow-hidden border" style={{ borderColor: "var(--c-accent-border)", background: "var(--c-accent-soft)" }}>
                          <button
                            onClick={() => toggleThinking(index)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:opacity-80 transition-opacity"
                            style={{ color: "var(--c-accent-text)" }}
                          >
                            {!msg.thinking.isComplete ? SpinnerIcon : BrainIcon}
                            <span className="font-medium">{msg.thinking.isComplete ? "思考过程" : "思考中..."}</span>
                            <span className={`ml-auto transition-transform duration-200 ${isThinkingExpanded(index, msg.thinking.isComplete) ? "rotate-180" : ""}`}>{ChevronIcon}</span>
                          </button>
                          {isThinkingExpanded(index, msg.thinking.isComplete) && (
                            <div className="thinking-content px-3 pb-2.5 text-xs leading-relaxed whitespace-pre-wrap border-t" style={{ color: "var(--c-ink-secondary)", borderColor: "var(--c-accent-border)", opacity: 0.8 }}>
                              {msg.thinking.content}
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── Tool Call Cards ── */}
                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                        <div className="space-y-1.5">
                          {msg.toolCalls.map((tc, tcIdx) => {
                            const key = `${index}-${tcIdx}`;
                            const expanded = isToolExpanded(key, tc.isComplete);
                            return (
                              <div key={tcIdx} className="tool-call-card rounded-xl border overflow-hidden" style={{ borderColor: "var(--c-line)", background: "var(--c-card)" }}>
                                <button
                                  onClick={() => toggleTool(key)}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:opacity-80 transition-opacity"
                                >
                                  {!tc.isComplete ? (
                                    <span className="text-accent-text">{SpinnerIcon}</span>
                                  ) : (
                                    <span className="text-green-text">{CheckIcon}</span>
                                  )}
                                  <span className="shrink-0">{getToolIcon(tc.name)}</span>
                                  <span className="font-medium text-ink-secondary truncate">{getToolDisplayName(tc.name)}</span>
                                  {tc.isComplete && tc.input && Object.keys(tc.input).length > 0 && (
                                    <span className="text-ink-faint truncate max-w-[180px] hidden sm:inline">
                                      {Object.values(tc.input).map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(", ").slice(0, 50)}
                                    </span>
                                  )}
                                  <span className={`ml-auto transition-transform duration-200 shrink-0 ${expanded ? "rotate-180" : ""}`}>{ChevronIcon}</span>
                                </button>
                                {expanded && (
                                  <div className="tool-detail-content px-3 pb-2.5 text-xs border-t" style={{ borderColor: "var(--c-line)" }}>
                                    {Object.keys(tc.input).length > 0 && (
                                      <div className="mt-1.5">
                                        <span className="text-ink-faint text-[10px] uppercase tracking-wide">Input</span>
                                        <pre className="text-ink-muted mt-0.5 whitespace-pre-wrap break-all leading-relaxed" style={{ maxHeight: "120px", overflowY: "auto" }}>{JSON.stringify(tc.input, null, 2)}</pre>
                                      </div>
                                    )}
                                    {tc.result && (
                                      <div className="mt-2">
                                        <span className="text-ink-faint text-[10px] uppercase tracking-wide">Output</span>
                                        <pre className="text-ink-muted mt-0.5 whitespace-pre-wrap break-all leading-relaxed" style={{ maxHeight: "150px", overflowY: "auto" }}>{tc.result}</pre>
                                      </div>
                                    )}
                                    {!tc.isComplete && !tc.result && (
                                      <div className="mt-1.5 text-ink-faint">
                                        <span className="loading-dots">执行中</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* ── Content ── */}
                      {msg.content && (
                        <div className="rounded-2xl border px-4 py-3" style={{ background: "var(--c-ai-bubble)", borderColor: "var(--c-ai-bubble-border)", boxShadow: "var(--c-shadow)" }}>
                          <div className="markdown-body text-sm leading-relaxed"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{msg.content}</ReactMarkdown></div>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* User message */
                    <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-linear-to-r from-violet-600 to-blue-600 text-white">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                    </div>
                  )}

                  {/* User Avatar */}
                  {msg.role === "user" && (
                    userInfo?.image ? (
                      <img src={userInfo.image} alt={userInfo.name} className="shrink-0 w-8 h-8 rounded-lg object-cover mt-0.5" />
                    ) : (
                      <div className="shrink-0 w-8 h-8 rounded-lg bg-linear-to-br from-violet-600 to-blue-600 flex items-center justify-center text-xs font-bold text-white mt-0.5">
                        {userInfo?.name?.charAt(0).toUpperCase() || "👤"}
                      </div>
                    )
                  )}
                </div>
              ))
            )}

            {loading && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg border border-line flex items-center justify-center text-sm" style={{ background: `linear-gradient(135deg, var(--c-ai-avatar-from), var(--c-ai-avatar-to))` }}>
                  {currentPersona?.emoji || "✨"}
                </div>
                <div className="rounded-2xl border px-4 py-3" style={{ background: "var(--c-ai-bubble)", borderColor: "var(--c-ai-bubble-border)" }}>
                  <div className="flex space-x-1.5">
                    <div className="h-2 w-2 rounded-full animate-bounce [animation-delay:-0.3s]" style={{ background: "var(--c-loading-dot)" }}></div>
                    <div className="h-2 w-2 rounded-full animate-bounce [animation-delay:-0.15s]" style={{ background: "var(--c-loading-dot)" }}></div>
                    <div className="h-2 w-2 rounded-full animate-bounce" style={{ background: "var(--c-loading-dot)" }}></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        {currentSessionId && (
          <div className="shrink-0 px-4 pb-4 pt-2">
            <div className="mx-auto max-w-3xl">
              <div className="rounded-2xl bg-card border border-line p-2 flex items-end gap-2 focus-within:border-violet-500/50 transition-colors" style={{ boxShadow: "var(--c-shadow)" }}>
                <div className="flex gap-1 pl-1">
                  <button onClick={() => setWebSearchEnabled(!webSearchEnabled)} disabled={loading}
                    className={`rounded-lg p-2 transition-all disabled:opacity-30 ${webSearchEnabled ? "text-green-text bg-green-soft" : "text-ink-faint hover:text-ink-muted hover:bg-card-hover"}`}
                    title={webSearchEnabled ? "联网搜索已开启" : "联网搜索已关闭"}>
                    {GlobeIcon}
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*,.pdf,.xlsx,.xls,.csv,.doc,.docx,.txt" onChange={handleFileUpload} className="hidden" />
                  <button onClick={() => fileInputRef.current?.click()} disabled={loading}
                    className="rounded-lg p-2 text-ink-faint hover:text-ink-muted hover:bg-card-hover transition-all disabled:opacity-30" title="上传文件">
                    {ClipIcon}
                  </button>
                </div>
                <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
                  placeholder="输入消息..." className="flex-1 bg-transparent text-sm placeholder-ink-faint outline-none py-2 px-1" disabled={loading} />
                <button onClick={sendMessage} disabled={loading || !input.trim()}
                  className="shrink-0 rounded-xl bg-linear-to-r from-violet-600 to-blue-600 p-2.5 text-white transition-all hover:shadow-lg hover:shadow-violet-500/20 disabled:opacity-30 disabled:cursor-not-allowed">
                  {SendIcon}
                </button>
              </div>
              {webSearchEnabled && (
                <div className="flex items-center gap-1 mt-2 px-2">
                  <span className="flex items-center gap-1 text-[11px] text-green-text">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-text animate-pulse"></span>
                    联网搜索已开启
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ===== Persona Picker ===== */}
      {personaPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm" onClick={() => setPersonaPickerOpen(false)}>
          <div className="w-full max-w-lg mx-4 rounded-2xl bg-modal border border-line shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-line">
              <h2 className="text-base font-semibold">选择角色</h2>
              <button onClick={() => setPersonaPickerOpen(false)} className="text-ink-muted hover:text-ink transition-colors">{CloseIcon}</button>
            </div>
            <div className="p-4 grid grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto">
              {allPersonas.map((p) => (
                <button key={p.id} onClick={() => createNewSession(p.id)}
                  className="flex items-center gap-3 rounded-xl bg-card hover:bg-card-hover border border-line hover:border-accent-border px-4 py-3 text-left transition-all group">
                  <span className="text-2xl group-hover:scale-110 transition-transform">{p.emoji}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-xs text-ink-muted truncate">{p.desc}</p>
                  </div>
                </button>
              ))}
              <button onClick={() => { setPersonaPickerOpen(false); setPersonaModalOpen(true); }}
                className="flex items-center gap-3 rounded-xl border border-dashed border-line hover:border-accent-border px-4 py-3 text-left transition-all group">
                <span className="w-10 h-10 rounded-lg bg-card flex items-center justify-center text-ink-faint group-hover:text-accent-text transition-colors">{PlusIcon}</span>
                <div>
                  <p className="text-sm font-medium text-ink-muted group-hover:text-ink-secondary">创建新角色</p>
                  <p className="text-xs text-ink-faint">自定义人设和提示词</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Persona Manager ===== */}
      {personaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm" onClick={() => setPersonaModalOpen(false)}>
          <div className="w-full max-w-xl mx-4 rounded-2xl bg-modal border border-line shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-line">
              <h2 className="text-base font-semibold">管理角色</h2>
              <button onClick={() => setPersonaModalOpen(false)} className="text-ink-muted hover:text-ink transition-colors">{CloseIcon}</button>
            </div>
            <div className="p-6 space-y-4 border-b border-line">
              <h3 className="text-sm font-medium text-ink-secondary">创建新角色</h3>
              <div className="grid grid-cols-[auto_1fr] gap-3">
                <div>
                  <label className="text-xs text-ink-muted mb-1 block">Emoji</label>
                  <input value={newPersona.emoji} onChange={(e) => setNewPersona({ ...newPersona, emoji: e.target.value })}
                    className="w-14 h-10 rounded-lg bg-input-bg border border-line text-center text-lg outline-none focus:border-violet-500/50" maxLength={4} />
                </div>
                <div>
                  <label className="text-xs text-ink-muted mb-1 block">角色名称</label>
                  <input value={newPersona.name} onChange={(e) => setNewPersona({ ...newPersona, name: e.target.value })} placeholder="例：旅行顾问"
                    className="w-full h-10 rounded-lg bg-input-bg border border-line px-3 text-sm placeholder-ink-faint outline-none focus:border-violet-500/50" />
                </div>
              </div>
              <div>
                <label className="text-xs text-ink-muted mb-1 block">简短描述</label>
                <input value={newPersona.description} onChange={(e) => setNewPersona({ ...newPersona, description: e.target.value })} placeholder="一句话描述角色特点"
                  className="w-full h-10 rounded-lg bg-input-bg border border-line px-3 text-sm placeholder-ink-faint outline-none focus:border-violet-500/50" />
              </div>
              <div>
                <label className="text-xs text-ink-muted mb-1 block">系统提示词 (System Prompt)</label>
                <textarea value={newPersona.prompt} onChange={(e) => setNewPersona({ ...newPersona, prompt: e.target.value })}
                  placeholder={"定义角色的性格、说话风格、能力范围...\n例：你是一个专业的旅行顾问，擅长规划行程。"} rows={4}
                  className="w-full rounded-lg bg-input-bg border border-line px-3 py-2.5 text-sm placeholder-ink-faint outline-none resize-none focus:border-violet-500/50" />
              </div>
              <div>
                <label className="text-xs text-ink-muted mb-1 block">温度 (Temperature: {newPersona.temperature})</label>
                <input type="range" min="0" max="1" step="0.05" value={newPersona.temperature} onChange={(e) => setNewPersona({ ...newPersona, temperature: parseFloat(e.target.value) })} className="w-full" />
                <div className="flex justify-between text-[10px] text-ink-faint mt-1"><span>精确</span><span>创意</span></div>
              </div>
              <button onClick={handleCreatePersona} disabled={!newPersona.name.trim() || !newPersona.prompt.trim()}
                className="w-full rounded-xl bg-linear-to-r from-violet-600 to-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-30 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-violet-500/20 transition-all">
                创建角色
              </button>
            </div>
            {customPersonas.length > 0 && (
              <div className="p-6 space-y-2">
                <h3 className="text-sm font-medium text-ink-secondary mb-3">已创建的角色</h3>
                {customPersonas.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-xl bg-card border border-line px-4 py-3">
                    <span className="text-xl">{p.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="text-xs text-ink-muted truncate">{p.description}</p>
                    </div>
                    <button onClick={() => handleDeletePersona(p.id)} className="shrink-0 text-ink-faint hover:text-red-500 transition-colors" title="删除">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== Analysis Modal ===== */}
      {analyzeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm" onClick={() => setAnalyzeOpen(false)}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-modal border border-line shadow-2xl mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <div><h2 className="text-base font-semibold">文本分析器</h2><p className="text-xs text-ink-muted mt-0.5">Output Parser — 结构化 JSON 输出</p></div>
              <button onClick={() => setAnalyzeOpen(false)} className="text-ink-muted hover:text-ink transition-colors">{CloseIcon}</button>
            </div>
            <div className="px-6 py-4">
              <textarea value={analyzeText} onChange={(e) => setAnalyzeText(e.target.value)} placeholder="粘贴一段文本，AI 会返回结构化的分析结果..."
                className="w-full h-32 rounded-xl bg-input-bg border border-line px-4 py-3 text-sm placeholder-ink-faint outline-none resize-none focus:border-violet-500/50" />
              <button onClick={handleAnalyze} disabled={analyzeLoading || !analyzeText.trim()}
                className="mt-3 w-full rounded-xl bg-linear-to-r from-violet-600 to-blue-600 px-6 py-3 text-sm font-medium text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                {analyzeLoading ? "分析中..." : "开始分析"}
              </button>
            </div>
            {analysisResult && (
              <div className="px-6 pb-6 space-y-4">
                <div className="h-px bg-line" />
                <div className="rounded-xl bg-accent-soft border border-accent-border p-4">
                  <h3 className="text-xs font-semibold text-accent-text uppercase tracking-wide mb-1">摘要</h3>
                  <p className="text-sm text-ink-secondary leading-relaxed">{analysisResult.summary}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-card border border-line p-4">
                    <h3 className="text-xs text-ink-muted uppercase tracking-wide mb-2">情感倾向</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{sentimentMap[analysisResult.sentiment]?.emoji}</span>
                      <span className="rounded-full bg-accent-soft border border-accent-border px-3 py-1 text-sm font-medium text-accent-text">{sentimentMap[analysisResult.sentiment]?.label}</span>
                    </div>
                  </div>
                  <div className="rounded-xl bg-card border border-line p-4">
                    <h3 className="text-xs text-ink-muted uppercase tracking-wide mb-2">情感强度</h3>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-bold">{Math.round(analysisResult.sentimentScore * 100)}%</span>
                      <div className="flex-1 h-2 bg-card-hover rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-linear-to-r from-violet-500 to-blue-500 transition-all" style={{ width: `${analysisResult.sentimentScore * 100}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl bg-card border border-line p-4">
                  <h3 className="text-xs text-ink-muted uppercase tracking-wide mb-2">关键词</h3>
                  <div className="flex flex-wrap gap-2">
                    {analysisResult.keywords.map((kw, i) => (
                      <span key={i} className="rounded-full bg-accent-soft border border-accent-border px-3 py-1 text-sm text-accent-text">{kw}</span>
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
                      <p className="text-[10px] text-ink-faint uppercase">{item.label}</p>
                      <p className="text-sm font-medium text-ink-secondary mt-1">{item.value}</p>
                    </div>
                  ))}
                </div>
                <details className="rounded-xl bg-card border border-line">
                  <summary className="px-4 py-3 text-xs text-ink-muted cursor-pointer hover:text-ink-secondary">查看原始 JSON</summary>
                  <pre className="px-4 pb-4 text-xs text-ink-muted overflow-x-auto">{JSON.stringify(analysisResult, null, 2)}</pre>
                </details>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== MCP Management Modal (Redesigned with Tabs) ===== */}
      {mcpModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm" onClick={() => setMcpModalOpen(false)}>
          <div className="w-full max-w-2xl mx-4 rounded-2xl bg-modal border border-line shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="shrink-0 px-6 py-4 border-b border-line">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold">MCP 工具中心</h2>
                  <p className="text-xs text-ink-muted mt-0.5">安装和管理 AI 外部工具能力</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setMcpTutorialOpen(!mcpTutorialOpen)}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${mcpTutorialOpen ? "border-accent-border bg-accent-soft text-accent-text" : "border-line text-ink-muted hover:text-ink-secondary hover:bg-card-hover"}`}
                  >
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      使用说明
                    </span>
                  </button>
                  <button onClick={() => setMcpModalOpen(false)} className="text-ink-muted hover:text-ink transition-colors">{CloseIcon}</button>
                </div>
              </div>

              {/* Tutorial */}
              {mcpTutorialOpen && (
                <div className="mt-4 p-4 rounded-xl border border-accent-border bg-accent-soft/50 space-y-3">
                  <div>
                    <h4 className="text-xs font-semibold text-accent-text mb-1">什么是 MCP？</h4>
                    <p className="text-xs text-ink-secondary leading-relaxed">
                      MCP (Model Context Protocol) 是一个开放协议，让 AI 模型安全地连接和使用外部工具与数据源。
                      通过安装 MCP 服务器，AI 助手可以获得浏览网页、操作文件、搜索数据库等强大能力。
                    </p>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-accent-text mb-1">如何使用？</h4>
                    <ol className="text-xs text-ink-secondary leading-relaxed space-y-1 list-decimal pl-4">
                      <li>在「市场」标签页浏览可用的 MCP 工具，点击「一键安装」</li>
                      <li>部分工具需要额外配置（如 API Key），安装时会提示填写</li>
                      <li>在「已安装」标签页可以开启、关闭或删除已安装的工具</li>
                      <li>也可以在「自定义」标签页手动添加任意 MCP 服务</li>
                      <li>对话时已开启的 MCP 工具将自动可用，AI 会根据需要调用</li>
                    </ol>
                  </div>
                  <div className="p-2.5 rounded-lg bg-card border border-line">
                    <p className="text-[11px] text-ink-muted">
                      <strong>注意：</strong>Stdio 类型的 MCP 需要服务端已安装 Node.js (v18+)。工具首次使用时会自动通过 npx 下载，可能需要几秒钟。
                    </p>
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
                    className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors ${mcpTab === tab.key ? "text-accent-text tab-active" : "text-ink-muted hover:text-ink-secondary"}`}
                  >
                    <span>{tab.icon}</span>
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto">
              {/* ── Market Tab ── */}
              {mcpTab === "market" && (
                <div className="p-5">
                  <div className="grid grid-cols-2 gap-3">
                    {PRESET_MCP_SERVERS.map((preset) => {
                      const installed = isPresetInstalled(preset.id);
                      return (
                        <div key={preset.id} className="mcp-preset-card p-4 rounded-xl border border-line bg-card">
                          <div className="flex items-start gap-3">
                            <span className="text-2xl shrink-0 mt-0.5">{preset.icon}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-medium truncate">{preset.name}</h4>
                                {preset.envKeys && (
                                  <span className="shrink-0 text-[9px] rounded px-1 py-0.5 bg-orange-500/10 text-orange-600">需配置</span>
                                )}
                              </div>
                              <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">{preset.description}</p>
                            </div>
                          </div>
                          <div className="mt-3 flex items-center gap-2">
                            <span className="text-[10px] text-ink-faint font-mono truncate flex-1">{preset.command} {preset.args.slice(0, 2).join(" ")}</span>
                            {installed ? (
                              <span className="shrink-0 text-xs text-green-text flex items-center gap-1 bg-green-soft px-2.5 py-1 rounded-lg">
                                {CheckIcon} 已安装
                              </span>
                            ) : (
                              <button
                                onClick={() => handleInstallPreset(preset)}
                                className="shrink-0 text-xs bg-linear-to-r from-violet-600 to-blue-600 text-white px-3 py-1.5 rounded-lg hover:shadow-md hover:shadow-violet-500/20 transition-all"
                              >
                                一键安装
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Installed Tab ── */}
              {mcpTab === "installed" && (
                <div className="p-5">
                  {mcpServers.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-3xl mb-3">📦</p>
                      <p className="text-sm text-ink-muted">暂未安装任何 MCP 工具</p>
                      <p className="text-xs text-ink-faint mt-1">去「市场」标签页一键安装，或在「自定义」标签页手动添加</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {mcpServers.map((s) => (
                        <div key={s.id} className="flex items-center gap-3 rounded-xl bg-card border border-line px-4 py-3">
                          <button onClick={() => handleToggleMcpServer(s.id, !s.enabled)}
                            className={`shrink-0 w-9 h-5 rounded-full transition-all relative ${s.enabled ? "bg-green-500" : "bg-ink-faint/30"}`}>
                            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${s.enabled ? "left-[18px]" : "left-0.5"}`} />
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium truncate">{s.name}</p>
                              <span className={`text-[10px] rounded px-1.5 py-0.5 ${s.transport === "stdio" ? "bg-blue-500/10 text-blue-600" : "bg-orange-500/10 text-orange-600"}`}>
                                {s.transport.toUpperCase()}
                              </span>
                            </div>
                            <p className="text-xs text-ink-muted truncate">
                              {s.transport === "stdio"
                                ? `${s.command} ${s.args ? JSON.parse(s.args).join(" ") : ""}`
                                : s.url}
                            </p>
                          </div>
                          <button onClick={() => handleDeleteMcpServer(s.id)} className="shrink-0 text-ink-faint hover:text-red-500 transition-colors" title="删除">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Custom Tab ── */}
              {mcpTab === "custom" && (
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-ink-muted mb-1 block">服务名称</label>
                      <input value={newMcp.name} onChange={(e) => setNewMcp({ ...newMcp, name: e.target.value })} placeholder="例：filesystem"
                        className="w-full h-10 rounded-lg bg-input-bg border border-line px-3 text-sm placeholder-ink-faint outline-none focus:border-violet-500/50" />
                    </div>
                    <div>
                      <label className="text-xs text-ink-muted mb-1 block">传输类型</label>
                      <select value={newMcp.transport} onChange={(e) => setNewMcp({ ...newMcp, transport: e.target.value as "stdio" | "http" })}
                        className="w-full h-10 rounded-lg bg-input-bg border border-line px-3 text-sm outline-none focus:border-violet-500/50">
                        <option value="stdio">Stdio (本地命令)</option>
                        <option value="http">HTTP (远程服务)</option>
                      </select>
                    </div>
                  </div>

                  {newMcp.transport === "stdio" ? (
                    <>
                      <div>
                        <label className="text-xs text-ink-muted mb-1 block">命令 (Command)</label>
                        <input value={newMcp.command} onChange={(e) => setNewMcp({ ...newMcp, command: e.target.value })} placeholder="例：npx"
                          className="w-full h-10 rounded-lg bg-input-bg border border-line px-3 text-sm placeholder-ink-faint outline-none focus:border-violet-500/50" />
                      </div>
                      <div>
                        <label className="text-xs text-ink-muted mb-1 block">参数 (Args，空格分隔)</label>
                        <input value={newMcp.args} onChange={(e) => setNewMcp({ ...newMcp, args: e.target.value })} placeholder="例：-y @modelcontextprotocol/server-filesystem /tmp"
                          className="w-full h-10 rounded-lg bg-input-bg border border-line px-3 text-sm placeholder-ink-faint outline-none focus:border-violet-500/50" />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="text-xs text-ink-muted mb-1 block">URL</label>
                        <input value={newMcp.url} onChange={(e) => setNewMcp({ ...newMcp, url: e.target.value })} placeholder="例：https://example.com/mcp"
                          className="w-full h-10 rounded-lg bg-input-bg border border-line px-3 text-sm placeholder-ink-faint outline-none focus:border-violet-500/50" />
                      </div>
                      <div>
                        <label className="text-xs text-ink-muted mb-1 block">Headers (可选，JSON 格式)</label>
                        <input value={newMcp.headers} onChange={(e) => setNewMcp({ ...newMcp, headers: e.target.value })} placeholder='例：{"Authorization":"Bearer xxx"}'
                          className="w-full h-10 rounded-lg bg-input-bg border border-line px-3 text-sm placeholder-ink-faint outline-none focus:border-violet-500/50" />
                      </div>
                    </>
                  )}

                  <button onClick={handleAddMcpServer}
                    disabled={!newMcp.name.trim() || (newMcp.transport === "stdio" ? !newMcp.command.trim() : !newMcp.url.trim())}
                    className="w-full rounded-xl bg-linear-to-r from-violet-600 to-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-30 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-violet-500/20 transition-all">
                    添加 Server
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== Preset Config Dialog ===== */}
      {presetInstalling && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-overlay backdrop-blur-sm" onClick={() => setPresetInstalling(null)}>
          <div className="w-full max-w-md mx-4 rounded-2xl bg-modal border border-line shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-line">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <span className="text-xl">{presetInstalling.icon}</span>
                安装 {presetInstalling.name}
              </h3>
              {presetInstalling.configHint && (
                <p className="text-xs text-ink-muted mt-1">{presetInstalling.configHint}</p>
              )}
            </div>
            <div className="p-6 space-y-3">
              {presetInstalling.envKeys?.map(key => (
                <div key={key}>
                  <label className="text-xs text-ink-muted mb-1 block">
                    {presetInstalling.envLabels?.[key] || key}
                  </label>
                  <input
                    value={presetEnvValues[key] || ""}
                    onChange={(e) => setPresetEnvValues(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={presetInstalling.envPlaceholders?.[key] || ""}
                    className="w-full h-10 rounded-lg bg-input-bg border border-line px-3 text-sm placeholder-ink-faint outline-none focus:border-violet-500/50 font-mono"
                  />
                </div>
              ))}
              <div className="flex gap-2 pt-2">
                <button onClick={() => setPresetInstalling(null)}
                  className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm text-ink-muted hover:bg-card-hover transition-all">
                  取消
                </button>
                <button
                  onClick={() => doInstallPreset(presetInstalling, presetEnvValues)}
                  disabled={presetInstalling.envKeys?.some(k => !presetEnvValues[k]?.trim())}
                  className="flex-1 rounded-xl bg-linear-to-r from-violet-600 to-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-30 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-violet-500/20 transition-all">
                  确认安装
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
