// src/lib/pricing/priceVerification.ts
// Main pipeline: fetches quotes from all adapters, computes consensus, caches results

import type { CardPriceIdentity, PriceConsensus, PriceQuote } from "./types";
import { computeConsensus, requiresManualReview, buildConsensusCacheKey } from "./consensus";
import { getDefaultAdapters } from "./adapters";

const CACHE_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

interface CachedConsensus {
  consensus: PriceConsensus;
  cachedAt: number;
}

const consensusCache = new Map<string, CachedConsensus>();

/**
 * Run the full Price Verification pipeline for a card.
 * 1. Check cache
 * 2. Fetch quotes from all adapters in parallel
 * 3. Deduplicate (avoid double-counting eBay from both adapters)
 * 4. Compute consensus
 * 5. Cache and return
 */
export async function verifyCardPrice(
  card: CardPriceIdentity
): Promise<PriceConsensus> {
  const cacheKey = buildConsensusCacheKey(card);

  // Check cache
  const cached = consensusCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_DURATION_MS) {
    return cached.consensus;
  }

  // Fetch from all adapters concurrently
  const adapters = getDefaultAdapters(card);
  const results = await Promise.allSettled(
    adapters.map((adapter) => adapter.fetchQuotes(card))
  );

  // Collect all quotes
  const allQuotes: PriceQuote[] = [];
  const seenSources = new Set<string>();

  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const quote of result.value) {
        // Deduplicate: same source+kind only once
        const dedupeKey = `${quote.source}:${quote.kind}:${quote.priceUSD}`;
        if (!seenSources.has(dedupeKey)) {
          seenSources.add(dedupeKey);
          allQuotes.push(quote);
        }
      }
    }
  }

  // Compute consensus
  const consensus = computeConsensus(allQuotes, card.matchConfidence);

  // Cache
  consensusCache.set(cacheKey, { consensus, cachedAt: Date.now() });

  return consensus;
}

/**
 * Clear cached consensus for a specific card
 */
export function clearConsensusCache(card?: CardPriceIdentity): void {
  if (card) {
    consensusCache.delete(buildConsensusCacheKey(card));
  } else {
    consensusCache.clear();
  }
}

// Re-export for convenience
export { requiresManualReview } from "./consensus";
export type { PriceConsensus, CardPriceIdentity, ConsensusFlag } from "./types";
