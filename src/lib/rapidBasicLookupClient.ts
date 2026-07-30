import { findPriceChartingYuGiOhMatch, parseYugiohOcrText } from "@/lib/cardOcrParser";
import { lookupYugiohByPrintedCode } from "@/lib/yugiohDirectLookup";
import { lookupMtgByName, lookupMtgByPrintedCode, type ScryfallCard } from "@/lib/mtg/scryfallLookup";


export type RapidBasicLookupResponse = {
  success: boolean;
  source?: "cache" | "ygoprodeck" | "pokemontcg" | "scryfall" | "pricecharting-set-code" | "google-lens-pricecharting" | "requires_user_disambiguation" | "none";
  cardData?: {
    card_name?: string | null;
    card_set?: string | null;
    card_number?: string | null;
    rarity?: string | null;
    game_type?: string | null;
    sport_type?: string | null;
    year?: string | null;
    manufacturer?: string | null;
    confidence?: number | null;
  } | null;
  pricing?: { raw?: number | null; psa8?: number | null; psa9?: number | null; psa10?: number | null; cgc9?: number | null; cgc10?: number | null; highestSold?: number | null; url?: string | null } | null;
  priceChartingUrl?: string | null;
  googleLensUrl?: string | null;
  confidenceTier?: "HIGH" | "MEDIUM" | "LOW";
  requiresDisambiguation?: boolean;
  error?: string;
};

export function compactOcrText(...parts: Array<string | null | undefined>): string {
  return parts.map((p) => String(p ?? "").trim()).filter(Boolean).join("\n");
}

export function hasReadablePrice(pricing: RapidBasicLookupResponse["pricing"]): boolean {
  if (!pricing) return false;
  return Boolean(pricing.raw || pricing.psa8 || pricing.psa9 || pricing.psa10 || pricing.cgc9 || pricing.cgc10 || pricing.highestSold);
}

function fromPriceChartingMatch(localMatch: NonNullable<Awaited<ReturnType<typeof findPriceChartingYuGiOhMatch>>>): RapidBasicLookupResponse {
  return {
    success: true,
    source: "pricecharting-set-code",
    confidenceTier: localMatch.confidence >= 90 ? "HIGH" : localMatch.confidence >= 70 ? "MEDIUM" : "LOW",
    cardData: { card_name: localMatch.cardName, card_set: localMatch.cardSet, card_number: localMatch.cardNumber, rarity: localMatch.rarity, game_type: "Yu-Gi-Oh", sport_type: null, manufacturer: "Konami", confidence: localMatch.confidence / 100 },
    pricing: { raw: localMatch.currentPriceRaw, psa8: null, psa9: localMatch.currentPricePsa9, psa10: localMatch.currentPricePsa10, cgc9: null, cgc10: null, highestSold: localMatch.suggestedPrice, url: localMatch.priceChartingUrl },
    priceChartingUrl: localMatch.priceChartingUrl,
    googleLensUrl: null,
    requiresDisambiguation: false,
  };
}

function fromScryfall(card: ScryfallCard): RapidBasicLookupResponse {
  const raw = card.priceUsd ?? card.priceUsdFoil ?? null;
  return {
    success: true,
    source: "scryfall",
    confidenceTier: "HIGH",
    cardData: {
      card_name: card.cardName,
      card_set: card.setName || card.setCode,
      card_number: card.collectorNumber || null,
      rarity: card.rarity,
      game_type: "Magic: The Gathering",
      sport_type: null,
      manufacturer: "Wizards of the Coast",
      confidence: 0.95,
    },
    pricing: { raw, psa8: null, psa9: null, psa10: null, cgc9: null, cgc10: null, highestSold: null, url: card.scryfallUrl },
    priceChartingUrl: null,
    googleLensUrl: null,
    requiresDisambiguation: false,
  };
}

async function runMtgLookup(args: { setCode?: string | null; cardNumber?: string | null; title?: string | null }): Promise<RapidBasicLookupResponse> {
  const byCode = await lookupMtgByPrintedCode(args.setCode, args.cardNumber);
  if (byCode) return fromScryfall(byCode);

  const byName = await lookupMtgByName(args.title);
  if (byName) return fromScryfall(byName);

  return {
    success: false,
    source: "none",
    error: "No Magic card match. Retake the photo so the card name and the bottom-left set code are readable.",
  };
}

export async function runRapidBasicLookup(args: { imageUrl: string | null; ocrText: string; title?: string | null; setName?: string | null; setCode?: string | null; cardNumber?: string | null; edition?: string | null; game?: string | null; gameTypeHint?: string; allowGoogleLens: boolean; timeoutMs?: number }): Promise<RapidBasicLookupResponse> {
  const isMtg = /^mtg$/i.test(String(args.game ?? "")) || /mtg|magic/i.test(String(args.gameTypeHint ?? ""));
  if (isMtg) {
    return runMtgLookup({ setCode: args.setCode, cardNumber: args.cardNumber, title: args.title });
  }

  const parsed = parseYugiohOcrText(args.ocrText);
  const isYugioh = !args.gameTypeHint || /yugioh|yu-gi-oh/i.test(args.gameTypeHint) || Boolean(args.setCode || parsed.setCode);

  if (isYugioh) {
    const localMatch = await findPriceChartingYuGiOhMatch({
      cardName: args.title || parsed.cardName,
      cardSet: args.setName || parsed.cardSet,
      cardNumber: args.cardNumber || parsed.cardNumber,
      setCode: args.setCode || parsed.setCode,
      rawText: args.ocrText,
    }).catch((error) => {
      console.warn("[RapidBasicLookup] local PriceCharting match failed:", error);
      return null;
    });
    if (localMatch) return fromPriceChartingMatch(localMatch);

    const directYgo = await lookupYugiohByPrintedCode(args.setCode || parsed.setCode);
    if (directYgo) return directYgo;
  }

  return { success: false, source: "none", error: "No printed-code lookup match. Retake the photo closer to the set/card code." };
}

