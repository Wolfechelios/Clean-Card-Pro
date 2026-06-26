import { supabase } from "@/integrations/supabase/client";
import { withTimeout } from "@/lib/async/withTimeout";

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
  const timeoutMs = args.timeoutMs ?? 18000;
  const res = await withTimeout(
    supabase.functions.invoke<RapidBasicLookupResponse>("rapid-basic-card-lookup", {
      body: {
        imageUrl: args.imageUrl,
        ocrText: args.ocrText,
        title: args.title ?? null,
        setName: args.setName ?? null,
        setCode: args.setCode ?? null,
        cardNumber: args.cardNumber ?? null,
        edition: args.edition ?? null,
        game: args.game ?? null,
        gameTypeHint: args.gameTypeHint,
        allowGoogleLens: args.allowGoogleLens,
      },
    }),
    timeoutMs + 1500,
    "Rapid basic card lookup",
  );

  if (res.error) {
    return { success: false, source: "none", error: res.error.message ?? String(res.error) };
  }
  return res.data ?? { success: false, source: "none", error: "No lookup response" };
}
