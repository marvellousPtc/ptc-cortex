import crypto from "crypto";
// @ts-expect-error ali-oss has no type declarations
import OSS from "ali-oss";

let ossClient: OSS | null = null;

function getOSSClient(): OSS {
  if (ossClient) return ossClient;
  ossClient = new OSS({
    region: process.env.DEFAULT_OSS_REGION || "oss-cn-beijing",
    bucket: process.env.DEFAULT_OSS_BUCKET || "",
    accessKeyId: process.env.DEFAULT_OSS_ACCESS_KEY_ID || "",
    accessKeySecret: process.env.DEFAULT_OSS_ACCESS_KEY_SECRET || "",
  });
  return ossClient;
}

/**
 * Download a remote image and upload it to Alibaba Cloud OSS.
 * Returns the public OSS URL for permanent access.
 * Falls back to original URL if upload fails.
 */
export async function saveImageLocally(remoteUrl: string): Promise<string> {
  try {
    const res = await fetch(remoteUrl);
    if (!res.ok) {
      console.warn("Failed to download image:", res.status);
      return remoteUrl;
    }

    const contentType = res.headers.get("content-type") || "image/png";
    const ext = contentType.includes("jpeg") || contentType.includes("jpg")
      ? ".jpg"
      : contentType.includes("webp")
        ? ".webp"
        : ".png";

    const hash = crypto.randomUUID().slice(0, 12);
    const filename = `${Date.now()}-${hash}${ext}`;
    const ossDir = process.env.DEFAULT_OSS_DIR || "public";
    const ossPath = `${ossDir}/generated-images/${filename}`;

    const buffer = Buffer.from(await res.arrayBuffer());
    const client = getOSSClient();
    const result = await client.put(ossPath, buffer, {
      headers: { "Content-Type": contentType },
    });

    const ossUrl = result.url.replace(/^http:/, "https:");
    console.log(`🖼️ Image uploaded to OSS: ${ossUrl} (${(buffer.length / 1024).toFixed(1)}KB)`);
    return ossUrl;
  } catch (err) {
    console.warn("Failed to upload image to OSS:", err);
    return remoteUrl;
  }
}
