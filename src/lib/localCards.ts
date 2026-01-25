import { supabase } from "@/integrations/supabase/client";

interface CardInsert {
  user_id: string;
  card_name: string;
  card_set?: string | null;
  card_number?: string | null;
  rarity?: string | null;
  image_url?: string | null;
  current_price_raw?: number | null;
  suggested_price?: number | null;
}

/**
 * Insert a card into Supabase (dual-write placeholder for future local storage).
 * Returns void - the card ID is managed by Supabase.
 */
export async function insertCardDual(card: CardInsert): Promise<void> {
  const { error } = await supabase.from("cards").insert({
    user_id: card.user_id,
    card_name: card.card_name,
    card_set: card.card_set,
    card_number: card.card_number,
    rarity: card.rarity,
    image_url: card.image_url || "",
    current_price_raw: card.current_price_raw,
    suggested_price: card.suggested_price,
  });

  if (error) {
    throw new Error(error.message);
  }
}
