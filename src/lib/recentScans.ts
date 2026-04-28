// Recent scans tracking - 2 hour window with $20+ value highlighting

import { playJackpotBeep } from "@/lib/audioBeeps";

const STORAGE_KEY = "recent_scans";
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const VALUE_THRESHOLD = 15; // USD
const JACKPOT_THRESHOLD = 50; // USD - plays special sound

export function playJackpotSound(): void {
  playJackpotBeep();
}

export interface RecentScan {
  id: string;
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  player_name: string | null;
  image_url: string;
  price: number | null;
  psa10Price?: number | null;
  confidence: number | null;
  scanned_at: number;
  isHighValue: boolean;
  rarity?: string | null;
  gameType?: string | null;
  sportType?: string | null;
  dbId?: string | null;
  isInLibrary?: boolean;
  libraryQuantity?: number;
  year?: string | null;
  team?: string | null;
  manufacturer?: string | null;
  scanCount?: number;
}

const DEDUPE_WINDOW_MS = 60 * 1000; // collapse re-scans of same card within 60s

function dedupeKey(s: { card_name?: string | null; card_set?: string | null; card_number?: string | null; dbId?: string | null }): string {
  if (s.dbId) return `id:${s.dbId}`;
  const name = (s.card_name || "").trim().toLowerCase();
  const set = (s.card_set || "").trim().toLowerCase();
  const num = (s.card_number || "").trim().toLowerCase();
  return `nm:${name}|st:${set}|no:${num}`;
}

export function getRecentScans(): RecentScan[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    
    const scans: RecentScan[] = JSON.parse(stored);
    const now = Date.now();
    
    return scans.filter(s => now - s.scanned_at < TWENTY_FOUR_HOURS_MS);
  } catch {
    return [];
  }
}

const MIN_CONFIDENCE_THRESHOLD = 0.3;

export function addRecentScan(scan: Omit<RecentScan, "scanned_at" | "isHighValue">): boolean {
  try {
    const cardName = scan.card_name?.trim() || "";
    if (!cardName || cardName.toLowerCase() === "unknown card") {
      console.log("[RecentScans] Skipping unreadable card: no valid name");
      return false;
    }
    
    const confidence = scan.confidence ?? 1;
    if (confidence < MIN_CONFIDENCE_THRESHOLD) {
      console.log(`[RecentScans] Skipping low confidence card (${(confidence * 100).toFixed(0)}%): ${cardName}`);
      return false;
    }
    
    const existing = getRecentScans();
    const price = scan.price ?? 0;
    const now = Date.now();
    const key = dedupeKey(scan);

    // Dedupe: if same card was scanned within the window, merge in place
    const dupIdx = existing.findIndex(
      (s) => dedupeKey(s) === key && now - s.scanned_at < DEDUPE_WINDOW_MS
    );

    if (dupIdx !== -1) {
      const prev = existing[dupIdx];
      const mergedPrice = Math.max(prev.price ?? 0, price);
      const mergedPsa10 = Math.max(prev.psa10Price ?? 0, scan.psa10Price ?? 0) || null;
      const merged: RecentScan = {
        ...prev,
        ...scan,
        price: mergedPrice > 0 ? mergedPrice : prev.price ?? scan.price ?? null,
        psa10Price: mergedPsa10,
        scanned_at: now,
        isHighValue: mergedPrice >= VALUE_THRESHOLD,
        scanCount: (prev.scanCount ?? 1) + 1,
      };
      // Move merged entry to the top
      existing.splice(dupIdx, 1);
      const updated = [merged, ...existing].slice(0, 500);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return true;
    }

    const newScan: RecentScan = {
      ...scan,
      scanned_at: now,
      isHighValue: price >= VALUE_THRESHOLD,
      scanCount: 1,
    };

    if (price >= JACKPOT_THRESHOLD) {
      playJackpotSound();
    }

    const updated = [newScan, ...existing].slice(0, 500);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return true;
  } catch (e) {
    console.error("Failed to save recent scan:", e);
    return false;
  }
}

export function getHighValueScans(): Array<RecentScan & { positionBehind: number }> {
  const scans = getRecentScans();
  const highValue: Array<RecentScan & { positionBehind: number }> = [];
  
  scans.forEach((scan, index) => {
    if (scan.isHighValue) {
      highValue.push({
        ...scan,
        positionBehind: index,
      });
    }
  });
  
  return highValue;
}

export function clearExpiredScans(): void {
  const valid = getRecentScans();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
}

export function clearAllRecentScans(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function removeRecentScan(id: string): void {
  const scans = getRecentScans();
  const filtered = scans.filter(s => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

export function updateRecentScan(id: string, patch: Partial<RecentScan>): void {
  const scans = getRecentScans();
  const updated = scans.map(s => s.id === id ? { ...s, ...patch } : s);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function getRecentScanStats() {
  const scans = getRecentScans();
  const highValue = scans.filter(s => s.isHighValue);
  const totalValue = scans.reduce((sum, s) => sum + (s.price ?? 0), 0);
  
  return {
    totalScans: scans.length,
    highValueCount: highValue.length,
    totalValue,
  };
}
