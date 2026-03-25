// Foil Trainer — Correction Store (Supabase persistence)
// Saves user corrections and queries history for learning

import { supabase } from "@/integrations/supabase/client";
import type { FoilCorrectionPayload, FoilLearningEntry } from "./types";

// ── Save a correction ───────────────────────────────────────────────────

export async function saveFoilCorrection(
  userId: string,
  correction: FoilCorrectionPayload,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.from("foil_scan_corrections" as any).insert({
      user_id: userId,
      scan_id: correction.scanId,
      card_id: correction.cardId || null,
      image_hash: correction.imageHash || null,
      perceptual_hash: correction.perceptualHash || null,
      game: correction.game,
      set_id: correction.setId || null,
      set_name: correction.setName || null,
      card_number: correction.cardNumber || null,
      predicted_card_name: correction.predictedCardName || null,
      predicted_rarity: correction.predictedRarity || null,
      corrected_rarity: correction.correctedRarity || null,
      predicted_finish: correction.predictedFinish || null,
      corrected_finish: correction.correctedFinish || null,
      foil_confidence: correction.foilConfidence ?? null,
      parallel_confidence: correction.parallelConfidence ?? null,
      was_correct: correction.wasCorrect,
      issue_tags: correction.issueTags || [],
      original_image_uri: correction.originalImageUri || null,
      processed_image_uri: correction.processedImageUri || null,
      reconditioned_image_uri: correction.reconditionedImageUri || null,
      roi_metadata: correction.roiMetadata || null,
      lighting_metadata: correction.lightingMetadata || null,
      reflection_metadata: correction.reflectionMetadata || null,
      ocr_snapshot: correction.ocrSnapshot || null,
      user_confirmed_at: new Date().toISOString(),
    } as any);

    if (error) {
      console.error("saveFoilCorrection error:", error);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (e: any) {
    console.error("saveFoilCorrection exception:", e);
    return { success: false, error: e.message };
  }
}

// ── Update learning memory ──────────────────────────────────────────────

export async function updateFoilLearningMemory(
  userId: string,
  keyType: string,
  keyValue: string,
  game: string | null,
  correctedFinish: string | null,
  correctedRarity: string | null,
  wasCorrect: boolean,
): Promise<void> {
  try {
    // Try to find existing entry
    const { data: existing } = await supabase
      .from("foil_learning_memory" as any)
      .select("id, support_count, reject_count, confidence_weight")
      .eq("user_id", userId)
      .eq("key_type", keyType)
      .eq("key_value", keyValue)
      .eq("corrected_finish", correctedFinish || "")
      .maybeSingle() as any;

    if (existing) {
      const newSupport = (existing.support_count || 0) + (wasCorrect ? 1 : 0);
      const newReject = (existing.reject_count || 0) + (wasCorrect ? 0 : 1);
      const total = newSupport + newReject;
      const newWeight = total > 0 ? newSupport / total : 0.5;

      await supabase
        .from("foil_learning_memory" as any)
        .update({
          support_count: newSupport,
          reject_count: newReject,
          confidence_weight: Math.round(newWeight * 1000) / 1000,
          last_seen_at: new Date().toISOString(),
          corrected_rarity: correctedRarity || existing.corrected_rarity,
        } as any)
        .eq("id", existing.id) as any;
    } else {
      await supabase.from("foil_learning_memory" as any).insert({
        user_id: userId,
        key_type: keyType,
        key_value: keyValue,
        game: game,
        corrected_finish: correctedFinish || "",
        corrected_rarity: correctedRarity || null,
        support_count: wasCorrect ? 1 : 0,
        reject_count: wasCorrect ? 0 : 1,
        confidence_weight: wasCorrect ? 0.6 : 0.4,
      } as any);
    }
  } catch (e) {
    console.error("updateFoilLearningMemory error:", e);
  }
}

// ── Query learning evidence ─────────────────────────────────────────────

export async function queryFoilLearningEvidence(
  userId: string,
  keyType: string,
  keyValue: string,
): Promise<FoilLearningEntry[]> {
  try {
    const { data, error } = await supabase
      .from("foil_learning_memory" as any)
      .select("*")
      .eq("user_id", userId)
      .eq("key_type", keyType)
      .eq("key_value", keyValue)
      .order("confidence_weight", { ascending: false })
      .limit(10) as any;

    if (error || !data) return [];

    return data.map((row: any) => ({
      id: row.id,
      keyType: row.key_type,
      keyValue: row.key_value,
      game: row.game,
      correctedFinish: row.corrected_finish,
      correctedRarity: row.corrected_rarity,
      supportCount: row.support_count,
      rejectCount: row.reject_count,
      confidenceWeight: row.confidence_weight,
      lastSeenAt: row.last_seen_at,
    }));
  } catch (e) {
    console.error("queryFoilLearningEvidence error:", e);
    return [];
  }
}

// ── Get correction history for a card ───────────────────────────────────

export async function getFoilCorrectionsForCard(
  userId: string,
  cardName: string,
  limit = 20,
): Promise<any[]> {
  try {
    const { data } = await supabase
      .from("foil_scan_corrections" as any)
      .select("*")
      .eq("user_id", userId)
      .ilike("predicted_card_name", `%${cardName}%`)
      .order("created_at", { ascending: false })
      .limit(limit) as any;

    return data || [];
  } catch {
    return [];
  }
}

// ── Get all pending foil reviews ────────────────────────────────────────

export async function getPendingFoilReviews(
  userId: string,
): Promise<any[]> {
  try {
    const { data } = await supabase
      .from("foil_scan_corrections" as any)
      .select("*")
      .eq("user_id", userId)
      .is("user_confirmed_at", null)
      .order("created_at", { ascending: false })
      .limit(50) as any;

    return data || [];
  } catch {
    return [];
  }
}
