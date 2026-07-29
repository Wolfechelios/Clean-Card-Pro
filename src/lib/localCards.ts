import localforage from "localforage"
import { supabase } from "@/integrations/supabase/client"
import type { Tables, TablesInsert } from "@/integrations/supabase/types"
import {
  hasCompletedLegacyMigration,
  importInventoryCardsIfAbsent,
  rapidScanDb,
  type InventoryCard,
} from "@/lib/rapidScan/db"

type CardRow = Tables<"cards">
type CardInsert = TablesInsert<"cards">

const LEGACY_CARDS_MIGRATION_KEY = "rapid_scan_v2_cards_migrated"
const legacyCards = localforage.createInstance({ name: "card-scout", storeName: "cards" })

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

function toInventory(card: CardRow, preserve = false): InventoryCard {
  const row = (preserve ? card : enforce(card)) as CardRow & {
    fingerprint?: string
    pricing_status?: InventoryCard["pricing_status"]
  }
  const priced =
    row.current_price_raw != null ||
    row.current_price_psa9 != null ||
    row.current_price_psa10 != null
  return {
    ...row,
    id: row.id,
    fingerprint: row.fingerprint ?? `legacy:${row.id}`,
    quantity: row.quantity ?? 1,
    card_name: row.card_name,
    card_set: row.card_set,
    card_number: row.card_number,
    game_type: row.game_type,
    rarity: row.rarity,
    image_url: row.image_url || null,
    pricing_status: row.pricing_status ?? (priced ? "priced" : "pending"),
    current_price_raw: row.current_price_raw,
    current_price_psa9: row.current_price_psa9,
    current_price_psa10: row.current_price_psa10,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function fromInventory(card: InventoryCard): CardRow {
  const stored = card as InventoryCard & { collection_name?: string | null }
  return {
    ...card,
    collection_name: "collection_name" in stored
      ? stored.collection_name
      : card.card_set ?? "",
    image_url: card.image_url ?? "",
    quantity: card.quantity,
  } as unknown as CardRow
}

let migrationPromise: Promise<void> | null = null
function ensureMigration(): Promise<void> {
  if (migrationPromise) return migrationPromise
  migrationPromise = (async () => {
    if (typeof localStorage === "undefined" || typeof indexedDB === "undefined") return
    const marked = localStorage.getItem(LEGACY_CARDS_MIGRATION_KEY) === "1"
    if (marked && await hasCompletedLegacyMigration("legacy_cards")) return
    const imports: Array<{ sourceId: string; card: InventoryCard }> = []
    await legacyCards.iterate<CardRow, void>((card, key) => {
      imports.push({ sourceId: key, card: toInventory(card, true) })
    })
    await importInventoryCardsIfAbsent(imports, { importMissing: !marked })
    localStorage.setItem(LEGACY_CARDS_MIGRATION_KEY, "1")
  })()
  return migrationPromise
}

// ========== LOCAL-ONLY OPERATIONS ==========

export async function getAllCards(): Promise<CardRow[]> {
  await ensureMigration()
  return (await rapidScanDb.inventoryCards.toArray())
    .map(fromInventory)
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
}

export async function getCardById(id: string): Promise<CardRow | null> {
  await ensureMigration()
  const card = await rapidScanDb.inventoryCards.get(id)
  return card ? fromInventory(card) : null
}

export async function upsertCardLocal(card: CardRow): Promise<CardRow> {
  await ensureMigration()
  const safe = enforce(card) as CardRow
  await rapidScanDb.inventoryCards.put(toInventory(safe))
  return safe
}

export async function upsertCardsLocal(cards: CardRow[]): Promise<CardRow[]> {
  await ensureMigration()
  const safeList = (cards || []).map((card) => enforce(card) as CardRow)
  await rapidScanDb.inventoryCards.bulkPut(safeList.map((card) => toInventory(card)))
  return safeList
}

export async function deleteCardLocal(id: string): Promise<void> {
  await ensureMigration()
  await rapidScanDb.inventoryCards.delete(id)
}

export async function clearAllLocalCards(): Promise<void> {
  await ensureMigration()
  await rapidScanDb.inventoryCards.clear()
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

export async function syncFromSupabase(options: { replace?: boolean } = {}): Promise<CardRow[]> {
  await ensureMigration()
  const PAGE = 1000
  const all: CardRow[] = []
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("cards")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      all.push(...(data as CardRow[]))
      if (data.length < PAGE) break
    }
    if (options.replace) await rapidScanDb.inventoryCards.clear()
    if (all.length) await upsertCardsLocal(all)
    return all.length ? all : getAllCards()
  } catch (e) {
    console.warn("syncFromSupabase failed", e)
    return getAllCards()
  }
}

// Legacy exports for backwards compatibility
export const upsertCard = upsertCardLocal
export const upsertCards = upsertCardsLocal
export const deleteCard = deleteCardLocal
