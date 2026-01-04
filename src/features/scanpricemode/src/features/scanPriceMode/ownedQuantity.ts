// NEW FILE — pure helper

export function buildOwnedQuantityMap(cards: Array<{ printing_key?: string }>) {
  const map = new Map<string, number>()

  for (const card of cards) {
    if (!card.printing_key) continue
    map.set(card.printing_key, (map.get(card.printing_key) || 0) + 1)
  }

  return map
}

export function getOwnedQuantity(
  printingKey: string,
  quantityMap: Map<string, number>
): number {
  return quantityMap.get(printingKey) || 0
}
