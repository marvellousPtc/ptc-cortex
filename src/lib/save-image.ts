import fs from "fs";
import path from "path";
import crypto from "crypto";

const IMAGE_DIR = path.join(process.cwd(), "data", "images");

function ensureDir() {
  if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
  }
}

/**
 * Download a remote image and save it to data/images/.
 * Returns an API route URL (e.g. /api/images?f=abc123.png)
 * that serves the image reliably in both dev and production.
 * Falls back to original URL if download fails.
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

    console.log(`🖼️ Image saved: ${filePath} (${(buffer.length / 1024).toFixed(1)}KB)`);
    return `/api/images?f=${filename}`;
  } catch (err) {
    console.warn("Failed to save image locally, using remote URL:", err);
    return remoteUrl;
  }
}
