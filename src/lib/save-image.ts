import fs from "fs";
import path from "path";
import crypto from "crypto";

const IMAGE_DIR = path.join(process.cwd(), "public", "generated-images");

function ensureDir() {
  if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
  }
}

/**
 * Download a remote image and save it to public/generated-images/.
 * Returns the local URL path (e.g. /generated-images/abc123.png).
 * If download fails, returns the original URL as fallback.
 */
export async function saveImageLocally(remoteUrl: string): Promise<string> {
  try {
    ensureDir();

    const res = await fetch(remoteUrl);
    if (!res.ok) {
      console.warn("Failed to download image, using remote URL:", res.status);
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
    const filePath = path.join(IMAGE_DIR, filename);

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    console.log(`🖼️ Image saved locally: ${filePath} (${(buffer.length / 1024).toFixed(1)}KB)`);
    return `/generated-images/${filename}`;
  } catch (err) {
    console.warn("Failed to save image locally, using remote URL:", err);
    return remoteUrl;
  }
}
