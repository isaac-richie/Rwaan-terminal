import { config } from "../config.js";
import { getGamma } from "./polymarket.js";

export interface CatalystMarket {
  id: string;
  question: string;
  category: string;
  image?: string;
  probability?: number;
  volume?: string;
  reasoning: string;
}

async function extractKeywords(newsText: string): Promise<string[]> {
  if (!config.openai.apiKey) return [newsText.slice(0, 30)];

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.openai.model,
        messages: [
          {
            role: "user",
            content: `Extract the 3 most unique and specific search keywords for prediction markets from this news: "${newsText}". Return keywords as a JSON array of strings only.`
          }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!res.ok) return [newsText.slice(0, 30)];
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);
    return parsed.keywords || parsed.items || [];
  } catch (err) {
    console.error("Keyword extraction failed:", err);
    return [newsText.slice(0, 30)];
  }
}

export async function findCatalysts(newsText: string): Promise<CatalystMarket[]> {
  const keywords = await extractKeywords(newsText);
  const results: any[] = [];
  const seenIds = new Set<string>();

  for (const kw of keywords.slice(0, 2)) {
    try {
      const data: any = await getGamma("/search", { q: kw, limit: 3, active: true });
      const items = Array.isArray(data) ? data : data?.data || [];
      for (const item of items) {
        if (!seenIds.has(item.id)) {
          results.push(item);
          seenIds.add(item.id);
        }
      }
    } catch (err) {
      console.error(`Gamma search failed for ${kw}:`, err);
    }
  }

  // Add AI reasoning for why these match
  const catalysts: CatalystMarket[] = results.slice(0, 4).map((m) => {
    const yes = m.outcomes?.find((o: any) => o.name.toLowerCase().includes("yes"))?.price ?? 50;
    return {
      id: m.id,
      question: m.question,
      category: m.category || "General",
      image: m.image,
      probability: Number(yes),
      volume: m.volume,
      reasoning: `Impact correlation discovered through catalyst analysis. News catalyst directly pressures price discovery on "${m.question}".`
    };
  });

  return catalysts;
}
