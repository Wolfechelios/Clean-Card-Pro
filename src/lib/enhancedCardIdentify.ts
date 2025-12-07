import { supabase } from "@/integrations/supabase/client";

export type EnhancedCardData = {
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  rarity: string | null;
  edition: string | null;
  game_type: string | null;
  sport_type: string | null;
  year: string | null;
  manufacturer: string | null;
  confidence: number;
  description: string;
};

export async function enhancedCardIdentify(
  imageUrl: string,
  ocrText?: string
): Promise<EnhancedCardData> {
  const { data, error } = await supabase.functions.invoke("enhanced-card-identify", {
    body: {
      imageUrl,
      ocrText,
    },
  });

  if (error) {
    throw new Error(`enhanced-card-identify failed: ${error.message}`);
  }

  if (!data.success) {
    throw new Error(data.error || "Failed to identify card");
  }

  return data.cardData as EnhancedCardData;
}
