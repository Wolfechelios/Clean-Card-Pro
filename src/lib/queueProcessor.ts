// src/lib/queueProcessor.ts
// Global Rapid Scan queue processor.
//
// Goals:
// - Process ONE queued image at a time (stable on mobile).
// - Pull blobs from IndexedDB one-by-one (no "load 20 blobs and die").
// - Expose a small zustand hook so UI can observe status.
//
// NOTE: This processor is intentionally conservative. Reliability > speed.

import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";
import { identifyCardOnDevice } from "@/lib/onDeviceLLM";
import { loadLocalFlags, DEFAULT_FLAGS } from "@/lib/featureFlags";
import {
  idbCount,
  idbGetAllMeta,
  idbTakeNextQueued,
  idbUpdateMeta,
  idbDelete,
  type QueueItemMeta,
} from "@/lib/idbQueue";

type ProcessedEvent = {
  id: string;
  cardName: string;
  cardSet?: string | null;
  cardNumber?: string | null;
  rarity?: string | null;
  value?: number | null;
  imageUrl?: string | null;
  isInLibrary?: boolean;
  libraryQuantity?: number;
  dbId?: string;
};

type QueueState = {
  isRunning: boolean;
  queueCount: number;
  processedCount: number;
  errorCount: number;
  currentItem: string | null;
  processedEvents: number; // increment-only signal for useEffect
  _events: ProcessedEvent[];
  start: () => void;
  stop: () => void;
  refresh: () => Promise<void>;
  _consumeProcessedEvents: () => ProcessedEvent[];
};

const useQueueStore = create<QueueState>((set, get) => ({
  isRunning: false,
  queueCount: 0,
  processedCount: 0,
  errorCount: 0,
  currentItem: null,
  processedEvents: 0,
  _events: [],

  start: () => {
    if (get().isRunning) return;
    set({ isRunning: true });
    void pump();
  },
  stop: () => set({ isRunning: false, currentItem: null }),
  refresh: async () => {
    const count = await idbCount();
    set({ queueCount: count });
  },
  _consumeProcessedEvents: () => {
    const events = get()._events;
    if (events.length === 0) return [];
    set({ _events: [] });
    return events;
  },
}));

// Simple single-threaded pump loop.
async function pump() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const state = useQueueStore.getState();
    if (!state.isRunning) return;

    // Update count occasionally.
    try {
      const count = await idbCount();
      useQueueStore.setState({ queueCount: count });
    } catch {
      // ignore
    }

    const item = await idbTakeNextQueued();
    if (!item) {
      // Nothing queued; nap a bit.
      await sleep(450);
      continue;
    }

    useQueueStore.setState({ currentItem: item.id });

    try {
      const out = await processItem(item.id, item.blob);
      await idbUpdateMeta(item.id, { status: "done" });

      // Keep queue from growing forever.
      // We can delete done items because UI keeps its own list + preview URLs.
      await idbDelete(item.id);

      useQueueStore.setState((s) => ({
        processedCount: s.processedCount + 1,
        currentItem: null,
        processedEvents: s.processedEvents + 1,
        _events: [out, ...s._events].slice(0, 50),
      }));
    } catch (err: any) {
      console.error("Queue processing failed", err);
      await idbUpdateMeta(item.id, { status: "error", error: err?.message ?? "Unknown error" });
      useQueueStore.setState((s) => ({
        errorCount: s.errorCount + 1,
        currentItem: null,
      }));

      // Backoff after failure
      await sleep(800);
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function uploadToStorage(id: string, blob: Blob): Promise<string> {
  const filename = `rapid/${id}.jpg`;
  const { data, error } = await supabase.storage
    .from("card-images")
    .upload(filename, blob, { upsert: true, contentType: blob.type || "image/jpeg" });
  if (error) throw error;
  const path = data?.path ?? filename;
  const { data: pub } = supabase.storage.from("card-images").getPublicUrl(path);
  return pub.publicUrl;
}

async function checkLibrary(userId: string, cardName: string, cardSet?: string | null) {
  const q = supabase
    .from("cards")
    .select("id, quantity")
    .eq("user_id", userId)
    .ilike("card_name", cardName);
  if (cardSet) q.ilike("card_set", cardSet);
  const { data, error } = await q.limit(1);
  if (error) throw error;
  const row = data?.[0];
  return {
    isInLibrary: !!row,
    libraryQuantity: row?.quantity ?? 0,
    dbId: row?.id as string | undefined,
  };
}

async function processItem(id: string, blob: Blob): Promise<ProcessedEvent> {
  // Must have user to check duplicates and to allow DB save later.
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;

  const flags = { ...DEFAULT_FLAGS, ...loadLocalFlags() };

  // 1) Upload image and get URL (still required for storage/history)
  const imageUrl = await uploadToStorage(id, blob);

  // 2) Identify card
  let cardName = "Unknown Card";
  let cardSet: string | null = null;
  let cardNumber: string | null = null;
  let rarity: string | null = null;
  let cardData: any = null;

  if (flags.onDeviceLLM) {
    try {
      const local = await identifyCardOnDevice(blob);
      if (local?.name) {
        cardName = String(local.name);
        cardSet = local.set ?? null;
        cardNumber = local.number ?? null;
      }
    } catch {
      // fall through
    }
  }

  if (!cardName || cardName === "Unknown Card") {
    const { data: identify, error: idErr } = await supabase.functions.invoke("rapid-card-identify", {
      body: { imageUrl },
    });
    if (idErr) throw new Error(idErr.message);

    cardData = identify?.cardData?.primary || identify?.cardData || identify;
    cardName = (cardData?.card_name || "Unknown Card").toString();
    cardSet = (cardData?.card_set ?? null) as string | null;
    cardNumber = (cardData?.card_number ?? null) as string | null;
    rarity = (cardData?.rarity ?? null) as string | null;
  }

  // 3) Pricing
  let value: number | null = null;
  try {
    const { data: prices, error: pErr } = await supabase.functions.invoke("fetch-card-prices", {
      body: { cardName, cardSet, cardNumber, gameType: cardData?.game_type ?? null, sportType: cardData?.sport_type ?? null },
    });
    if (pErr) throw pErr;
    value = (prices?.suggested ?? prices?.raw ?? null) as number | null;
  } catch {
    value = null;
  }

  // 4) Library check (best-effort)
  let isInLibrary = false;
  let libraryQuantity = 0;
  let dbId: string | undefined;
  if (userId) {
    try {
      const dup = await checkLibrary(userId, cardName, cardSet);
      isInLibrary = dup.isInLibrary;
      libraryQuantity = dup.libraryQuantity;
      dbId = dup.dbId;
    } catch {
      // ignore
    }
  }

  return {
    id,
    cardName,
    cardSet,
    cardNumber,
    rarity,
    value,
    imageUrl,
    isInLibrary,
    libraryQuantity,
    dbId,
  };
}

// Public API
export function useQueueProcessor() {
  return useQueueStore();
}

export async function checkAndResumeQueue() {
  // If there are queued items, start processing.
  try {
    const meta = await idbGetAllMeta();
    const pending = meta.some((m) => m.status === "queued" || m.status === "processing");
    if (pending) {
      useQueueStore.getState().start();
    }
  } catch {
    // ignore
  }
}
