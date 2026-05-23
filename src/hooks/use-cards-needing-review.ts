import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export type ReviewReason = "low_ocr_confidence" | "missing_rarity" | "missing_name" | "missing_set" | "missing_image";

export type CardNeedingReview = {
  id: string;
  card_name: string | null;
  card_set: string | null;
  rarity: string | null;
  ocr_confidence: number | null;
  image_url: string;
  reason: ReviewReason;
  created_at: string;
};

const OCR_CONFIDENCE_THRESHOLD = 80;

export function useCardsNeedingReview() {
  const { userId } = useAuth();
  const [cards, setCards] = useState<CardNeedingReview[]>([]);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState({
    low_ocr_confidence: 0,
    missing_rarity: 0,
    missing_name: 0,
    missing_set: 0,
    missing_image: 0,
    total: 0,
  });

  const fetchCards = useCallback(async (filter?: ReviewReason) => {
    if (!userId) return;
    setLoading(true);

    try {
      // Build query based on filter
      let query = supabase
        .from("cards")
        .select("id, card_name, card_set, rarity, ocr_confidence, image_url, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (filter === "low_ocr_confidence") {
        query = query.lt("ocr_confidence", OCR_CONFIDENCE_THRESHOLD);
      } else if (filter === "missing_rarity") {
        query = query.or("rarity.is.null,rarity.eq.,rarity.eq.Unknown,rarity.eq.unknown");
      } else if (filter === "missing_name") {
        query = query.or("card_name.is.null,card_name.eq.,card_name.eq.Unknown");
      } else if (filter === "missing_set") {
        query = query.or("card_set.is.null,card_set.eq.,card_set.eq.Unknown");
      } else if (filter === "missing_image") {
        query = query.or("image_url.is.null,image_url.eq.");
      } else {
        // All issues - use OR conditions
        query = query.or(
          `ocr_confidence.lt.${OCR_CONFIDENCE_THRESHOLD},rarity.is.null,rarity.eq.,rarity.eq.Unknown,card_name.is.null,card_name.eq.,card_name.eq.Unknown,card_set.is.null,card_set.eq.,card_set.eq.Unknown`
        );
      }

      const { data, error } = await query;

      if (error) throw error;

      // Map cards to include their review reason
      const mappedCards: CardNeedingReview[] = (data || []).map((card) => {
        let reason: ReviewReason = "low_ocr_confidence";
        
        if (!card.card_name || card.card_name === "" || card.card_name === "Unknown") {
          reason = "missing_name";
        } else if (!card.rarity || card.rarity === "" || card.rarity.toLowerCase() === "unknown") {
          reason = "missing_rarity";
        } else if (!card.card_set || card.card_set === "" || card.card_set === "Unknown") {
          reason = "missing_set";
        } else if (card.ocr_confidence !== null && card.ocr_confidence < OCR_CONFIDENCE_THRESHOLD) {
          reason = "low_ocr_confidence";
        }

        return { ...card, reason };
      });

      setCards(mappedCards);
    } catch (err) {
      console.error("Error fetching cards needing review:", err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const fetchCounts = useCallback(async () => {
    if (!userId) return;

    try {
      // Fetch counts for each category in parallel
      const [lowOcr, missingRarity, missingName, missingSet] = await Promise.all([
        supabase
          .from("cards")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .lt("ocr_confidence", OCR_CONFIDENCE_THRESHOLD),
        supabase
          .from("cards")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .or("rarity.is.null,rarity.eq.,rarity.eq.Unknown,rarity.eq.unknown"),
        supabase
          .from("cards")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .or("card_name.is.null,card_name.eq.,card_name.eq.Unknown"),
        supabase
          .from("cards")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .or("card_set.is.null,card_set.eq.,card_set.eq.Unknown"),
      ]);

      const counts = {
        low_ocr_confidence: lowOcr.count || 0,
        missing_rarity: missingRarity.count || 0,
        missing_name: missingName.count || 0,
        missing_set: missingSet.count || 0,
        missing_image: 0,
        total: 0,
      };

      // Calculate total (unique cards with any issue)
      const { count: totalCount } = await supabase
        .from("cards")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .or(
          `ocr_confidence.lt.${OCR_CONFIDENCE_THRESHOLD},rarity.is.null,rarity.eq.,rarity.eq.Unknown,card_name.is.null,card_name.eq.,card_name.eq.Unknown,card_set.is.null,card_set.eq.,card_set.eq.Unknown`
        );

      counts.total = totalCount || 0;
      setCounts(counts);
    } catch (err) {
      console.error("Error fetching review counts:", err);
    }
  }, [userId]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  const markAsReviewed = useCallback(async (cardId: string, updates: Partial<{
    card_name: string;
    card_set: string;
    rarity: string;
    ocr_confidence: number;
  }>) => {
    if (!userId) return false;

    try {
      const { error } = await supabase
        .from("cards")
        .update(updates)
        .eq("id", cardId)
        .eq("user_id", userId);

      if (error) throw error;

      // Remove from local list
      setCards((prev) => prev.filter((c) => c.id !== cardId));
      
      // Refresh counts
      fetchCounts();
      
      return true;
    } catch (err) {
      console.error("Error updating card:", err);
      return false;
    }
  }, [userId, fetchCounts]);

  const dismissCard = useCallback(async (cardId: string) => {
    // Mark as reviewed by setting confidence to 100 (user verified)
    return markAsReviewed(cardId, { ocr_confidence: 100 });
  }, [markAsReviewed]);

  const deleteAllByFilter = useCallback(async (filter?: ReviewReason): Promise<{ deleted: number; success: boolean }> => {
    if (!userId) return { deleted: 0, success: false };

    try {
      // First get the count before deleting
      let countQuery = supabase
        .from("cards")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);

      if (filter === "low_ocr_confidence") {
        countQuery = countQuery.lt("ocr_confidence", OCR_CONFIDENCE_THRESHOLD);
      } else if (filter === "missing_rarity") {
        countQuery = countQuery.or("rarity.is.null,rarity.eq.,rarity.eq.Unknown,rarity.eq.unknown");
      } else if (filter === "missing_name") {
        countQuery = countQuery.or("card_name.is.null,card_name.eq.,card_name.eq.Unknown");
      } else if (filter === "missing_set") {
        countQuery = countQuery.or("card_set.is.null,card_set.eq.,card_set.eq.Unknown");
      } else {
        countQuery = countQuery.or(
          `ocr_confidence.lt.${OCR_CONFIDENCE_THRESHOLD},rarity.is.null,rarity.eq.,rarity.eq.Unknown,card_name.is.null,card_name.eq.,card_name.eq.Unknown,card_set.is.null,card_set.eq.,card_set.eq.Unknown`
        );
      }

      const { count } = await countQuery;
      const deleteCount = count || 0;

      // Now delete
      let deleteQuery = supabase
        .from("cards")
        .delete()
        .eq("user_id", userId);

      if (filter === "low_ocr_confidence") {
        deleteQuery = deleteQuery.lt("ocr_confidence", OCR_CONFIDENCE_THRESHOLD);
      } else if (filter === "missing_rarity") {
        deleteQuery = deleteQuery.or("rarity.is.null,rarity.eq.,rarity.eq.Unknown,rarity.eq.unknown");
      } else if (filter === "missing_name") {
        deleteQuery = deleteQuery.or("card_name.is.null,card_name.eq.,card_name.eq.Unknown");
      } else if (filter === "missing_set") {
        deleteQuery = deleteQuery.or("card_set.is.null,card_set.eq.,card_set.eq.Unknown");
      } else {
        deleteQuery = deleteQuery.or(
          `ocr_confidence.lt.${OCR_CONFIDENCE_THRESHOLD},rarity.is.null,rarity.eq.,rarity.eq.Unknown,card_name.is.null,card_name.eq.,card_name.eq.Unknown,card_set.is.null,card_set.eq.,card_set.eq.Unknown`
        );
      }

      const { error } = await deleteQuery;

      if (error) throw error;

      // Clear local state
      setCards([]);
      
      // Refresh counts
      fetchCounts();
      
      return { deleted: deleteCount, success: true };
    } catch (err) {
      console.error("Error deleting cards:", err);
      return { deleted: 0, success: false };
    }
  }, [userId, fetchCounts]);

  return {
    cards,
    counts,
    loading,
    fetchCards,
    fetchCounts,
    markAsReviewed,
    dismissCard,
    deleteAllByFilter,
  };
}
