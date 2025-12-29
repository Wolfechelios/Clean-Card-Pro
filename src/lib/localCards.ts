import localforage from "localforage"

const db = localforage.createInstance({ name: "card-scout", storeName: "cards" })

function enforce(card: any) {
  const set = String(card?.card_set ?? "").trim()
  const col = String(card?.collection_name ?? "").trim()
  const v = (set || col || "").trim()
  return { ...card, card_set: v, collection_name: v }
}

export async function getAllCards() {
  const all: any[] = []
  await db.iterate((value) => { all.push(value) })
  // newest first if you want
  all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  return all
}

export async function upsertCard(card: any) {
  const safe = enforce(card)
  await db.setItem(safe.id, safe)
  return safe
}

export async function upsertCards(cards: any[]) {
  const safeList = (cards || []).map(enforce)
  await Promise.all(safeList.map((c) => db.setItem(c.id, c)))
  return safeList
}

export async function deleteCard(id: string) {
  await db.removeItem(id)
}
