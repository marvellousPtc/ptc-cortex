/**
 * ========== 联网搜索工具 ==========
 *
 * 使用必应（Bing）中国版搜索，国内可正常访问。
 * 搜索后会自动抓取前几条结果的网页正文，提供更丰富的内容。
 */

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * 从 URL 抓取网页正文（去除 HTML 标签，提取核心文本）
 */
async function fetchPageContent(url: string, maxLen: number = 1500): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(5000),
      redirect: "follow",
    });
    if (!res.ok) return "";
    const html = await res.text();
    // 移除 script/style/nav/header/footer
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    // 尝试取正文中间段（跳过开头的导航等）
    if (text.length > 500) {
      const start = Math.min(200, Math.floor(text.length * 0.1));
      text = text.slice(start);
    }
    return text.slice(0, maxLen);
  } catch {
    return "";
  }
}

export async function webSearch(
  query: string,
  maxResults: number = 8
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

    // 并发抓取前 3 条结果的网页正文
    const topResults = results.slice(0, 3);
    const pageContents = await Promise.all(
      topResults.map((r) => fetchPageContent(r.url))
    );

    // 组装最终输出
    let output = results
      .map(
        (r, i) =>
          `[${i + 1}] ${r.title}\n来源: ${new URL(r.url).hostname}${r.snippet ? `\n摘要: ${r.snippet}` : ""}`
      )
      .join("\n\n");

    // 附加抓取到的正文内容
    const enriched = pageContents
      .map((content, i) => {
        if (!content || content.length < 50) return "";
        return `\n\n--- 来自「${topResults[i].title}」的详细内容 ---\n${content}`;
      })
      .filter(Boolean)
      .join("");

    if (enriched) {
      output += enriched;
      console.log(`📄 已抓取 ${pageContents.filter(c => c.length > 50).length} 个页面正文`);
    }

    return output;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return `搜索出错: ${msg}`;
  }
}
