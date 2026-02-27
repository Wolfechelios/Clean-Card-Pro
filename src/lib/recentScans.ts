// Recent scans tracking - 2 hour window with $20+ value highlighting

import { playJackpotBeep } from "@/lib/audioBeeps";

const STORAGE_KEY = "recent_scans";
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const VALUE_THRESHOLD = 20; // USD
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
  confidence: number | null;
  scanned_at: number;
  isHighValue: boolean;
  rarity?: string | null;
  gameType?: string | null;
  sportType?: string | null;
  dbId?: string | null;
  isInLibrary?: boolean;
  libraryQuantity?: number;
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
    const newScan: RecentScan = {
      ...scan,
      scanned_at: Date.now(),
      isHighValue: price >= VALUE_THRESHOLD,
    };
    
    if (price >= JACKPOT_THRESHOLD) {
      playJackpotSound();
    }
    
    const updated = [newScan, ...existing].slice(0, 100);
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
