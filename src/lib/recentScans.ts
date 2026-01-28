// Recent scans tracking - 2 hour window with $20+ value highlighting

const STORAGE_KEY = "recent_scans";
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const VALUE_THRESHOLD = 20; // USD

export interface RecentScan {
  id: string;
  card_name: string;
  card_set: string | null;
  image_url: string;
  price: number | null;
  scanned_at: number; // timestamp
  isHighValue: boolean;
}

export function getRecentScans(): RecentScan[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    
    const scans: RecentScan[] = JSON.parse(stored);
    const now = Date.now();
    
    // Filter to only scans within 2 hours
    return scans.filter(s => now - s.scanned_at < TWO_HOURS_MS);
  } catch {
    return [];
  }
}

export function addRecentScan(scan: Omit<RecentScan, "scanned_at" | "isHighValue">): void {
  try {
    const existing = getRecentScans();
    const newScan: RecentScan = {
      ...scan,
      scanned_at: Date.now(),
      isHighValue: (scan.price ?? 0) >= VALUE_THRESHOLD,
    };
    
    // Add to front, limit to 100 scans
    const updated = [newScan, ...existing].slice(0, 100);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error("Failed to save recent scan:", e);
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
