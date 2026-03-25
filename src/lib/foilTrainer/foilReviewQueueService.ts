// Foil Trainer — Review Queue Service
// Manages a local queue of foil scans needing user review
// Used in rapid scan mode to avoid blocking capture flow

const QUEUE_KEY = "foil-review-queue";

export interface FoilReviewItem {
  id: string;
  addedAt: string;
  scanId: string;
  cardName: string;
  cardSet: string | null;
  rarity: string | null;
  finish: string | null;
  foilConfidence: number;
  imageUrl: string;
  gameType: string | null;
  cardNumber: string | null;
  dbCardId?: string;
  reviewed: boolean;
}

/** Get all items in the foil review queue */
export function getFoilReviewQueue(): FoilReviewItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Add an item to the foil review queue */
export function addToFoilReviewQueue(item: Omit<FoilReviewItem, "id" | "addedAt" | "reviewed">): void {
  const queue = getFoilReviewQueue();
  queue.push({
    ...item,
    id: crypto.randomUUID(),
    addedAt: new Date().toISOString(),
    reviewed: false,
  });
  // Keep max 200 items
  const trimmed = queue.slice(-200);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed));
  window.dispatchEvent(new CustomEvent("foil-review-queue-updated"));
}

/** Mark an item as reviewed */
export function markFoilReviewDone(id: string): void {
  const queue = getFoilReviewQueue();
  const updated = queue.map((item) =>
    item.id === id ? { ...item, reviewed: true } : item,
  );
  localStorage.setItem(QUEUE_KEY, JSON.stringify(updated));
  window.dispatchEvent(new CustomEvent("foil-review-queue-updated"));
}

/** Remove an item from the queue */
export function removeFoilReviewItem(id: string): void {
  const queue = getFoilReviewQueue().filter((item) => item.id !== id);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  window.dispatchEvent(new CustomEvent("foil-review-queue-updated"));
}

/** Get count of unreviewed items */
export function getUnreviewedFoilCount(): number {
  return getFoilReviewQueue().filter((item) => !item.reviewed).length;
}

/** Clear all reviewed items */
export function clearReviewedFoilItems(): void {
  const queue = getFoilReviewQueue().filter((item) => !item.reviewed);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  window.dispatchEvent(new CustomEvent("foil-review-queue-updated"));
}
