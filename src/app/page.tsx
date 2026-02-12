"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

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
          history: messages,
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

      // ====== 核心变化：流式读取 ======
      // response.body 是一个 ReadableStream，我们用 getReader() 逐块读取
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("无法获取响应流");
      }

      // 先添加一个空的 AI 消息，后面逐步往里填内容
      const aiMessageIndex = newMessages.length;
      setMessages([...newMessages, { role: "assistant", content: "" }]);

      // 循环读取流中的数据块
      let fullContent = "";
      while (true) {
        // read() 返回 { done, value }
        // done=true 表示流结束，value 是这次读到的数据（Uint8Array）
        const { done, value } = await reader.read();
        if (done) break;

        // 把二进制数据解码成文字
        const text = decoder.decode(value, { stream: true });
        fullContent += text;

        // 实时更新 AI 消息的内容 —— 这就是打字机效果的来源！
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

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* 顶部标题栏 */}
      <header className="border-b bg-white px-6 py-4 shadow-sm">
        <h1 className="text-xl font-bold text-gray-800">
          🤖 LangChain Chat
        </h1>
        <p className="text-sm text-gray-500">
          第二课：流式输出 — 使用 model.stream() 实现打字机效果
        </p>
      </header>

      {/* 消息列表区域 */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <div className="text-6xl mb-4">💬</div>
              <p className="text-lg">发送一条消息开始对话吧！</p>
              <p className="text-sm mt-2">
                试试问：&quot;用三句话解释什么是量子力学&quot;
              </p>
            </div>
          )}

          {messages.map((msg, index) => (
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
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {msg.content}
                </p>
              </div>
            </div>
          ))}

          {/* 加载动画：只在等待 AI 开始回复时显示 */}
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
      <div className="border-t bg-white px-4 py-4">
        <div className="mx-auto flex max-w-2xl gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息... (Enter 发送)"
            className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
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
    </div>
  );
}
