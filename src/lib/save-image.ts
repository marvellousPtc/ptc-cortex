import crypto from "crypto";

/**
 * Upload image to Alibaba Cloud OSS using REST API (no SDK needed).
 * Falls back to original URL if upload fails.
 */
export async function saveImageLocally(remoteUrl: string): Promise<string> {
  const bucket = process.env.DEFAULT_OSS_BUCKET;
  const region = process.env.DEFAULT_OSS_REGION;
  const accessKeyId = process.env.DEFAULT_OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.DEFAULT_OSS_ACCESS_KEY_SECRET;
  const ossDir = process.env.DEFAULT_OSS_DIR || "public";

  if (!bucket || !accessKeyId || !accessKeySecret) {
    console.warn("OSS not configured, using remote URL");
    return remoteUrl;
  }

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
    const objectKey = `${ossDir}/generated-images/${filename}`;

    const buffer = Buffer.from(await res.arrayBuffer());
    const host = `${bucket}.${region}.aliyuncs.com`;
    const date = new Date().toUTCString();

    const stringToSign = `PUT\n\n${contentType}\n${date}\n/${bucket}/${objectKey}`;
    const signature = crypto
      .createHmac("sha1", accessKeySecret)
      .update(stringToSign)
      .digest("base64");

    const uploadRes = await fetch(`https://${host}/${objectKey}`, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Date": date,
        "Authorization": `OSS ${accessKeyId}:${signature}`,
      },
      body: buffer,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.warn("OSS upload failed:", uploadRes.status, errText);
      return remoteUrl;
    }

    const ossUrl = `https://${host}/${objectKey}`;
    console.log(`🖼️ Image uploaded to OSS: ${ossUrl} (${(buffer.length / 1024).toFixed(1)}KB)`);
    return ossUrl;
  } catch (err) {
    console.warn("Failed to upload image to OSS:", err);
    return remoteUrl;
  }
}
