import { supabase } from "@/integrations/supabase/client";

export interface CardPricing {
  // Highest raw values (with 30% markup)
  raw: number | null;
  psa9: number | null;
  psa10: number | null;
  cgc9: number | null;
  cgc10: number | null;
  suggested: number | null;
  // Original median values (before highest raw adjustment)
  medianRaw: number | null;
  medianPsa9: number | null;
  medianPsa10: number | null;
  medianCgc9: number | null;
  medianCgc10: number | null;
  // eBay reference values
  ebayRaw: number | null;
  ebayPsa9: number | null;
  ebayPsa10: number | null;
  ebayCgc9: number | null;
  ebayCgc10: number | null;
  ebayUrl: string | null;
  source: string;
}

export async function fetchCardPrices(
  cardName: string,
  cardSet?: string | null,
  cardNumber?: string | null,
  gameType?: string | null,
  sportType?: string | null
): Promise<CardPricing> {
  const { data, error } = await supabase.functions.invoke("fetch-card-prices", {
    body: {
      cardName,
      cardSet,
      cardNumber,
      gameType,
      sportType,
    },
  });

  if (error) {
    console.error("Error fetching card prices:", error);
    throw new Error(error.message || "Failed to fetch card prices");
  }

  return data as CardPricing;
}
