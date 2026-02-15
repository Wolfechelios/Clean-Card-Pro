/**
 * Offline Manager - Comprehensive offline capabilities for PWA
 * Handles sync, caching, network state, and background operations
 */

import localforage from "localforage";
import { supabase } from "@/integrations/supabase/client";

// Separate stores for different data types
const cardsStore = localforage.createInstance({ name: "cleancards", storeName: "cards" });
const imagesStore = localforage.createInstance({ name: "cleancards", storeName: "images" });
const pendingSyncStore = localforage.createInstance({ name: "cleancards", storeName: "pending_sync" });
const metaStore = localforage.createInstance({ name: "cleancards", storeName: "meta" });

export type SyncStatus = "synced" | "pending" | "error";

export interface PendingSyncItem {
  id: string;
  action: "insert" | "update" | "delete";
  table: string;
  data: any;
  createdAt: number;
  retryCount: number;
  lastError?: string;
}

export interface OfflineStats {
  cardsCount: number;
  imagesCount: number;
  pendingSyncCount: number;
  lastSyncAt: number | null;
  storageUsed: string;
  isOnline: boolean;
}

// Network state management
let isOnline = navigator.onLine;
const onlineListeners = new Set<(online: boolean) => void>();

export function getNetworkStatus(): boolean {
  return isOnline;
}

export function onNetworkChange(callback: (online: boolean) => void): () => void {
  onlineListeners.add(callback);
  return () => onlineListeners.delete(callback);
}

// Initialize network listeners
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    isOnline = true;
    onlineListeners.forEach((cb) => cb(true));
    // Auto-sync when coming back online
    processPendingSync().catch(console.error);
  });

  window.addEventListener("offline", () => {
    isOnline = false;
    onlineListeners.forEach((cb) => cb(false));
  });
}

// ============= Card Storage =============

export async function cacheCard(card: any): Promise<void> {
  await cardsStore.setItem(card.id, {
    ...card,
    _cachedAt: Date.now(),
  });
}

export async function cacheCards(cards: any[]): Promise<void> {
  const timestamp = Date.now();
  await Promise.all(
    cards.map((card) =>
      cardsStore.setItem(card.id, { ...card, _cachedAt: timestamp })
    )
  );
}

export async function getCachedCard(id: string): Promise<any | null> {
  return cardsStore.getItem(id);
}

export async function getAllCachedCards(): Promise<any[]> {
  const cards: any[] = [];
  await cardsStore.iterate((value) => {
    cards.push(value);
  });
  return cards.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function removeCachedCard(id: string): Promise<void> {
  await cardsStore.removeItem(id);
}

// ============= Image Caching =============

export async function cacheImage(url: string, blob: Blob): Promise<void> {
  // Compress if too large (> 500KB)
  const finalBlob = blob.size > 500_000 ? await compressImage(blob) : blob;
  await imagesStore.setItem(url, {
    blob: finalBlob,
    cachedAt: Date.now(),
    size: finalBlob.size,
  });
}

export async function getCachedImage(url: string): Promise<Blob | null> {
  const cached = await imagesStore.getItem<{ blob: Blob }>(url);
  return cached?.blob ?? null;
}

export async function getCachedImageUrl(url: string): Promise<string | null> {
  const blob = await getCachedImage(url);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

async function compressImage(blob: Blob, quality = 0.7): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    img.onload = () => {
      // Max dimensions for cached images
      const maxDim = 800;
      let { width, height } = img;

      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width *= ratio;
        height *= ratio;
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (result) => resolve(result || blob),
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => resolve(blob);
    img.src = URL.createObjectURL(blob);
  });
}

// ============= Pending Sync Queue =============

export async function addPendingSync(item: Omit<PendingSyncItem, "id" | "createdAt" | "retryCount">): Promise<void> {
  const syncItem: PendingSyncItem = {
    ...item,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    retryCount: 0,
  };
  await pendingSyncStore.setItem(syncItem.id, syncItem);
}

