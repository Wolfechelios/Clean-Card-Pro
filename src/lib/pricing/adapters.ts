// src/lib/pricing/adapters.ts
// Client-side price source adapters that pull from existing pricing infrastructure.

import type { PriceQuote, CardPriceIdentity, PriceSourceAdapter } from "./types";
import { supabase } from "@/integrations/supabase/client";
import { getSportsCardAdapters } from "./sportsAdapters";

/**
 * Shared cache: the eBay and TCGPlayer adapters both consume the same
 * fetch-card-prices edge response — call it once per card identity.
 */
let cachedPricesCall: { key: string; promise: Promise<any | null> } | null = null;

async function fetchCardPricesShared(card: CardPriceIdentity): Promise<any | null> {
  const key = `${card.name}|${card.set}|${card.number}|${card.gameType}|${card.sportType}|${card.condition}`;
  if (cachedPricesCall && cachedPricesCall.key === key) return cachedPricesCall.promise;

  const promise = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("fetch-card-prices", {
        body: {
          cardName: card.name,
          cardSet: card.set,
          cardNumber: card.number,
          gameType: card.gameType,
          sportType: card.sportType,
          condition: card.condition,
        },
      });
      if (error || !data) return null;
      return data;
    } catch (e) {
      console.warn("[fetchCardPricesShared] Failed:", e);
      return null;
    }
  })();

  cachedPricesCall = { key, promise };
  // Auto-expire shared cache after 30s so re-runs work
  setTimeout(() => {
    if (cachedPricesCall?.key === key) cachedPricesCall = null;
  }, 30_000);
  return promise;
}

/**
 * Adapter: eBay Sold Comps via fetch-card-prices edge function.
 */
export class EbaySoldAdapter implements PriceSourceAdapter {
  name = "ebay-sold";

  async fetchQuotes(card: CardPriceIdentity): Promise<PriceQuote[]> {
    const data = await fetchCardPricesShared(card);
    if (!data) return [];

    const quotes: PriceQuote[] = [];
    const now = Date.now();

    if (data.ebayRaw != null && data.ebayRaw > 0) {
      quotes.push({
        source: "ebay-sold",
        kind: "sold",
        priceUSD: data.ebayRaw,
        ts: now,
        url: data.ebayUrl || undefined,
        samples: 1,
      });
    }

    if (data.ebayPsa9 != null && data.ebayPsa9 > 0 && card.condition?.includes("PSA 9")) {
      quotes.push({
        source: "ebay-sold-psa9",
        kind: "sold",
        priceUSD: data.ebayPsa9,
        ts: now,
        url: data.ebayUrl || undefined,
      });
    }

    if (data.ebayPsa10 != null && data.ebayPsa10 > 0 && card.condition?.includes("PSA 10")) {
      quotes.push({
        source: "ebay-sold-psa10",
        kind: "sold",
        priceUSD: data.ebayPsa10,
        ts: now,
        url: data.ebayUrl || undefined,
      });
    }

    if (data.medianRaw != null && data.medianRaw > 0) {
      quotes.push({
        source: "ebay-median",
        kind: "guide",
        priceUSD: data.medianRaw,
        ts: now,
      });
    }

    return quotes;
  }
}

/**
 * Adapter: PriceCharting via local pc_cards/pc_sets tables (user-imported).
 */
export class PriceChartingLocalAdapter implements PriceSourceAdapter {
  name = "pricecharting";

  async fetchQuotes(card: CardPriceIdentity): Promise<PriceQuote[]> {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user?.user?.id) return [];

      let query = supabase
        .from("pc_cards")
        .select("*, pc_sets!inner(set_name, game)")
        .eq("user_id", user.user.id);

      if (card.number) query = query.eq("card_number", card.number);

      const cardNameClean = card.name.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
      query = query.ilike("card_name_clean", `%${cardNameClean}%`);

      const { data: pcCards, error } = await query.limit(5);
      if (error || !pcCards?.length) return [];

      const quotes: PriceQuote[] = [];
      const now = Date.now();

      for (const pc of pcCards) {
        if (pc.ungraded_price != null && pc.ungraded_price > 0) {
          quotes.push({
            source: "pricecharting",
            kind: "guide",
            priceUSD: pc.ungraded_price,
            ts: now,
            url: pc.card_url || undefined,
          });
        }
        if (pc.psa10_price != null && pc.psa10_price > 0 && card.condition?.includes("PSA 10")) {
          quotes.push({
            source: "pricecharting-psa10",
            kind: "guide",
            priceUSD: pc.psa10_price,
            ts: now,
            url: pc.card_url || undefined,
          });
        }
        if (pc.graded_price != null && pc.graded_price > 0) {
          quotes.push({
            source: "pricecharting-graded",
            kind: "guide",
            priceUSD: pc.graded_price,
            ts: now,
            url: pc.card_url || undefined,
          });
        }
      }

      return quotes;
    } catch (e) {
      console.warn("[PriceChartingLocalAdapter] Failed:", e);
      return [];
    }
  }
}

/**
 * Adapter: TCGPlayer via fetch-card-prices edge function.
 */
export class TCGPlayerAdapter implements PriceSourceAdapter {
  name = "tcgplayer";

  async fetchQuotes(card: CardPriceIdentity): Promise<PriceQuote[]> {
    const data = await fetchCardPricesShared(card);
    if (!data) return [];

    const quotes: PriceQuote[] = [];
    const now = Date.now();

    if (data.tcgPlayerMarket != null && data.tcgPlayerMarket > 0) {
      quotes.push({
        source: "tcgplayer-market",
        kind: "guide",
        priceUSD: data.tcgPlayerMarket,
        ts: now,
        url: data.tcgPlayerUrl || undefined,
      });
    }

    if (data.tcgPlayerPrice != null && data.tcgPlayerPrice > 0) {
      quotes.push({
        source: "tcgplayer-last-sold",
        kind: "sold",
        priceUSD: data.tcgPlayerPrice,
        ts: now,
        url: data.tcgPlayerUrl || undefined,
      });
    }

    return quotes;
  }
}

function isSportsCard(card?: CardPriceIdentity | null): boolean {
  if (!card) return false;
  const sport = card.sportType?.toLowerCase();
  return !!sport && ["baseball", "basketball", "football", "hockey", "soccer", "sports"].some(
    (s) => sport.includes(s)
  );
}

/**
 * All available adapters in priority order.
 * - Sports cards: full sports stack (SportsCardPro, CardLadder, 130point, eBay-Firecrawl)
 *   plus eBay/TCGPlayer fallbacks.
 * - TCG (MTG / Pokémon / Yu-Gi-Oh): local PriceCharting → TCGPlayer → eBay sold.
 */
export function getDefaultAdapters(card?: CardPriceIdentity | null): PriceSourceAdapter[] {
  if (isSportsCard(card)) {
    return [
      ...getSportsCardAdapters(),
      new EbaySoldAdapter(),
      new TCGPlayerAdapter(),
    ];
  }

  return [
    new PriceChartingLocalAdapter(),
    new TCGPlayerAdapter(),
    new EbaySoldAdapter(),
  ];
}
