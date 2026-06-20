import { supabase } from "@/integrations/supabase/client";
import { CardPricingSchema, type CardPricing } from "./schemas/api-schemas";
import { handleApiError, validateOrThrow } from "./errors";

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
