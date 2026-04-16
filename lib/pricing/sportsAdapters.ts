// src/lib/pricing/sportsAdapters.ts
// Adapters for sports-card-specific pricing sources:
// SportsCardPro, CardLadder, 130point.com, eBay Sold (via Firecrawl)

import type { PriceQuote, CardPriceIdentity, PriceSourceAdapter } from "./types";
import { supabase } from "@/integrations/supabase/client";

interface SourceResult {
  raw: number | null;
  psa9: number | null;
  psa10: number | null;
  url: string | null;
  source: string;
}

interface SportsCardPriceResponse {
  sportsCardPro: SourceResult;
  cardLadder: SourceResult;
  oneThirtyPoint: SourceResult;
  ebay: SourceResult;
}

/** Shared: call the sports-card-prices edge function once, return full response */
let cachedCall: { key: string; promise: Promise<SportsCardPriceResponse | null> } | null = null;

async function fetchSportsCardPrices(card: CardPriceIdentity): Promise<SportsCardPriceResponse | null> {
  const cacheKey = `${card.name}|${card.set}|${card.number}|${card.sportType}`;

  // Deduplicate concurrent calls for the same card
  if (cachedCall && cachedCall.key === cacheKey) {
    return cachedCall.promise;
  }

  const promise = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("sports-card-prices", {
        body: {
          cardName: card.name,
          cardSet: card.set,
          cardNumber: card.number,
          playerName: (card as any).playerName || null,
          year: card.year,
          sportType: card.sportType,
        },
      });

      if (error || !data) {
        console.warn("[SportsCardPrices] Edge function error:", error);
        return null;
      }
      return data as SportsCardPriceResponse;
    } catch (e) {
      console.warn("[SportsCardPrices] Failed:", e);
      return null;
    }
  })();

  cachedCall = { key: cacheKey, promise };
  return promise;
}

function sourceToQuotes(
  src: SourceResult,
  sourceName: string,
  kind: "sold" | "guide",
  card: CardPriceIdentity
): PriceQuote[] {
  const quotes: PriceQuote[] = [];
  const now = Date.now();

  if (src.raw != null && src.raw > 0) {
    quotes.push({
      source: sourceName,
      kind,
      priceUSD: src.raw,
      ts: now,
      url: src.url || undefined,
      samples: 1,
    });
  }

  if (src.psa9 != null && src.psa9 > 0) {
    quotes.push({
      source: `${sourceName}-psa9`,
      kind,
      priceUSD: src.psa9,
      ts: now,
      url: src.url || undefined,
    });
  }

  if (src.psa10 != null && src.psa10 > 0) {
    quotes.push({
      source: `${sourceName}-psa10`,
      kind,
      priceUSD: src.psa10,
      ts: now,
      url: src.url || undefined,
    });
  }

  return quotes;
}

/** SportsCardPro adapter (sports cards only) */
export class SportsCardProAdapter implements PriceSourceAdapter {
  name = "sportscardpro";

  async fetchQuotes(card: CardPriceIdentity): Promise<PriceQuote[]> {
    const data = await fetchSportsCardPrices(card);
    if (!data) return [];
    return sourceToQuotes(data.sportsCardPro, "sportscardpro", "guide", card);
  }
}

/** CardLadder adapter (sports cards only) */
export class CardLadderAdapter implements PriceSourceAdapter {
  name = "cardladder";

  async fetchQuotes(card: CardPriceIdentity): Promise<PriceQuote[]> {
    const data = await fetchSportsCardPrices(card);
    if (!data) return [];
    return sourceToQuotes(data.cardLadder, "cardladder", "guide", card);
  }
}

/** 130point.com adapter (sports cards only) */
export class OneThirtyPointAdapter implements PriceSourceAdapter {
  name = "130point";

  async fetchQuotes(card: CardPriceIdentity): Promise<PriceQuote[]> {
    const data = await fetchSportsCardPrices(card);
    if (!data) return [];
    return sourceToQuotes(data.oneThirtyPoint, "130point", "sold", card);
  }
}

/** eBay Sold via Firecrawl adapter (sports cards only) */
export class EbayFirecrawlAdapter implements PriceSourceAdapter {
  name = "ebay-firecrawl";

  async fetchQuotes(card: CardPriceIdentity): Promise<PriceQuote[]> {
    const data = await fetchSportsCardPrices(card);
    if (!data) return [];
    return sourceToQuotes(data.ebay, "ebay-firecrawl", "sold", card);
  }
}

/** Get all sports-card-specific adapters */
export function getSportsCardAdapters(): PriceSourceAdapter[] {
  return [
    new SportsCardProAdapter(),
    new CardLadderAdapter(),
    new OneThirtyPointAdapter(),
    new EbayFirecrawlAdapter(),
  ];
}
