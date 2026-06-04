export interface NewsSource {
  platform: "Google" | "Twitter";
  title: string;
  url: string;
}

async function resolveRedirect(url: string, timeoutMs = 4000): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(timeout);
    return res.url;
  } catch {
    return url;
  }
}

/** Fetch up to `maxItems` article stubs from Bing RSS for a single query. */
async function fetchRssArticles(
  query: string,
  maxItems = 4
): Promise<{ title: string; url: string }[]> {
  try {
    const safeQuery = encodeURIComponent(query);
    const rssUrl = `https://www.bing.com/news/search?q=${safeQuery}&format=rss`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(rssUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return [];

    const xml = await res.text();
    const itemsRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title>(.*?)<\/title>/;
    const linkRegex = /<link>(.*?)<\/link>/;

    const results: { title: string; url: string }[] = [];
    let match;
    while ((match = itemsRegex.exec(xml)) !== null && results.length < maxItems) {
      const itemXml = match[1];
      const titleMatch = titleRegex.exec(itemXml);
      const linkMatch = linkRegex.exec(itemXml);
      if (titleMatch && linkMatch) {
        results.push({
          title: titleMatch[1].split(" - ")[0].split(" | ")[0].trim(),
          url: linkMatch[1],
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

export async function fetchLiveNews(query: string): Promise<NewsSource[]> {
  try {
    const rawMatches = await fetchRssArticles(query, 3);
    const resolvedSources = await Promise.all(
      rawMatches.map(async (raw) => {
        const directUrl = await resolveRedirect(raw.url);
        return {
          platform: "Google" as const,
          title:
            raw.title.length > 60 ? raw.title.substring(0, 57) + "..." : raw.title,
          url: directUrl,
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
    const timeout = setTimeout(() => controller.abort(), 6000);
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
    // Increased from 2000 → 4000 chars for richer AI context
    return stripped.slice(0, 4000);
  } catch {
    return "";
  }
}

/**
 * Build 2-3 targeted search queries for a market question.
 * More varied queries = broader news coverage = richer AI context.
 */
function buildSearchQueries(question: string, category?: string): string[] {
  const queries: string[] = [question];

  // Strip leading "Will / Does / Is / Can" and trailing "?" for a keyword version
  const keywords = question
    .replace(/^(will|does|is|can|did|has|have|should|would|could)\s+/i, "")
    .replace(/\?$/, "")
    .trim();

  if (keywords.toLowerCase() !== question.toLowerCase()) {
    queries.push(keywords);
  }

  // Category-aware third query
  const cat = (category ?? "").toLowerCase();
  const text = `${cat} ${question} ${keywords}`.toLowerCase();
  const year = new Date().getUTCFullYear();
  if (/politi|elect|president|senator|congress|vote/.test(cat)) {
    queries.push(`${keywords} ${year} polls forecast`);
  } else if (/ipo|ipos|initial public offering|go public|public listing|direct listing|closing market cap/.test(text)) {
    queries.push(`${keywords} IPO filing valuation underwriters ${year}`);
  } else if (/econ|financ|fed|rate|inflation/.test(cat)) {
    queries.push(`${keywords} ${year} forecast outlook`);
  } else if (/sport/.test(cat)) {
    queries.push(keywords + " latest news update");
  } else if (/crypto|bitcoin|ethereum/.test(cat)) {
    queries.push(keywords + " price prediction analysis");
  } else {
    queries.push(`${keywords} latest update ${year}`);
  }

  // Deduplicate and cap at 3
  return [...new Set(queries)].slice(0, 3);
}

/**
 * Premium news fetch:
 * - Runs 2-3 targeted queries in parallel against Bing RSS
 * - Deduplicates results by URL
 * - Fetches article body text (up to 4000 chars each)
 * - Returns up to 6 articles with sufficient content
 */
export async function fetchPremiumNews(
  query: string,
  category?: string
): Promise<PremiumNewsArticle[]> {
  const searchQueries = buildSearchQueries(query, category);

  // Run all RSS queries in parallel, get up to 3 stubs per query
  const queryResults = await Promise.all(
    searchQueries.map((q) => fetchRssArticles(q, 3))
  );

  // Flatten + deduplicate by URL
  const seen = new Set<string>();
  const uniqueStubs: { title: string; url: string }[] = [];
  for (const batch of queryResults) {
    for (const item of batch) {
      const key = item.url.split("?")[0]; // strip query params for dedup
      if (!seen.has(key)) {
        seen.add(key);
        uniqueStubs.push(item);
      }
    }
  }

  // Resolve redirects for the top 7 candidates
  const topStubs = uniqueStubs.slice(0, 7);
  const resolved = await Promise.all(
    topStubs.map(async (stub) => ({
      title: stub.title,
      url: await resolveRedirect(stub.url),
    }))
  );

  // Fetch article body text in parallel
  const articles = await Promise.all(
    resolved.map(async ({ title, url }) => {
      const bodyText = await fetchArticleText(url);
      return { title, url, bodyText };
    })
  );

  // Return up to 6 articles that have meaningful content
  return articles.filter((a) => a.bodyText.length > 150).slice(0, 6);
}
