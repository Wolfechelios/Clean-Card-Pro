// Recent scans tracking - 2 hour window with $20+ value highlighting

import highValueAlertSound from "@/assets/high-value-alert.mp3";

const STORAGE_KEY = "recent_scans";
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const VALUE_THRESHOLD = 20; // USD
const JACKPOT_THRESHOLD = 50; // USD - plays special sound

// Audio instance for jackpot alert
let jackpotAudio: HTMLAudioElement | null = null;

export function playJackpotSound(): void {
  try {
    if (!jackpotAudio) {
      jackpotAudio = new Audio(highValueAlertSound);
      jackpotAudio.volume = 0.7;
    }
    jackpotAudio.currentTime = 0;
    jackpotAudio.play().catch(() => {
      // Ignore autoplay errors
    });
  } catch (e) {
    console.error("Failed to play jackpot sound:", e);
  }
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
  scanned_at: number; // timestamp
  isHighValue: boolean;
}

export function getRecentScans(): RecentScan[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    
    const scans: RecentScan[] = JSON.parse(stored);
    const now = Date.now();
    
    // Filter to only scans within 24 hours
    return scans.filter(s => now - s.scanned_at < TWENTY_FOUR_HOURS_MS);
  } catch {
    return [];
  }
}

// Minimum confidence required to keep a scan (filter out blurry/unreadable)
const MIN_CONFIDENCE_THRESHOLD = 0.3; // 30% confidence minimum

export function addRecentScan(scan: Omit<RecentScan, "scanned_at" | "isHighValue">): boolean {
  try {
    // Filter out unreadable cards:
    // 1. Must have a card name that isn't "Unknown Card"
    // 2. Must have confidence above threshold (if provided)
    const cardName = scan.card_name?.trim() || "";
    if (!cardName || cardName.toLowerCase() === "unknown card") {
      console.log("[RecentScans] Skipping unreadable card: no valid name");
      return false;
    }
    
    // Check confidence if provided
    const confidence = scan.confidence ?? 1; // Default to 1 if not provided
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
    
    // Play jackpot sound for $50+ cards
    if (price >= JACKPOT_THRESHOLD) {
      playJackpotSound();
    }
    
    // Add to front, limit to 100 scans
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
        positionBehind: index, // 0 = most recent, higher = further back
      });
    }
  });
  
  return highValue;
}

export function clearExpiredScans(): void {
  const valid = getRecentScans();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
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
