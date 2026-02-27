// src/lib/pricing/adapters.ts
// Client-side price source adapters that pull from existing pricing infrastructure

import type { PriceQuote, CardPriceIdentity, PriceSourceAdapter } from "./types";
import { supabase } from "@/integrations/supabase/client";

/**
 * Adapter: eBay Sold Comps via existing fetch-card-prices edge function
 * Extracts eBay sold data from the existing pricing response.
 */
export class EbaySoldAdapter implements PriceSourceAdapter {
  name = "ebay-sold";

  async fetchQuotes(card: CardPriceIdentity): Promise<PriceQuote[]> {
    try {
      const { data, error } = await supabase.functions.invoke("fetch-card-prices", {
        body: {
          cardName: card.name,
          cardSet: card.set,
          cardNumber: card.number,
          gameType: card.gameType,
          sportType: card.sportType,
        },
      });

      if (error || !data) return [];

      const quotes: PriceQuote[] = [];
      const now = Date.now();

      // eBay raw price
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

      // eBay PSA 9
      if (data.ebayPsa9 != null && data.ebayPsa9 > 0 && card.condition?.includes("PSA 9")) {
        quotes.push({
          source: "ebay-sold-psa9",
          kind: "sold",
          priceUSD: data.ebayPsa9,
          ts: now,
          url: data.ebayUrl || undefined,
        });
      }

      // eBay PSA 10
      if (data.ebayPsa10 != null && data.ebayPsa10 > 0 && card.condition?.includes("PSA 10")) {
        quotes.push({
          source: "ebay-sold-psa10",
          kind: "sold",
          priceUSD: data.ebayPsa10,
          ts: now,
          url: data.ebayUrl || undefined,
        });
      }

      // Median values from the response as "guide" quotes
      if (data.medianRaw != null && data.medianRaw > 0) {
        quotes.push({
          source: "ebay-median",
          kind: "guide",
          priceUSD: data.medianRaw,
          ts: now,
        });
      }

      return quotes;
    } catch (e) {
      console.warn("[EbaySoldAdapter] Failed:", e);
      return [];
    }
  }
}

/**
 * Adapter: PriceCharting via local pc_cards/pc_sets tables
 * Uses the user's imported PriceCharting dataset.
 */
export class PriceChartingLocalAdapter implements PriceSourceAdapter {
  name = "pricecharting";

  async fetchQuotes(card: CardPriceIdentity): Promise<PriceQuote[]> {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user?.user?.id) return [];

      // Try exact match by set code + card number first
      let query = supabase
        .from("pc_cards")
        .select("*, pc_sets!inner(set_name, game)")
        .eq("user_id", user.user.id);

      if (card.number) {
        query = query.eq("card_number", card.number);
      }

      // Try name-based match
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
 * Adapter: TCGPlayer via existing fetch-card-prices edge function
 */
export class TCGPlayerAdapter implements PriceSourceAdapter {
  name = "tcgplayer";

  async fetchQuotes(card: CardPriceIdentity): Promise<PriceQuote[]> {
    try {
      const { data, error } = await supabase.functions.invoke("fetch-card-prices", {
        body: {
          cardName: card.name,
          cardSet: card.set,
          cardNumber: card.number,
          gameType: card.gameType,
          sportType: card.sportType,
        },
      });

      if (error || !data) return [];

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
    } catch (e) {
      console.warn("[TCGPlayerAdapter] Failed:", e);
      return [];
    }
  }
}

/**
 * All available adapters in priority order
 */
export function getDefaultAdapters(): PriceSourceAdapter[] {
  return [
    new EbaySoldAdapter(),
    new PriceChartingLocalAdapter(),
    new TCGPlayerAdapter(),
  ];
}
