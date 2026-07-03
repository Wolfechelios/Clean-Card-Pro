import { CardPricingSchema, type CardPricing } from "./schemas/api-schemas";
import { validateOrThrow } from "./errors";
import { findPriceChartingYuGiOhMatch } from "@/lib/cardOcrParser";

export type { CardPricing } from "./schemas/api-schemas";

function emptyPricing(source = "Local Only"): CardPricing {
  return validateOrThrow(CardPricingSchema, {
    raw: null,
    psa9: null,
    psa10: null,
    cgc9: null,
    cgc10: null,
    suggested: null,
    highestSold: null,
    medianRaw: null,
    medianPsa9: null,
    medianPsa10: null,
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
    tcgPlayerUrl: null,
    source,
  });
}

export async function fetchCardPrices(
  cardName: string,
  cardSet?: string | null,
  cardNumber?: string | null,
  gameType?: string | null,
  sportType?: string | null,
  condition?: string | null
): Promise<CardPricing> {
  const isYugioh =
    (gameType || "").toLowerCase().includes("yugioh") ||
    (gameType || "").toLowerCase().includes("yu-gi-oh") ||
    Boolean(cardNumber && /[A-Z0-9]{2,12}[-\s]?(?:[A-Z]{2})?[-\s]?\d{2,5}[A-Z]?/i.test(cardNumber));

  if (isYugioh) {
    const pcMatch = await findPriceChartingYuGiOhMatch({ cardName, cardSet, cardNumber, setCode: cardNumber }).catch(() => null);
    if (pcMatch?.currentPriceRaw || pcMatch?.currentPricePsa9 || pcMatch?.currentPricePsa10) {
      return validateOrThrow(CardPricingSchema, {
        raw: pcMatch.currentPriceRaw,
        psa9: pcMatch.currentPricePsa9,
        psa10: pcMatch.currentPricePsa10,
        cgc9: null,
        cgc10: null,
        suggested: pcMatch.suggestedPrice ?? pcMatch.currentPriceRaw,
        highestSold: pcMatch.suggestedPrice ?? pcMatch.currentPriceRaw,
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
        source: "PriceCharting Local",
      });
    }
  }

  return emptyPricing("Local Only - No Price Match");
}
