// src/lib/verification/verifyCard.ts
// Orchestrator: re-identifies a card from its image, then runs price consensus.

import { supabase } from "@/integrations/supabase/client";
import { verifyCardPrice, clearConsensusCache, requiresManualReview } from "@/lib/pricing/priceVerification";
import type { CardPriceIdentity, PriceConsensus } from "@/lib/pricing/types";

export interface VerifyCardInput {
  id?: string;
  imageUrl: string;
  cardName?: string | null;
  cardSet?: string | null;
  cardNumber?: string | null;
  rarity?: string | null;
  condition?: string | null;
  gameType?: string | null;
  sportType?: string | null;
}

export interface VerifiedIdentification {
  cardName: string;
  cardSet: string | null;
  cardNumber: string | null;
  rarity: string | null;
  gameType: string | null;
  sportType: string | null;
  matchConfidence: number;
}

export interface VerifyCardResult {
  identification: VerifiedIdentification;
  consensus: PriceConsensus;
  needsReview: boolean;
}

function pickPrimary(cardData: any): any {
  if (!cardData) return {};
  if (cardData.primary && typeof cardData.primary === "object") return cardData.primary;
  return cardData;
}

/**
 * Re-run identification + price consensus for a card.
 * @param force when true, bypasses the consensus cache
 */
export async function verifyCard(
  card: VerifyCardInput,
  force = false
): Promise<VerifyCardResult> {
  if (!card.imageUrl) {
    throw new Error("No image URL available to verify this card.");
  }

  // 1) Re-identify via existing edge function
  const { data, error } = await supabase.functions.invoke("enhanced-card-identify", {
    body: {
      imageUrl: card.imageUrl,
      gameTypeHint: card.gameType?.toLowerCase() || "auto",
    },
  });

  if (error) {
    throw new Error(error.message || "Identification failed.");
  }
  if (!data?.success) {
    throw new Error(data?.error || "Could not identify card.");
  }

  const primary = pickPrimary(data.cardData);

  const identification: VerifiedIdentification = {
    cardName: primary.card_name || primary.name || card.cardName || "Unknown",
    cardSet: primary.card_set ?? primary.set ?? card.cardSet ?? null,
    cardNumber: primary.card_number ?? primary.number ?? card.cardNumber ?? null,
    rarity: primary.rarity ?? card.rarity ?? null,
    gameType: primary.game_type ?? card.gameType ?? null,
    sportType: primary.sport_type ?? card.sportType ?? null,
    matchConfidence:
      typeof primary.confidence === "number"
        ? primary.confidence
        : typeof primary.match_confidence === "number"
        ? primary.match_confidence
        : 0.7,
  };

  // 2) Price consensus on the verified identity
  const identity: CardPriceIdentity = {
    name: identification.cardName,
    set: identification.cardSet,
    number: identification.cardNumber,
    rarity: identification.rarity,
    condition: card.condition,
    gameType: identification.gameType,
    sportType: identification.sportType,
    matchConfidence: identification.matchConfidence,
  };

  if (force) clearConsensusCache(identity);
  const consensus = await verifyCardPrice(identity);

  return {
    identification,
    consensus,
    needsReview: requiresManualReview(consensus),
  };
}
