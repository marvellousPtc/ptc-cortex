/**
 * ========== 图片理解（多模态） ==========
 *
 * 通过硅基流动的多模态模型（如 Qwen2-VL）来理解图片内容。
 * 当用户发送图片时，调用此模块来"看图说话"。
 */

interface VisionMessage {
  role: "user" | "assistant" | "system";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
}

/**
 * 用多模态模型分析图片
 * @param imageUrl 图片的 URL 或 base64 data URL
 * @param question 用户关于图片的问题
 */
export async function analyzeImage(
  imageUrl: string,
  question: string = "请详细描述这张图片的内容"
): Promise<string> {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    return "错误：未配置 SILICONFLOW_API_KEY 环境变量。";
  }

  try {
    const messages: VisionMessage[] = [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageUrl } },
          { type: "text", text: question },
        ],
      },
    ];

    const response = await fetch(
      "https://api.siliconflow.cn/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "Qwen/Qwen2.5-VL-72B-Instruct", // 免费的多模态模型
          messages,
          max_tokens: 1024,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("图片分析 API 错误:", error);
      return `图片分析失败: HTTP ${response.status}`;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "无法分析该图片。";
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return `图片分析出错: ${msg}`;
  }
}
