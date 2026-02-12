/**
 * ========== 联网搜索工具 ==========
 *
 * 使用必应（Bing）中国版搜索，国内可正常访问。
 */

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function webSearch(
  query: string,
  maxResults: number = 5
): Promise<string> {
  try {
    const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}&ensearch=0`;

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Cookie: "ENSEARCH=BENVER=0;",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return `搜索请求失败: HTTP ${response.status}`;
    }

    const html = await response.text();
    const results: SearchResult[] = [];

    // 匹配 <li class="b_algo">
    const blockRegex = /<li[^>]*class="b_algo"[^>]*>([\s\S]*?)<\/li>/g;
    let blockMatch;

    while (
      (blockMatch = blockRegex.exec(html)) !== null &&
      results.length < maxResults
    ) {
      const block = blockMatch[1];

      const linkMatch = block.match(
        /<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/
      );
      if (!linkMatch) continue;

      const resultUrl = linkMatch[1];
      const title = linkMatch[2].replace(/<[^>]*>/g, "").trim();

      let snippet = "";
      const snippetPatterns = [
        /<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/,
        /<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/,
        /<p[^>]*>([\s\S]*?)<\/p>/,
      ];
      for (const pattern of snippetPatterns) {
        const m = block.match(pattern);
        if (m) {
          snippet = m[1].replace(/<[^>]*>/g, "").trim();
          if (snippet.length > 20) break;
        }
      }

      if (title && !resultUrl.includes("bing.com")) {
        results.push({ title, url: resultUrl, snippet });
      }
    }

    // 宽泛匹配兜底
    if (results.length === 0) {
      const h2Regex =
        /<h2[^>]*><a[^>]*href="(https?:\/\/(?!.*bing\.com)[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      let h2Match;
      while (
        (h2Match = h2Regex.exec(html)) !== null &&
        results.length < maxResults
      ) {
        const title = h2Match[2].replace(/<[^>]*>/g, "").trim();
        if (title && title.length > 3) {
          results.push({ title, url: h2Match[1], snippet: "" });
        }
      }
    }

    if (results.length === 0) {
      return `搜索「${query}」暂时没有找到结果，请稍后重试。`;
    }

    console.log(`🔍 必应搜索成功，返回 ${results.length} 条结果`);

    return results
      .map(
        (r, i) =>
          `[${i + 1}] ${r.title}\n来源: ${new URL(r.url).hostname}${r.snippet ? `\n摘要: ${r.snippet}` : ""}`
      )
      .join("\n\n");
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return `搜索出错: ${msg}`;
  }
}
