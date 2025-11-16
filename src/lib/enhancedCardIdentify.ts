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
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/enhanced-card-identify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageUrl,
        ocrText,
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`enhanced-card-identify failed: ${res.status} – ${text}`);
  }

  const data = await res.json();
  
  if (!data.success) {
    throw new Error(data.error || "Failed to identify card");
  }

  return data.cardData as EnhancedCardData;
}
