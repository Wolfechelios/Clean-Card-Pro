// @ts-ignore - vitest types available at test time
import { describe, it, expect } from "vitest";
import { computeConsensus, requiresManualReview } from "@/lib/pricing/consensus";
import type { PriceQuote } from "@/lib/pricing/types";

function makeQuote(overrides: Partial<PriceQuote> & { source: string; priceUSD: number }): PriceQuote {
  return {
    kind: "sold",
    ts: Date.now(),
    ...overrides,
  };
}

describe("computeConsensus", () => {
  it("returns stable result with consistent prices from multiple sources", () => {
    const quotes: PriceQuote[] = [
      makeQuote({ source: "ebay-sold", priceUSD: 10 }),
      makeQuote({ source: "pricecharting", priceUSD: 11, kind: "guide" }),
      makeQuote({ source: "tcgplayer", priceUSD: 10.5, kind: "guide" }),
    ];

    const result = computeConsensus(quotes, 0.9);

    expect(result.flags).toEqual([]);
    expect(result.medianUSD).toBe(10.5);
    expect(result.recommendedUSD).toBe(10.5);
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.lowUSD).toBeLessThanOrEqual(result.medianUSD);
    expect(result.highUSD).toBeGreaterThanOrEqual(result.medianUSD);
  });

  it("flags OUTLIER_QUOTE when one price is wildly different", () => {
    const quotes: PriceQuote[] = [
      makeQuote({ source: "ebay-sold", priceUSD: 10 }),
      makeQuote({ source: "pricecharting", priceUSD: 11, kind: "guide" }),
      makeQuote({ source: "tcgplayer", priceUSD: 150, kind: "guide" }), // way off
    ];

    const result = computeConsensus(quotes, 0.85);

    expect(result.flags).toContain("OUTLIER_QUOTE");
    expect(requiresManualReview(result)).toBe(true);
  });

  it("flags NOT_ENOUGH_SOURCES when fewer than 2 distinct sources", () => {
    const quotes: PriceQuote[] = [
      makeQuote({ source: "ebay-sold", priceUSD: 10 }),
      makeQuote({ source: "ebay-sold", priceUSD: 12 }),
    ];

    const result = computeConsensus(quotes, 0.9);

    expect(result.flags).toContain("NOT_ENOUGH_SOURCES");
    expect(requiresManualReview(result)).toBe(true);
  });

  it("flags LOW_MATCH_CONFIDENCE when matchConfidence < 0.70", () => {
    const quotes: PriceQuote[] = [
      makeQuote({ source: "ebay-sold", priceUSD: 10 }),
      makeQuote({ source: "pricecharting", priceUSD: 11, kind: "guide" }),
    ];

    const result = computeConsensus(quotes, 0.5);

    expect(result.flags).toContain("LOW_MATCH_CONFIDENCE");
    expect(requiresManualReview(result)).toBe(true);
  });

  it("handles empty quotes gracefully", () => {
    const result = computeConsensus([], 0.9);

    expect(result.recommendedUSD).toBe(0);
    expect(result.confidence).toBe(0);
    expect(result.flags).toContain("NOT_ENOUGH_SOURCES");
  });

  it("flags LOW_SAMPLE_COUNT when total samples < 3", () => {
    const quotes: PriceQuote[] = [
      makeQuote({ source: "ebay-sold", priceUSD: 10, samples: 1 }),
      makeQuote({ source: "pricecharting", priceUSD: 11, kind: "guide", samples: 1 }),
    ];

    const result = computeConsensus(quotes, 0.9);

    expect(result.flags).toContain("LOW_SAMPLE_COUNT");
  });
});

describe("requiresManualReview", () => {
  it("returns false for high-confidence consensus with no flags", () => {
    const quotes: PriceQuote[] = [
      makeQuote({ source: "ebay-sold", priceUSD: 10 }),
      makeQuote({ source: "pricecharting", priceUSD: 10.5, kind: "guide" }),
      makeQuote({ source: "tcgplayer", priceUSD: 10.2, kind: "guide" }),
    ];

    const result = computeConsensus(quotes, 0.9);
    expect(requiresManualReview(result)).toBe(false);
  });

  it("returns true when confidence < 0.55", () => {
    const result = computeConsensus(
      [makeQuote({ source: "ebay-sold", priceUSD: 5 })],
      0.3
    );
    expect(requiresManualReview(result)).toBe(true);
  });
});
