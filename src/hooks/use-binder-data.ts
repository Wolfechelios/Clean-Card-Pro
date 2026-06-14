import { useState, useEffect, useMemo } from "react";
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

const COLLECTION_PREFIX = "collection:";
const normalize = (value?: string | null) => (value || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

export function useBinderData(selectedSetId: string | null) {
  const { session } = useAuth();
  const [sets, setSets] = useState<BinderSet[]>([]);
  const [masterCards, setMasterCards] = useState<MasterCard[]>([]);
  const [allCards, setAllCards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      setSets([]);
      setAllCards([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    Promise.all([
      supabase.from("pc_sets").select("id, set_name, game, total_cards").eq("user_id", userId),
      supabase.from("cards").select("id, card_name, card_number, card_set, collection_name, finish, edition, rarity, game_type, sport_type, image_url, thumbnail_url, current_price_raw, psa10_price, quantity").eq("user_id", userId),
    ]).then(([setResult, cardResult]) => {
      if (!active) return;
      const cards = cardResult.data || [];
      const merged = new Map<string, BinderSet>();

      for (const set of (setResult.data || []) as BinderSet[]) {
        const key = normalize(set.set_name);
        if (key) merged.set(key, set);
      }

      for (const card of cards) {
        const name = String(card.card_set || card.collection_name || "").trim();
        const key = normalize(name);
        if (!key || merged.has(key)) continue;
        merged.set(key, {
          id: `${COLLECTION_PREFIX}${encodeURIComponent(name)}`,
          set_name: name,
          game: card.game_type || card.sport_type || "Collection",
          total_cards: null,
        });
      }

      setSets([...merged.values()].sort((a, b) => a.set_name.localeCompare(b.set_name)));
      setAllCards(cards);
      setLoading(false);
    }).catch((error) => {
      console.error("Binder data load failed", error);
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [session?.user?.id]);

  const selectedSet = useMemo(
    () => sets.find((set) => set.id === selectedSetId) || null,
    [sets, selectedSetId],
  );

  useEffect(() => {
    const userId = session?.user?.id;
    if (!selectedSetId || !userId || selectedSetId.startsWith(COLLECTION_PREFIX)) {
      setMasterCards([]);
      return;
    }

    let active = true;
    setLoading(true);
    supabase
      .from("pc_cards")
      .select("id, card_name, card_number, variant, rarity, ungraded_price, psa10_price")
      .eq("set_id", selectedSetId)
      .eq("user_id", userId)
      .order("card_number")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) console.error("Binder checklist load failed", error);
        setMasterCards((data || []) as MasterCard[]);
        setLoading(false);
      });

    return () => { active = false; };
  }, [selectedSetId, session?.user?.id]);

  const userCards = useMemo(() => {
    if (!selectedSet) return [];
    const setName = normalize(selectedSet.set_name);
    return allCards.filter((card) =>
      normalize(card.card_set) === setName || normalize(card.collection_name) === setName,
    );
  }, [allCards, selectedSet]);

  const slots = useMemo<BinderSlot[]>(() => {
    if (!selectedSetId) return [];

    if (!masterCards.length) {
      return userCards.map((card, index) => ({
        setId: selectedSetId,
        cardNumber: card.card_number || "",
        cardName: card.card_name || "Unknown Card",
        variant: card.finish || card.edition || "normal",
        rarity: card.rarity || null,
        imageUrl: card.image_url || null,
        thumbnailUrl: card.thumbnail_url || null,
        owned: true,
        quantity: Number(card.quantity || 1),
        rawPrice: card.current_price_raw ?? null,
        psa10Price: card.psa10_price ?? null,
        userCardId: card.id || `owned-${index}`,
      })).sort((a, b) =>
        a.cardNumber.localeCompare(b.cardNumber, undefined, { numeric: true }) || a.cardName.localeCompare(b.cardName),
      );
    }

    const byNumber = new Map<string, any>();
    const byName = new Map<string, any>();
    for (const card of userCards) {
      if (normalize(card.card_number)) byNumber.set(normalize(card.card_number), card);
      if (normalize(card.card_name)) byName.set(normalize(card.card_name), card);
    }

    return masterCards.map((card) => {
      const match = byNumber.get(normalize(card.card_number)) || byName.get(normalize(card.card_name));
      return {
        setId: selectedSetId,
        cardNumber: card.card_number || "",
        cardName: card.card_name,
        variant: card.variant || "normal",
        rarity: card.rarity,
        imageUrl: match?.image_url || null,
        thumbnailUrl: match?.thumbnail_url || null,
        owned: Boolean(match),
        quantity: Number(match?.quantity || 0),
        rawPrice: match?.current_price_raw ?? card.ungraded_price,
        psa10Price: match?.psa10_price ?? card.psa10_price,
        userCardId: match?.id || null,
      };
    });
  }, [selectedSetId, masterCards, userCards]);

  const stats = useMemo(() => {
    const total = slots.length;
    const owned = slots.filter((slot) => slot.owned).length;
    const totalValue = slots.reduce((sum, slot) => sum + (slot.owned ? (slot.rawPrice || 0) * Math.max(slot.quantity, 1) : 0), 0);
    return { total, owned, completion: total ? Math.round((owned / total) * 100) : 0, totalValue };
  }, [slots]);

  return { sets, slots, loading, stats };
}
