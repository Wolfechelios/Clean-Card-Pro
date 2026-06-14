// src/lib/pricing/types.ts
// Price Consensus + Anomaly Gate types

/** Classification of price data quality */
export type PriceKind = "sold" | "listing" | "guide";

/** A single price observation from any source */
export interface PriceQuote {
  source: string;        // e.g. "ebay-sold", "pricecharting", "tcgplayer"
  kind: PriceKind;
  priceUSD: number;
  ts: number;            // Unix ms timestamp
  url?: string;          // Link to the comp/guide
  samples?: number;      // Number of data points behind this quote
}

/** Aggregated consensus result */
export interface PriceConsensus {
  recommendedUSD: number;
  medianUSD: number;
  lowUSD: number;
  highUSD: number;
  confidence: number;    // 0..1
  flags: ConsensusFlag[];
  quotes: PriceQuote[];
}

export type ConsensusFlag =
  | "OUTLIER_QUOTE"
  | "NOT_ENOUGH_SOURCES"
  | "LOW_MATCH_CONFIDENCE"
  | "LOW_SAMPLE_COUNT"
  | "GRADE_MISMATCH"
  | "VARIANT_AMBIGUOUS";

/** Input card identity for price lookups */
export interface CardPriceIdentity {
  name: string;
  set?: string | null;
  number?: string | null;
  year?: number | null;
  variant?: string | null;
  language?: string | null;
  rarity?: string | null;
  condition?: string | null; // "raw" | "PSA 10" | etc.
  gameType?: string | null;
  sportType?: string | null;
  matchConfidence?: number;  // 0..1 from identification step
  // External IDs if available
  tcgplayerId?: string | null;
  priceChartingId?: string | null;
  scryfallId?: string | null;
}

/** Adapter interface for price sources */
export interface PriceSourceAdapter {
  name: string;
  /** Fetch price quotes for a card. Returns empty array on failure (never throws). */
  fetchQuotes(card: CardPriceIdentity): Promise<PriceQuote[]>;
}
