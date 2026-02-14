/**
 * ========== 即梦 AI 图片生成工具 ==========
 *
 * 使用火山引擎方舟 API 的 doubao-seedream-4-5 模型生成高质量图片。
 * 支持中文提示词，效果优秀。
 *
 * 环境变量：ARK_API_KEY
 * API 文档：https://www.volcengine.com/docs/82379/1541523
 */

interface ArkImageResponse {
  data?: Array<{
    url?: string;
    b64_json?: string;
  }>;
  error?: {
    message: string;
    code: string;
  };
}

export async function generateJimengImage(
  prompt: string,
  size: string = "2K"
): Promise<string> {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) {
    return "错误：未配置 ARK_API_KEY 环境变量。请到 https://console.volcengine.com 开通方舟服务并获取 API Key。";
  }

  try {
    const response = await fetch(
      "https://ark.cn-beijing.volces.com/api/v3/images/generations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "doubao-seedream-4-5-251128",
          prompt,
          size,
          sequential_image_generation: "disabled",
          response_format: "url",
          stream: false,
          watermark: true,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("即梦 AI API 错误:", errorText);
      return `即梦图片生成失败: HTTP ${response.status}`;
    }

    const data: ArkImageResponse = await response.json();

    if (data.error) {
      console.error("即梦 AI 错误:", data.error);
      return `即梦图片生成失败: ${data.error.message}`;
    }

    if (data.data && data.data.length > 0 && data.data[0].url) {
      const imageUrl = data.data[0].url;
      console.log("🎨 即梦图片生成成功:", imageUrl);
      return imageUrl;
    }

    return "即梦图片生成失败：API 没有返回图片。";
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return `即梦图片生成出错: ${msg}`;
  }
}
