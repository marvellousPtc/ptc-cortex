import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 部署时设置 NEXT_PUBLIC_BASE_PATH=/chat，本地开发不设则为空
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",

  // better-sqlite3 是原生 Node.js 模块，需要告诉 Next.js 不要打包它
  serverExternalPackages: [
    "better-sqlite3",
    "@huggingface/transformers",
    "onnxruntime-node",
    "pg",
    "pdf-parse",
    "xlsx",
    "@langchain/langgraph",
  ],
};

export default nextConfig;
