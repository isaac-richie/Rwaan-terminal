export interface NewsSource {
  platform: "Google" | "Twitter";
  title: string;
  url: string;
}

async function resolveRedirect(url: string, timeoutMs = 4000): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    // Perform a HEAD request to follow redirects and get the final URL
    const res = await fetch(url, { 
      method: "HEAD", 
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    
    clearTimeout(timeout);
    return res.url;
  } catch (err) {
    // If resolution fails, return original URL as fallback
    return url;
  }
}

export async function fetchLiveNews(query: string): Promise<NewsSource[]> {
  try {
    const safeQuery = encodeURIComponent(query);
    // Switch to Bing News RSS which provides slightly better redirect paths for resolution
    const rssUrl = `https://www.bing.com/news/search?q=${safeQuery}&format=rss`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s overall timeout
    
    const res = await fetch(rssUrl, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (!res.ok) {
      throw new Error(`Failed to fetch RSS: ${res.status}`);
    }
    
    const xml = await res.text();
    
    // Simple regex parser to extract items
    const itemsRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title>(.*?)<\/title>/;
    const linkRegex = /<link>(.*?)<\/link>/;
    
    const rawMatches: { title: string; url: string }[] = [];
    let match;
    while ((match = itemsRegex.exec(xml)) !== null && rawMatches.length < 3) {
      const itemXml = match[1];
      const titleMatch = titleRegex.exec(itemXml);
      const linkMatch = linkRegex.exec(itemXml);
      
      if (titleMatch && linkMatch) {
         rawMatches.push({ 
           title: titleMatch[1].split(" - ")[0].split(" | ")[0].trim(), 
           url: linkMatch[1] 
         });
      }
    }

    // Ping-to-Resolve: Perform parallel redirect resolution for the final articles
    const resolvedSources = await Promise.all(
      rawMatches.map(async (raw) => {
        const directUrl = await resolveRedirect(raw.url);
        return {
          platform: "Google" as const, // KEEPING PLATFORM NAME AS GOOGLE PER UI THEME OR BING
          title: raw.title.length > 60 ? raw.title.substring(0, 57) + "..." : raw.title,
          url: directUrl
        };
      })
    );
    
    return resolvedSources.slice(0, 2);
  } catch (err) {
    console.warn(`[news] Failed to fetch live news for "${query}":`, err);
    return [];
  }
}

export interface PremiumNewsArticle {
  title: string;
  url: string;
  bodyText: string;
}

async function fetchArticleText(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return "";
    const html = await res.text();
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return stripped.slice(0, 2000);
  } catch {
    return "";
  }
}

export async function fetchPremiumNews(query: string): Promise<PremiumNewsArticle[]> {
  const sources = await fetchLiveNews(query);
  const articles = await Promise.all(
    sources.map(async (source) => {
      const bodyText = await fetchArticleText(source.url);
      return { title: source.title, url: source.url, bodyText };
    })
  );
  return articles.filter((a) => a.bodyText.length > 100);
}
