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

function makeLocalCard(cardData: Partial<CardInsert> & Record<string, any>): CardRow {
  const createdAt = String(cardData.created_at ?? new Date().toISOString())
  return enforce({
    ...cardData,
    id: String(cardData.id ?? crypto.randomUUID()),
    user_id: cardData.user_id ?? localStorage.getItem("clean_card_local_user_id") ?? "local-user",
    created_at: createdAt,
    updated_at: String(cardData.updated_at ?? createdAt),
  }) as CardRow
}

// ========== LOCAL-ONLY OPERATIONS ==========

export async function getAllCards(): Promise<CardRow[]> {
  const all: CardRow[] = []
  await db.iterate((value) => { all.push(value as CardRow) })
  all.sort((a, b) => new Date((b as any).created_at ?? 0).getTime() - new Date((a as any).created_at ?? 0).getTime())
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

// ========== LOCAL-FIRST OPERATIONS ==========

export async function insertCardDual(cardData: CardInsert): Promise<CardRow> {
  const localCard = makeLocalCard(cardData as any)
  await upsertCardLocal(localCard)
  return localCard
}

export async function updateCardDual(id: string, updates: Partial<CardRow>): Promise<CardRow> {
  const existing = await getCardById(id)
  const localCard = makeLocalCard({ ...(existing as any), ...updates, id, updated_at: new Date().toISOString() })
  await upsertCardLocal(localCard)
  return localCard
}

export async function deleteCardDual(id: string): Promise<void> {
  await deleteCardLocal(id)
}

export async function syncFromSupabase(): Promise<CardRow[]> {
  try {
    const { data, error } = await supabase
      .from("cards")
      .select("*")
      .order("created_at", { ascending: false })

    if (error || !data) return getAllCards()
    await db.clear()
    await upsertCardsLocal(data as CardRow[])
    return data as CardRow[]
  } catch {
    return getAllCards()
  }
}

// Legacy exports for backwards compatibility
export const upsertCard = upsertCardLocal
export const upsertCards = upsertCardsLocal
export const deleteCard = deleteCardLocal
