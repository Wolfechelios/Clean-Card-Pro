type AnyCard = Record<string, any>

export function enforceSetCollection<T extends AnyCard>(card: T): T {
  const set = String(card?.card_set ?? '').trim()
  const col = String(card?.collection_name ?? '').trim()
  const v = (set || col || '').trim()
  return { ...card, card_set: v, collection_name: v } as T
}

export function enforceSetCollectionMany<T extends AnyCard>(cards: T[]): T[] {
  return (cards || []).map(enforceSetCollection)
}
