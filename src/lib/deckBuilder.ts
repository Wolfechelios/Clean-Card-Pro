import { supabase } from "@/integrations/supabase/client";

export interface DeckCard {
  cardName: string;
  quantity: number;
  role: string;
  inCollection: boolean;
  estimatedPrice: number;
  imageUrl?: string | null;
  collectionCardId?: string | null;
}

export interface CardToAcquire {
  cardName: string;
  reason: string;
  estimatedPrice: number;
  priority: "must-have" | "recommended" | "optional";
}

export interface DeckBuild {
  deckName: string;
  strategy: string;
  mainDeck: DeckCard[];
  extraDeck?: DeckCard[];
  sideDeck?: DeckCard[];
  totalValue: number;
  valuePotential: string;
  competitiveRating: "casual" | "locals" | "regional" | "meta";
  cardsToAcquire: CardToAcquire[];
  synergies: string[];
  weaknesses: string[];
}

export interface DeckBuilderResult {
  success: boolean;
  deck?: DeckBuild;
  collectionStats?: {
    totalCards: number;
    totalValue: number;
    gameType: string;
  };
  generatedAt?: string;
  error?: string;
}

export type DeckMode = "value" | "battle";
export type GameType = "Yu-Gi-Oh!" | "MTG" | "Pokemon" | "all";

export async function buildDeck(params: {
  mode: DeckMode;
  gameType: GameType;
  setFilter?: string;
  deckSize?: number;
  useCollectionOnly: boolean;
}): Promise<DeckBuilderResult> {
  const { data, error } = await supabase.functions.invoke("deck-builder", {
    body: params,
  });

  if (error) {
    console.error("Deck builder error:", error);
    return {
      success: false,
      error: error.message || "Failed to build deck",
    };
  }

  return data as DeckBuilderResult;
}