export async function getPendingSyncItems(): Promise<PendingSyncItem[]> {
  const items: PendingSyncItem[] = [];
  await pendingSyncStore.iterate((value) => {
    items.push(value as PendingSyncItem);
  });
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function removePendingSync(id: string): Promise<void> {
  await pendingSyncStore.removeItem(id);
}

export async function updatePendingSync(id: string, updates: Partial<PendingSyncItem>): Promise<void> {
  const item = await pendingSyncStore.getItem<PendingSyncItem>(id);
  if (item) {
    await pendingSyncStore.setItem(id, { ...item, ...updates });
  }
}

// ============= Sync Processing =============

let isSyncing = false;

export async function processPendingSync(): Promise<{ success: number; failed: number }> {
  if (!isOnline || isSyncing) return { success: 0, failed: 0 };

  isSyncing = true;
  let success = 0;
  let failed = 0;

  try {
    const items = await getPendingSyncItems();

    for (const item of items) {
      try {
        switch (item.action) {
          case "insert":
            await supabase.from(item.table as "cards").insert(item.data);
            break;
          case "update":
            await supabase.from(item.table as "cards").update(item.data).eq("id", item.data.id);
            break;
          case "delete":
            await supabase.from(item.table as "cards").delete().eq("id", item.data.id);
            break;
        }

        await removePendingSync(item.id);
        success++;
      } catch (error: any) {
        failed++;
        await updatePendingSync(item.id, {
          retryCount: item.retryCount + 1,
          lastError: error.message,
        });

        // Remove after 5 failed attempts
        if (item.retryCount >= 5) {
          await removePendingSync(item.id);
        }
      }
    }

    // Update last sync time
    await metaStore.setItem("lastSyncAt", Date.now());
  } finally {
    isSyncing = false;
  }

  return { success, failed };
}

// ============= Full Sync from Server =============

export async function syncFromServer(userId: string): Promise<number> {
  if (!isOnline) throw new Error("Cannot sync while offline");

  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  // Clear and repopulate cache
  await cardsStore.clear();
  if (data) {
    await cacheCards(data);
  }

  await metaStore.setItem("lastSyncAt", Date.now());
  return data?.length ?? 0;
}

// ============= Storage Stats =============

export async function getOfflineStats(): Promise<OfflineStats> {
  let cardsCount = 0;
  let imagesCount = 0;
  let pendingSyncCount = 0;
  let totalSize = 0;

  await cardsStore.iterate(() => {
    cardsCount++;
  });

  await imagesStore.iterate((value: any) => {
    imagesCount++;
    totalSize += value?.size ?? 0;
  });

  await pendingSyncStore.iterate(() => {
    pendingSyncCount++;
  });

  const lastSyncAt = await metaStore.getItem<number>("lastSyncAt");

  // Estimate card data size (~2KB per card)
  totalSize += cardsCount * 2000;

  return {
    cardsCount,
    imagesCount,
    pendingSyncCount,
    lastSyncAt,
    storageUsed: formatBytes(totalSize),
    isOnline,
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ============= Cache Cleanup =============

export async function cleanupOldCache(maxAgeDays = 30): Promise<number> {
  const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - maxAge;
  let removed = 0;

  // Clean old images
  const keysToRemove: string[] = [];
  await imagesStore.iterate((value: any, key) => {
    if (value?.cachedAt && value.cachedAt < cutoff) {
      keysToRemove.push(key);
    }
  });

  for (const key of keysToRemove) {
    await imagesStore.removeItem(key);
    removed++;
  }

  return removed;
}

export async function clearAllCache(): Promise<void> {
  await Promise.all([
    cardsStore.clear(),
    imagesStore.clear(),
    pendingSyncStore.clear(),
  ]);
  await metaStore.setItem("lastSyncAt", null);
}

// ============= Preload Images =============

export async function preloadCardImages(cards: any[], concurrency = 3): Promise<void> {
  const queue = cards.filter((c) => c.image_url).map((c) => ({
    id: c.id,
    url: c.image_url,
  }));

  const fetchWithCache = async (item: { id: string; url: string }) => {
    // Check by card ID first (preferred key), then by URL
    const cachedById = await getCachedImage(`card:${item.id}`);
    if (cachedById) return;
    const cachedByUrl = await getCachedImage(item.url);
    if (cachedByUrl) return;

    try {
      const response = await fetch(item.url);
      if (response.ok) {
        const blob = await response.blob();
        // Store by card ID for stable lookups even if URL changes
        await cacheImage(`card:${item.id}`, blob);
      }
    } catch (error) {
      console.warn("Failed to cache image:", item.url);
    }
  };

  // Process in batches
  for (let i = 0; i < queue.length; i += concurrency) {
    const batch = queue.slice(i, i + concurrency);
    await Promise.all(batch.map(fetchWithCache));
  }
}

// ============= Save All Images to Device =============

export async function saveAllImagesToDevice(
  userId: string,
  onProgress?: (done: number, total: number) => void,
  concurrency = 3
): Promise<{ saved: number; failed: number }> {
  const cards = await getAllCachedCards();
  const withImages = cards.filter((c) => c.image_url && !c.image_url.includes("placehold"));
  let saved = 0;
  let failed = 0;

  for (let i = 0; i < withImages.length; i += concurrency) {
    const batch = withImages.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (card) => {
        const key = `card:${card.id}`;
        const existing = await getCachedImage(key);
        if (existing) {
          saved++;
          onProgress?.(saved + failed, withImages.length);
          return;
        }
        try {
          const response = await fetch(card.image_url);
          if (response.ok) {
            const blob = await response.blob();
            await cacheImage(key, blob);
            saved++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
        onProgress?.(saved + failed, withImages.length);
      })
    );
  }

  return { saved, failed };
}

export async function getLocalImageUrl(cardId: string, remoteUrl?: string): Promise<string | null> {
  // Try card ID-based cache first
  const byId = await getCachedImageUrl(`card:${cardId}`);
  if (byId) return byId;

  // Fall back to URL-based cache
  if (remoteUrl) {
    const byUrl = await getCachedImageUrl(remoteUrl);
    if (byUrl) return byUrl;
  }

  return null;
}
