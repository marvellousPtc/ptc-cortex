/*
 * :file description: 
 * :name: /langchain-chat/src/app/page.tsx
 * :author: PTC
 * :copyright: (c) 2026, Tungee
 * :date created: 2026-02-11 17:09:08
 * :last editor: PTC
 * :date last edited: 2026-02-12 14:23:31
 */
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Session {
  id: string;
  title: string;
  persona: string;
  created_at: string;
  updated_at: string;
}

interface AnalysisResult {
  summary: string;
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  sentimentScore: number;
  keywords: string[];
  category: string;
  language: string;
  wordCount: number;
  readingTime: string;
}

const PERSONAS = [
  { id: "assistant", name: "🤖 通用助手", desc: "友好简洁，有问必答" },
  { id: "cat", name: "🐱 猫娘小喵", desc: "可爱撒娇，句尾带喵~" },
  { id: "coder", name: "💻 编程导师", desc: "代码示例，通俗易懂" },
  { id: "poet", name: "🎭 文艺诗人", desc: "诗意表达，富有哲理" },
  { id: "wife", name: "💕 老婆小美", desc: "性感妩媚，甜蜜撒娇" },
];

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [analyzeText, setAnalyzeText] = useState("");
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 加载会话列表
  const loadSessions = useCallback(async () => {
    const res = await fetch("/api/sessions");
    const data = await res.json();
    setSessions(data.sessions);
  }, []);

  // 加载某个会话的消息
  const loadMessages = useCallback(async (sessionId: string) => {
    const res = await fetch(`/api/sessions?id=${sessionId}`);
    const data = await res.json();
    setMessages(
      data.messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      }))
    );
  }, []);

  // 初始化：加载会话列表
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // 切换会话时加载消息
  useEffect(() => {
    if (currentSessionId) {
      loadMessages(currentSessionId);
    }
  }, [currentSessionId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 创建新会话
  const createNewSession = async (persona: string = "assistant") => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona }),
    });
    const data = await res.json();
    setSessions((prev) => [data.session, ...prev]);
    setCurrentSessionId(data.session.id);
    setMessages([]);
  };

  // 删除会话
  const deleteSessionById = async (id: string) => {
    await fetch(`/api/sessions?id=${id}`, { method: "DELETE" });
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (currentSessionId === id) {
      setCurrentSessionId(null);
      setMessages([]);
    }
  };

  // 发送消息
  const sendMessage = async () => {
    if (!input.trim() || loading || !currentSessionId) return;

    const userMessage: Message = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          sessionId: currentSessionId,
          webSearchEnabled,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setMessages([
          ...newMessages,
          { role: "assistant", content: `❌ 错误: ${data.error}` },
        ]);
        return;
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error("无法获取响应流");

      const aiMessageIndex = newMessages.length;
      setMessages([...newMessages, { role: "assistant", content: "" }]);

      let fullContent = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        fullContent += text;

        const updatedContent = fullContent;
        setMessages((prev) => {
          const updated = [...prev];
          updated[aiMessageIndex] = {
            role: "assistant",
            content: updatedContent,
          };
          return updated;
        });
      }

      // 聊天结束后刷新会话列表（标题可能更新了）
      loadSessions();
    } catch {
      setMessages((prev) => [
        ...prev.filter((m) => m.content !== ""),
        { role: "assistant", content: "❌ 网络错误，请检查服务是否正常运行" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // 上传文件（图片/文档）
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentSessionId) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.url) {
        const isImage = file.type.startsWith("image/");
        if (isImage) {
          // 图片：把 URL 告诉 AI，让它调用 analyze_image 工具
          setInput(`请分析这张图片: ${window.location.origin}${data.url}`);
        } else {
          // 文档：把 URL 告诉 AI，让它调用 parse_file 工具
          setInput(`请解析这个文件: ${data.filename} (路径: ${data.url})`);
        }
      }
    } catch {
      alert("文件上传失败");
    }
    // 重置 input 允许重复上传同一文件
    e.target.value = "";
  };

  // 文本分析
  const handleAnalyze = async () => {
    if (!analyzeText.trim() || analyzeLoading) return;
    setAnalyzeLoading(true);
    setAnalysisResult(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: analyzeText.trim() }),
      });
      const data = await res.json();
      if (data.analysis) {
        setAnalysisResult(data.analysis);
      } else {
        alert(data.error || "分析失败");
      }
    } catch {
      alert("网络错误");
    } finally {
      setAnalyzeLoading(false);
    }
  };

  const sentimentMap: Record<string, { label: string; color: string; emoji: string }> = {
    positive: { label: "积极", color: "text-green-600 bg-green-50", emoji: "😊" },
    negative: { label: "消极", color: "text-red-600 bg-red-50", emoji: "😟" },
    neutral: { label: "中性", color: "text-gray-600 bg-gray-100", emoji: "😐" },
    mixed: { label: "混合", color: "text-yellow-600 bg-yellow-50", emoji: "🤔" },
  };

  const categoryMap: Record<string, string> = {
    technology: "科技", business: "商业", life: "生活",
    education: "教育", news: "新闻", opinion: "观点", other: "其他",
  };

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const currentPersona = PERSONAS.find(
    (p) => p.id === (currentSession?.persona || "assistant")
  );

  return (
    <div className="flex h-screen bg-gray-50">
      {/* ===== 左侧边栏：会话列表 ===== */}
      <aside
        className={`${
          sidebarOpen ? "w-64" : "w-0"
        } shrink-0 overflow-hidden transition-all duration-200 border-r bg-white`}
      >
        <div className="flex h-full w-64 flex-col">
          {/* 新建会话按钮 */}
          <div className="p-3 border-b">
            <button
              onClick={() => createNewSession()}
              className="w-full rounded-lg border border-dashed border-gray-300 px-4 py-2.5 text-sm text-gray-600 hover:border-blue-400 hover:text-blue-500 transition-colors"
            >
              + 新建对话
            </button>
          </div>

          {/* 会话列表 */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sessions.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-8">
                还没有对话，点击上方按钮开始
              </p>
            )}
            {sessions.map((session) => {
              const persona = PERSONAS.find((p) => p.id === session.persona);
              return (
                <div
                  key={session.id}
                  className={`group flex items-center rounded-lg px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                    currentSessionId === session.id
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                  onClick={() => setCurrentSessionId(session.id)}
                >
                  <span className="mr-2 text-base">
                    {persona?.name.charAt(0) || "🤖"}
                  </span>
                  <span className="flex-1 truncate">{session.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSessionById(session.id);
                    }}
                    className="hidden group-hover:block ml-1 text-gray-400 hover:text-red-500 text-xs"
                    title="删除"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          {/* 人设快捷入口 */}
          <div className="border-t p-3">
            <p className="text-xs text-gray-400 mb-2">快速创建</p>
            <div className="flex flex-wrap gap-1">
              {PERSONAS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => createNewSession(p.id)}
                  className="rounded-full px-2 py-1 text-xs bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                  title={p.desc}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* ===== 右侧主区域 ===== */}
      <div className="flex flex-1 flex-col">
        {/* 顶部栏 */}
        <header className="border-b bg-white px-4 py-3 shadow-sm flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 transition-colors"
            title={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex-1">
            <h1 className="text-base font-bold text-gray-800">
              {currentSession ? currentSession.title : "🤖 LangChain Chat"}
            </h1>
            <p className="text-xs text-gray-400">
              {currentPersona
                ? `${currentPersona.name} · ${currentPersona.desc}`
                : "第七课：Output Parser — 结构化输出"}
            </p>
          </div>
          <button
            onClick={() => { setAnalyzeOpen(true); setAnalysisResult(null); }}
            className="rounded-lg px-3 py-1.5 text-xs font-medium bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors"
          >
            📊 文本分析
          </button>
        </header>

        {/* 消息区域 */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-2xl space-y-4">
            {!currentSessionId ? (
              // 未选择会话时的欢迎页
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <div className="text-6xl mb-4">💬</div>
                <p className="text-lg font-medium">选择一个对话，或创建新的</p>
                <p className="text-sm mt-2">
                  对话记录会保存在数据库中，刷新页面也不会丢失
                </p>
                <button
                  onClick={() => createNewSession()}
                  className="mt-6 rounded-xl bg-blue-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-600 transition-colors"
                >
                  开始新对话
                </button>
              </div>
            ) : messages.length === 0 ? (
              // 选择了会话但没有消息
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <div className="text-6xl mb-4">
                  {currentSession?.persona === "cat"
                    ? "🐱"
                    : currentSession?.persona === "coder"
                      ? "💻"
                      : currentSession?.persona === "poet"
                        ? "🎭"
                        : currentSession?.persona === "wife"
                          ? "💕"
                          : "🤖"}
                </div>
                <p className="text-lg font-medium">
                  {currentPersona?.name}
                </p>
                <p className="text-sm mt-1">{currentPersona?.desc}</p>
                <p className="text-xs mt-3 text-gray-300">
                  发送一条消息开始对话吧
                </p>
              </div>
            ) : (
              // 消息列表
              messages.map((msg, index) => (
                <div
                  key={index}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                      msg.role === "user"
                        ? "bg-blue-500 text-white"
                        : "bg-white text-gray-800 shadow-sm border border-gray-100"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <div className="markdown-body text-sm leading-relaxed">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeHighlight]}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">
                        {msg.content}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}

            {/* 加载动画 */}
            {loading && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-white px-4 py-3 shadow-sm border border-gray-100">
                  <div className="flex space-x-1">
                    <div className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="h-2 w-2 rounded-full bg-gray-400 animate-bounce"></div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 输入区域 */}
        {currentSessionId && (
          <div className="border-t bg-white px-4 py-4">
            <div className="mx-auto flex max-w-2xl gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.xlsx,.xls,.csv,.doc,.docx,.txt"
                onChange={handleFileUpload}
                className="hidden"
              />
              {/* 联网搜索开关 */}
              <button
                onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                disabled={loading}
                className={`rounded-xl border px-3 py-3 transition-colors disabled:opacity-50 ${
                  webSearchEnabled
                    ? "border-green-400 bg-green-50 text-green-600"
                    : "border-gray-200 text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                }`}
                title={webSearchEnabled ? "联网搜索已开启" : "联网搜索已关闭"}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
              </button>
              {/* 文件上传 */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="rounded-xl border border-gray-200 px-3 py-3 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors disabled:opacity-50"
                title="上传图片或文件"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息... (Enter 发送)"
                className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 placeholder-gray-400 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                disabled={loading}
              />
              <button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="rounded-xl bg-blue-500 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                发送
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ===== 文本分析弹窗（第七课：Output Parser） ===== */}
      {analyzeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl mx-4">
            {/* 弹窗标题 */}
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-lg font-bold text-gray-800">📊 文本分析器</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Output Parser — AI 返回结构化 JSON，不再是自由文本
                </p>
              </div>
              <button
                onClick={() => setAnalyzeOpen(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* 输入区域 */}
            <div className="px-6 py-4">
              <textarea
                value={analyzeText}
                onChange={(e) => setAnalyzeText(e.target.value)}
                placeholder="粘贴或输入一段文本，AI 会返回结构化的分析结果（情感、关键词、摘要、分类等）..."
                className="w-full h-32 rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 placeholder-gray-400 outline-none resize-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
              />
              <button
                onClick={handleAnalyze}
                disabled={analyzeLoading || !analyzeText.trim()}
                className="mt-3 w-full rounded-xl bg-purple-500 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {analyzeLoading ? "🔄 AI 正在分析中..." : "开始分析"}
              </button>
            </div>

            {/* 分析结果卡片 */}
            {analysisResult && (
              <div className="px-6 pb-6 space-y-4">
                <div className="h-px bg-gray-100" />

                {/* 摘要 */}
                <div className="rounded-xl bg-blue-50 p-4">
                  <h3 className="text-xs font-semibold text-blue-500 uppercase tracking-wide mb-1">📝 摘要</h3>
                  <p className="text-sm text-gray-700 leading-relaxed">{analysisResult.summary}</p>
                </div>

                {/* 情感 + 分数 */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-white border border-gray-100 p-4">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">情感倾向</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{sentimentMap[analysisResult.sentiment]?.emoji}</span>
                      <span className={`rounded-full px-3 py-1 text-sm font-medium ${sentimentMap[analysisResult.sentiment]?.color}`}>
                        {sentimentMap[analysisResult.sentiment]?.label}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-xl bg-white border border-gray-100 p-4">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">情感强度</h3>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-bold text-gray-800">
                        {Math.round(analysisResult.sentimentScore * 100)}%
                      </span>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-linear-to-r from-purple-400 to-purple-600 transition-all"
                          style={{ width: `${analysisResult.sentimentScore * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 关键词 */}
                <div className="rounded-xl bg-white border border-gray-100 p-4">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">🔑 关键词</h3>
                  <div className="flex flex-wrap gap-2">
                    {analysisResult.keywords.map((kw, i) => (
                      <span key={i} className="rounded-full bg-purple-50 px-3 py-1 text-sm text-purple-700 font-medium">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>

                {/* 元信息 */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="rounded-xl bg-gray-50 p-3 text-center">
                    <p className="text-xs text-gray-400">分类</p>
                    <p className="text-sm font-medium text-gray-700 mt-1">{categoryMap[analysisResult.category] || analysisResult.category}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-3 text-center">
                    <p className="text-xs text-gray-400">语言</p>
                    <p className="text-sm font-medium text-gray-700 mt-1">{analysisResult.language === "zh" ? "中文" : analysisResult.language === "en" ? "英文" : "中英混合"}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-3 text-center">
                    <p className="text-xs text-gray-400">字数</p>
                    <p className="text-sm font-medium text-gray-700 mt-1">{analysisResult.wordCount}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-3 text-center">
                    <p className="text-xs text-gray-400">阅读时间</p>
                    <p className="text-sm font-medium text-gray-700 mt-1">{analysisResult.readingTime}</p>
                  </div>
                </div>

                {/* 原始 JSON */}
                <details className="rounded-xl bg-gray-50 border border-gray-100">
                  <summary className="px-4 py-3 text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                    🔧 查看原始 JSON（Output Parser 解析后的结构化数据）
                  </summary>
                  <pre className="px-4 pb-4 text-xs text-gray-600 overflow-x-auto">
                    {JSON.stringify(analysisResult, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
