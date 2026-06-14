// src/lib/verification/verifyCard.ts
// Orchestrator: re-identifies a card from its image, returns primary + alternatives,
// and prices a chosen candidate.

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

export interface VerifiedCandidate extends VerifiedIdentification {
  /** Optional reason or description from AI */
  reason?: string;
}

export interface VerifyCardResult {
  /** Best primary match (selected by default) */
  identification: VerifiedIdentification;
  /** All candidates including primary at index 0 */
  candidates: VerifiedCandidate[];
  /** Reference image URL for the selected candidate (best-effort) */
  referenceImageUrl: string | null;
  /** Price consensus for the selected candidate */
  consensus: PriceConsensus;
  needsReview: boolean;
}

function pickPrimary(cardData: any): any {
  if (!cardData) return {};
  if (cardData.primary && typeof cardData.primary === "object") return cardData.primary;
  return cardData;
}

function toNumberConfidence(c: any, fallback = 0.7): number {
  if (typeof c === "number") return c > 1 ? c / 100 : c;
  if (typeof c === "string") {
    const lower = c.toLowerCase();
    if (lower.includes("high")) return 0.9;
    if (lower.includes("med")) return 0.7;
    if (lower.includes("low")) return 0.5;
    const parsed = parseFloat(c);
    if (!isNaN(parsed)) return parsed > 1 ? parsed / 100 : parsed;
  }
  return fallback;
}

function buildCandidate(
  raw: any,
  fallback: VerifyCardInput,
  isPrimary: boolean
): VerifiedCandidate {
  return {
    cardName: raw.card_name || raw.name || fallback.cardName || "Unknown",
    cardSet: raw.card_set ?? raw.set ?? (isPrimary ? fallback.cardSet ?? null : null),
    cardNumber: raw.card_number ?? raw.number ?? (isPrimary ? fallback.cardNumber ?? null : null),
    rarity: raw.rarity ?? (isPrimary ? fallback.rarity ?? null : null),
    gameType: raw.game_type ?? (isPrimary ? fallback.gameType ?? null : null),
    sportType: raw.sport_type ?? (isPrimary ? fallback.sportType ?? null : null),
    matchConfidence: toNumberConfidence(raw.confidence ?? raw.match_confidence),
    reason: raw.reason,
  };
}

/**
 * Look up a verified reference image for a candidate via the existing
 * generate-card-image-url edge function. Best-effort; returns null on failure.
 */
async function fetchReferenceImage(c: VerifiedCandidate): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke("generate-card-image-url", {
      body: {
        cardName: c.cardName,
        cardSet: c.cardSet,
        cardNumber: c.cardNumber,
        gameType: c.gameType || c.sportType,
      },
    });
    if (error) return null;
    const url = data?.imageUrl;
    if (!url || typeof url !== "string") return null;
    if (url.includes("placehold")) return null;
    return url;
  } catch {
    return null;
  }
}

function candidateToIdentity(c: VerifiedCandidate, condition?: string | null): CardPriceIdentity {
  return {
    name: c.cardName,
    set: c.cardSet,
    number: c.cardNumber,
    rarity: c.rarity,
    condition: condition ?? null,
    gameType: c.gameType,
    sportType: c.sportType,
    matchConfidence: c.matchConfidence,
  };
}

/**
 * Re-run identification + price consensus for a card.
 * Returns primary match + alternatives. Pricing is computed for the primary.
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

  if (error) throw new Error(error.message || "Identification failed.");
  if (!data?.success) throw new Error(data?.error || "Could not identify card.");

  const primaryRaw = pickPrimary(data.cardData);
  const primary = buildCandidate(primaryRaw, card, true);

  const altsRaw: any[] = Array.isArray(data?.cardData?.alternatives)
    ? data.cardData.alternatives
    : [];

  const alternatives = altsRaw
    .map((a) => buildCandidate(a, card, false))
    // Drop alternatives that exactly match primary by name+set
    .filter(
      (a) =>
        !(a.cardName === primary.cardName && (a.cardSet ?? "") === (primary.cardSet ?? ""))
    )
    .slice(0, 4);

  const candidates: VerifiedCandidate[] = [primary, ...alternatives];

  // 2) Reference image + price consensus for primary, in parallel
  const identity = candidateToIdentity(primary, card.condition);
  if (force) clearConsensusCache(identity);

  const [referenceImageUrl, consensus] = await Promise.all([
    fetchReferenceImage(primary),
    verifyCardPrice(identity),
  ]);

  return {
    identification: primary,
    candidates,
    referenceImageUrl,
    consensus,
    needsReview: requiresManualReview(consensus),
  };
}

/**
 * Re-price a chosen candidate (e.g. user picked an alternative).
 * Also fetches a fresh reference image for that candidate.
 */
export async function priceCandidate(
  candidate: VerifiedCandidate,
  condition?: string | null,
  force = false
): Promise<{ consensus: PriceConsensus; referenceImageUrl: string | null; needsReview: boolean }> {
  const identity = candidateToIdentity(candidate, condition);
  if (force) clearConsensusCache(identity);

  const [referenceImageUrl, consensus] = await Promise.all([
    fetchReferenceImage(candidate),
    verifyCardPrice(identity),
  ]);

  return {
    consensus,
    referenceImageUrl,
    needsReview: requiresManualReview(consensus),
  };
}
