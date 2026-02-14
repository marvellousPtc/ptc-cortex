import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 部署时设置 NEXT_PUBLIC_BASE_PATH=/chat，本地开发不设则为空
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",

  serverExternalPackages: [
    "@huggingface/transformers",
    "onnxruntime-node",
    "pg",
    "pdf-parse",
    "xlsx",
  ],
};

export default nextConfig;
