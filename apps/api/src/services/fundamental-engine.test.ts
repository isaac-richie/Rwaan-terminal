import { describe, expect, it } from "vitest";
import {
  buildCategoryFramework,
  computeFundamentalVerdict,
  detectMarketCategory,
} from "./fundamental-engine.js";

const ipoArticle = {
  title: "OpenAI confidential IPO filing advances with underwriters",
  url: "https://example.com/openai-ipo",
  bodyText:
    "OpenAI has made a confidential IPO filing and selected underwriters as investors prepare for a public listing.",
  publishedAt: "2026-06-04T00:00:00.000Z",
};

describe("fundamental engine IPO analysis", () => {
  it("classifies IPO markets into the IPO framework", () => {
    expect(detectMarketCategory("Will OpenAI IPO by December 31, 2026?", "IPOs")).toBe("ipos");
    expect(
      detectMarketCategory(
        "Will Stripe's market cap be between $120B and $140B at market close on IPO day?",
        "Finance"
      )
    ).toBe("ipos");
    expect(buildCategoryFramework("ipos", 42)).toContain("IPO ANALYSIS FRAMEWORK");
  });

  it("maps filing momentum against no-IPO market wording", () => {
    const verdict = computeFundamentalVerdict(
      {
        question: "Will OpenAI not IPO by December 31, 2026?",
        category: "IPOs",
        outcomes: [
          { name: "Yes", price: 42 },
          { name: "No", price: 58 },
        ],
        liquidity: "$8.4K",
        volume: "$25K",
        endDate: "2026-12-31T23:59:59.000Z",
      },
      [ipoArticle]
    );

    const readiness = verdict.signals.find((signal) => signal.name === "IPO Readiness");
    expect(verdict.category).toBe("ipos");
    expect(readiness?.direction).toBe("NO");
    expect(readiness?.reason).toContain("no-IPO question");
  });
});
