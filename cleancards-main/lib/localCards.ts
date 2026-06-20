import localforage from "localforage"
import { supabase } from "@/integrations/supabase/client"
import type { Tables, TablesInsert } from "@/integrations/supabase/types"

type CardRow = Tables<"cards">
type CardInsert = TablesInsert<"cards">

const db = localforage.createInstance({ name: "card-scout", storeName: "cards" })

function enforce(card: any): any {
  const set = String(card?.card_set ?? "").trim()
  const col = String(card?.collection_name ?? "").trim()
  const v = (set || col || "").trim()
  return { ...card, card_set: v, collection_name: v }
}

// ========== LOCAL-ONLY OPERATIONS ==========

export async function getAllCards(): Promise<CardRow[]> {
  const all: CardRow[] = []
  await db.iterate((value) => { all.push(value as CardRow) })
  all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  return all
}

export async function getCardById(id: string): Promise<CardRow | null> {
  return (await db.getItem(id)) as CardRow | null
}

export async function upsertCardLocal(card: CardRow): Promise<CardRow> {
  const safe = enforce(card)
  await db.setItem(safe.id, safe)
  return safe
}

export async function upsertCardsLocal(cards: CardRow[]): Promise<CardRow[]> {
  const safeList = (cards || []).map(enforce)
  await Promise.all(safeList.map((c) => db.setItem(c.id, c)))
  return safeList
}

export async function deleteCardLocal(id: string): Promise<void> {
  await db.removeItem(id)
}

export async function clearAllLocalCards(): Promise<void> {
  await db.clear()
}

// ========== DUAL-WRITE: SUPABASE + LOCAL ==========

/**
 * Insert a card into Supabase and mirror it to IndexedDB.
 * Returns the inserted card with its generated ID.
 */
export async function insertCardDual(cardData: CardInsert): Promise<CardRow> {
  const { data, error } = await supabase
    .from("cards")
    .insert(cardData)
    .select()
    .single()

  if (error) throw error
  if (!data) throw new Error("No data returned from insert")

  // Mirror to local
  await upsertCardLocal(data)
  return data
}

/**
 * Update a card in Supabase and mirror changes to IndexedDB.
 */
export async function updateCardDual(id: string, updates: Partial<CardRow>): Promise<CardRow> {
  const { data, error } = await supabase
    .from("cards")
    .update(updates)
    .eq("id", id)
    .select()
    .single()

  if (error) throw error
  if (!data) throw new Error("No data returned from update")

  await upsertCardLocal(data)
  return data
}

/**
 * Delete a card from Supabase and remove from IndexedDB.
 */
export async function deleteCardDual(id: string): Promise<void> {
  const { error } = await supabase.from("cards").delete().eq("id", id)
  if (error) throw error
  await deleteCardLocal(id)
}

/**
 * Sync all cards from Supabase to local IndexedDB.
 * Call this on app init or after login.
 */
export async function syncFromSupabase(): Promise<CardRow[]> {
  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) throw error
  if (!data) return []

  // Replace local store with fresh data
  await db.clear()
  await upsertCardsLocal(data)
  return data
}

// Legacy exports for backwards compatibility
export const upsertCard = upsertCardLocal
export const upsertCards = upsertCardsLocal
export const deleteCard = deleteCardLocal
