// src/lib/pricing/consensus.ts
// Robust price consensus computation with outlier detection (median, IQR, MAD)

import type { PriceQuote, PriceConsensus, ConsensusFlag, CardPriceIdentity } from "./types";

// ─── Helpers ───

function sorted(arr: number[]): number[] {
  return [...arr].sort((a, b) => a - b);
}

function median(values: number[]): number {
  const s = sorted(values);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  const s = sorted(values);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/** Median Absolute Deviation */
function mad(values: number[]): number {
  const med = median(values);
  const deviations = values.map((v) => Math.abs(v - med));
  return median(deviations);
}

/** Modified Z-score using MAD (Iglewicz & Hoaglin) */
function madZScore(value: number, med: number, madValue: number): number {
  if (madValue === 0) return 0;
  return 0.6745 * (value - med) / madValue;
}

// ─── Core ───

const MAD_Z_THRESHOLD = 3.5;
const MAX_MEDIAN_RATIO = 2.5;

export function computeConsensus(
  quotes: PriceQuote[],
  matchConfidence?: number
): PriceConsensus {
  const flags: ConsensusFlag[] = [];

  // Distinct source check
  const distinctSources = new Set(quotes.map((q) => q.source));
  if (distinctSources.size < 2) {
    flags.push("NOT_ENOUGH_SOURCES");
  }

  // Match confidence gate
  if (matchConfidence !== undefined && matchConfidence < 0.7) {
    flags.push("LOW_MATCH_CONFIDENCE");
  }

  // Low sample count
  const totalSamples = quotes.reduce((sum, q) => sum + (q.samples ?? 1), 0);
  if (totalSamples < 3) {
    flags.push("LOW_SAMPLE_COUNT");
  }

  // Extract prices
  const prices = quotes.map((q) => q.priceUSD).filter((p) => p > 0);

  if (prices.length === 0) {
    return {
      recommendedUSD: 0,
      medianUSD: 0,
      lowUSD: 0,
      highUSD: 0,
      confidence: 0,
      flags: [...flags, "NOT_ENOUGH_SOURCES"],
      quotes,
    };
  }

  const med = median(prices);
  const q1 = percentile(prices, 25);
  const q3 = percentile(prices, 75);
  const madValue = mad(prices);

  // Outlier detection: MAD z-score > 3.5 OR max/median > 2.5
  const maxPrice = Math.max(...prices);
  let hasOutlier = false;

  for (const p of prices) {
    const zScore = Math.abs(madZScore(p, med, madValue));
    if (zScore > MAD_Z_THRESHOLD) {
      hasOutlier = true;
      break;
    }
  }

  if (!hasOutlier && med > 0 && maxPrice / med > MAX_MEDIAN_RATIO) {
    hasOutlier = true;
  }

  if (hasOutlier) {
    flags.push("OUTLIER_QUOTE");
  }

  // Confidence formula: combine sourceCount, agreement, matchConfidence
  const sourceScore = Math.min(distinctSources.size / 3, 1); // 0..1, max at 3 sources
  const spreadScore = med > 0
    ? Math.max(0, 1 - (q3 - q1) / med) // tighter spread = higher score
    : 0;
  const matchScore = matchConfidence ?? 0.8; // default if not provided

  const confidence = Math.round(
    (sourceScore * 0.3 + spreadScore * 0.35 + matchScore * 0.35) * 100
  ) / 100;

  return {
    recommendedUSD: Math.round(med * 100) / 100,
    medianUSD: Math.round(med * 100) / 100,
    lowUSD: Math.round(q1 * 100) / 100,
    highUSD: Math.round(q3 * 100) / 100,
    confidence: Math.max(0, Math.min(1, confidence)),
    flags: [...new Set(flags)],
    quotes,
  };
}

/**
 * Anomaly gate: determines if a price requires manual review
 */
export function requiresManualReview(consensus: PriceConsensus): boolean {
  const { flags, confidence } = consensus;
  return (
    flags.includes("OUTLIER_QUOTE") ||
    flags.includes("LOW_MATCH_CONFIDENCE") ||
    flags.includes("NOT_ENOUGH_SOURCES") ||
    confidence < 0.55
  );
}

/**
 * Build a cache key for consensus caching
 */
export function buildConsensusCacheKey(card: CardPriceIdentity): string {
  const parts = [
    card.name?.toLowerCase().trim(),
    card.set?.toLowerCase().trim(),
    card.number?.toLowerCase().trim(),
    card.variant?.toLowerCase().trim(),
    card.language?.toLowerCase().trim(),
    card.condition?.toLowerCase().trim(),
  ].filter(Boolean);
  return parts.join("|");
}
