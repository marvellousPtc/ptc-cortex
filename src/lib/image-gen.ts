/**
 * ========== 图片生成工具 ==========
 *
 * 使用硅基流动（SiliconFlow）的图片生成 API。
 * 支持 FLUX、Kolors 等多种模型。
 *
 * 注意：生成的图片 URL 有效期只有 1 小时，
 * 如果需要持久保存应下载到本地存储。
 */

interface ImageGenerationResponse {
  images: Array<{
    url: string;
    seed?: number;
  }>;
  timings?: {
    inference: number;
  };
}

export async function generateImage(
  prompt: string,
  size: string = "1024x1024"
): Promise<string> {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    return "错误：未配置 SILICONFLOW_API_KEY 环境变量。请到 https://siliconflow.cn 注册并获取 API Key。";
  }

  try {
    const response = await fetch(
      "https://api.siliconflow.cn/v1/images/generations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "black-forest-labs/FLUX.1-schnell", // 免费模型，速度快
          prompt,
          image_size: size,
          num_inference_steps: 20,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("图片生成 API 错误:", error);
      return `图片生成失败: HTTP ${response.status}`;
    }

    const data: ImageGenerationResponse = await response.json();

    if (data.images && data.images.length > 0) {
      const imageUrl = data.images[0].url;
      console.log("🖼️ 图片生成成功:", imageUrl);
      return imageUrl;
    }

    return "图片生成失败：API 没有返回图片。";
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return `图片生成出错: ${msg}`;
  }
}
