import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export interface MasterCard {
  id: string;
  card_name: string;
  card_number: string | null;
  variant: string | null;
  rarity: string | null;
  ungraded_price: number | null;
  psa10_price: number | null;
}

export interface BinderSlot {
  setId: string;
  cardNumber: string;
  cardName: string;
  variant: string;
  rarity: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  owned: boolean;
  quantity: number;
  rawPrice: number | null;
  psa10Price: number | null;
  userCardId: string | null;
}

export interface BinderSet {
  id: string;
  set_name: string;
  game: string;
  total_cards: number | null;
}

export function useBinderData(selectedSetId: string | null) {
  const { session } = useAuth();
  const [sets, setSets] = useState<BinderSet[]>([]);
  const [masterCards, setMasterCards] = useState<MasterCard[]>([]);
  const [userCards, setUserCards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Load all sets
  useEffect(() => {
    if (!session?.user?.id) return;
    (async () => {
      const { data } = await supabase
        .from("pc_sets")
        .select("id, set_name, game, total_cards")
        .eq("user_id", session.user.id)
        .order("set_name");
      setSets(data || []);
    })();
  }, [session?.user?.id]);

  // Load master cards for selected set
  useEffect(() => {
    if (!selectedSetId || !session?.user?.id) {
      setMasterCards([]);
      return;
    }
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("pc_cards")
        .select("id, card_name, card_number, variant, rarity, ungraded_price, psa10_price")
        .eq("set_id", selectedSetId)
        .eq("user_id", session.user.id)
        .order("card_number");
      setMasterCards(data || []);
      setLoading(false);
    })();
  }, [selectedSetId, session?.user?.id]);

  // Load user's collection cards matching the selected set
  useEffect(() => {
    if (!selectedSetId || !session?.user?.id || sets.length === 0) {
      setUserCards([]);
      return;
    }
    const selectedSet = sets.find((s) => s.id === selectedSetId);
    if (!selectedSet) return;

    (async () => {
      const { data } = await supabase
        .from("cards")
        .select("id, card_name, card_number, card_set, finish, edition, image_url, thumbnail_url, current_price_raw, psa10_price, quantity")
        .eq("user_id", session.user.id)
        .or(`card_set.ilike.%${selectedSet.set_name}%,collection_name.ilike.%${selectedSet.set_name}%`);
      setUserCards(data || []);
    })();
  }, [selectedSetId, session?.user?.id, sets]);

  // Build matching key
  const makeKey = useCallback((cardNumber: string, variant: string, edition?: string) => {
    return `${(cardNumber || "").trim().toLowerCase()}|${(variant || "normal").trim().toLowerCase()}|${(edition || "").trim().toLowerCase()}`;
  }, []);

  // Build binder slots
  const slots = useMemo<BinderSlot[]>(() => {
    if (!masterCards.length) return [];

    // Index user cards by key
    const userIndex = new Map<string, { card: any; quantity: number }>();
    for (const uc of userCards) {
      const finish = uc.finish || "normal";
      const edition = uc.edition || "";
      const key = makeKey(uc.card_number || "", finish, edition);
      const existing = userIndex.get(key);
      if (existing) {
        existing.quantity += uc.quantity || 1;
      } else {
        userIndex.set(key, { card: uc, quantity: uc.quantity || 1 });
      }
    }

    return masterCards.map((mc) => {
      const variant = mc.variant || "normal";
      const key = makeKey(mc.card_number || "", variant, "");
      const match = userIndex.get(key);
      // Also try without edition
      const keyNoEdition = makeKey(mc.card_number || "", variant);
      const matchAlt = match || userIndex.get(keyNoEdition);
      // Fallback: try just card number
      const keySimple = makeKey(mc.card_number || "", "normal");
      const finalMatch = matchAlt || userIndex.get(keySimple);

      return {
        setId: selectedSetId!,
        cardNumber: mc.card_number || "",
        cardName: mc.card_name,
        variant,
        rarity: mc.rarity,
        imageUrl: finalMatch?.card?.image_url || null,
        thumbnailUrl: finalMatch?.card?.thumbnail_url || null,
        owned: !!finalMatch,
        quantity: finalMatch?.quantity || 0,
        rawPrice: finalMatch?.card?.current_price_raw ?? mc.ungraded_price,
        psa10Price: finalMatch?.card?.psa10_price ?? mc.psa10_price,
        userCardId: finalMatch?.card?.id || null,
      };
    });
  }, [masterCards, userCards, selectedSetId, makeKey]);

  // Compute stats
  const stats = useMemo(() => {
    const total = slots.length;
    const owned = slots.filter((s) => s.owned).length;
    const totalValue = slots.reduce((sum, s) => sum + (s.owned ? (s.rawPrice || 0) : 0), 0);
    return { total, owned, completion: total > 0 ? Math.round((owned / total) * 100) : 0, totalValue };
  }, [slots]);

  return { sets, slots, loading, stats };
}
