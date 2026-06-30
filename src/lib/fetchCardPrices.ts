import { supabase } from "@/integrations/supabase/client";
import { CardPricingSchema, type CardPricing } from "./schemas/api-schemas";
import { handleApiError, validateOrThrow } from "./errors";
import { findPriceChartingYuGiOhMatch } from "@/lib/cardOcrParser";

// Re-export the type for backwards compatibility
export type { CardPricing } from "./schemas/api-schemas";

export async function fetchCardPrices(
  cardName: string,
  cardSet?: string | null,
  cardNumber?: string | null,
  gameType?: string | null,
  sportType?: string | null,
  condition?: string | null
): Promise<CardPricing> {
  const isYugioh = (gameType || "").toLowerCase().includes("yugioh") || (gameType || "").toLowerCase().includes("yu-gi-oh");

  if (isYugioh) {
    const pcMatch = await findPriceChartingYuGiOhMatch({ cardName, cardSet, cardNumber }).catch(() => null);
    if (pcMatch?.currentPriceRaw || pcMatch?.currentPricePsa9 || pcMatch?.currentPricePsa10) {
      return validateOrThrow(CardPricingSchema, {
        raw: pcMatch.currentPriceRaw,
        psa9: pcMatch.currentPricePsa9,
        psa10: pcMatch.currentPricePsa10,
        cgc9: null,
        cgc10: null,
        suggested: pcMatch.suggestedPrice ?? pcMatch.currentPriceRaw,
        highestSold: null,
        medianRaw: pcMatch.currentPriceRaw,
        medianPsa9: pcMatch.currentPricePsa9,
        medianPsa10: pcMatch.currentPricePsa10,
        medianCgc9: null,
        medianCgc10: null,
        ebayRaw: null,
        ebayPsa9: null,
        ebayPsa10: null,
        ebayCgc9: null,
        ebayCgc10: null,
        ebayUrl: null,
        tcgPlayerPrice: null,
        tcgPlayerLow: null,
        tcgPlayerMid: null,
        tcgPlayerHigh: null,
        tcgPlayerMarket: null,
        tcgPlayerUrl: pcMatch.priceChartingUrl,
        source: "PriceCharting",
      });
    }
  }

  const { data, error } = await supabase.functions.invoke("fetch-card-prices", {
    body: {
      cardName,
      cardSet,
      cardNumber,
      gameType,
      sportType,
      condition,
    },
  });

  if (error) {
    throw handleApiError(error);
  }

  return validateOrThrow(CardPricingSchema, data);
}
