import { supabase } from "@/integrations/supabase/client";
import { withTimeout } from "@/lib/async/withTimeout";
import { findPriceChartingYuGiOhMatch, parseYugiohOcrText } from "@/lib/cardOcrParser";
import { lookupYugiohByPrintedCode } from "@/lib/yugiohDirectLookup";

export type RapidBasicLookupResponse = {
  success: boolean;
  source?:
    | "cache"
    | "ygoprodeck"
    | "pokemontcg"
    | "scryfall"
    | "pricecharting-set-code"
    | "google-lens-pricecharting"
    | "requires_user_disambiguation"
    | "none";
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
  pricing?: {
    raw?: number | null;
    psa8?: number | null;
    psa9?: number | null;
    psa10?: number | null;
    cgc9?: number | null;
    cgc10?: number | null;
    highestSold?: number | null;
    url?: string | null;
  } | null;
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

export async function runRapidBasicLookup(args: {
  imageUrl: string | null;
  ocrText: string;
  title?: string | null;
  setName?: string | null;
  setCode?: string | null;
  cardNumber?: string | null;
  edition?: string | null;
  game?: string | null;
  gameTypeHint?: string;
  allowGoogleLens: boolean;
  timeoutMs?: number;
}): Promise<RapidBasicLookupResponse> {
const directYgo = await lookupYugiohByPrintedCode(args.setCode);
if (directYgo) return directYgo;

const parsed = parseYugiohOcrText(args.ocrText);
const isYugioh = !args.gameTypeHint || /yugioh|yu-gi-oh/i.test(args.gameTypeHint) || Boolean(parsed.setCode);

if (isYugioh) {
  const localMatch = await findPriceChartingYuGiOhMatch({
    cardName: parsed.cardName,
    cardSet: parsed.cardSet,
    cardNumber: parsed.cardNumber,
    setCode: parsed.setCode,
    rawText: args.ocrText,
  }).catch((error) => {
    console.warn("[RapidBasicLookup] Local PriceCharting match failed:", error);
    return null;
  });

  if (localMatch && (localMatch.currentPriceRaw || localMatch.currentPricePsa9 || localMatch.currentPricePsa10)) {
    return {
      success: true,
      source: "pricecharting-set-code",
      cardData: {
        card_name: localMatch.cardName,
        card_set: localMatch.cardSet,
        card_number: localMatch.cardNumber,
        rarity: localMatch.rarity,
        game_type: "yugioh",
        sport_type: null,
        confidence: localMatch.confidence / 100,
      },
      pricing: {
        raw: localMatch.currentPriceRaw,
        psa8: null,
        psa9: localMatch.currentPricePsa9,
        psa10: localMatch.currentPricePsa10,
        cgc9: null,
        cgc10: null,
        highestSold: localMatch.suggestedPrice,
        url: localMatch.priceChartingUrl,
      },
      priceChartingUrl: localMatch.priceChartingUrl,
    };
  }
}

const timeoutMs = args.timeoutMs ?? 18000;
const res = await withTimeout(
  supabase.functions.invoke<RapidBasicLookupResponse>("rapid-basic-card-lookup", {
    body: {
      imageUrl: args.imageUrl,
      ocrText: args.ocrText,
      gameTypeHint: args.gameTypeHint,
      allowGoogleLens: args.allowGoogleLens,
    },
  }),
  timeoutMs + 1500,
  "Rapid basic card lookup",
);

  return {
    success: false,
    source: "none",
    error: "No local/direct lookup match. Retake photo closer to the printed set code.",
  };
}
