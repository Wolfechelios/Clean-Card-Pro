/**
 * Scan Anomaly Detector
 * Tracks consecutive and session-wide card name frequencies to detect
 * OCR failures, misidentification loops, and bad import data.
 */

export interface AnomalyResult {
  isAnomaly: boolean;
  consecutiveCount: number;
  totalCount: number;
  message: string;
}

export interface SessionReport {
  totalIdentifications: number;
  uniqueNames: number;
  anomalies: { name: string; count: number; percentage: number }[];
}

class ScanAnomalyDetector {
  private consecutiveName: string | null = null;
  private consecutiveCount = 0;
  private nameCounts = new Map<string, number>();
  private totalCount = 0;

  /** Track an identification and return anomaly info */
  trackIdentification(cardName: string): AnomalyResult {
    const normalized = cardName.trim().toLowerCase();
    this.totalCount++;
    this.nameCounts.set(normalized, (this.nameCounts.get(normalized) || 0) + 1);

    if (normalized === this.consecutiveName) {
      this.consecutiveCount++;
    } else {
      this.consecutiveName = normalized;
      this.consecutiveCount = 1;
    }

    const isAnomaly = this.consecutiveCount >= 3;
    let message = "";

    if (this.consecutiveCount >= 5) {
      message = `"${cardName}" identified 5+ times in a row — OCR may be stuck. Consider pausing.`;
    } else if (this.consecutiveCount >= 3) {
      message = `"${cardName}" identified ${this.consecutiveCount} times in a row — check image quality.`;
    }

    return {
      isAnomaly,
      consecutiveCount: this.consecutiveCount,
      totalCount: this.nameCounts.get(normalized) || 1,
      message,
    };
  }

  /** Reset between scan sessions */
  resetSession(): void {
    this.consecutiveName = null;
    this.consecutiveCount = 0;
    this.nameCounts.clear();
    this.totalCount = 0;
  }

  /** Get end-of-session anomaly summary */
  getSessionReport(): SessionReport {
    const anomalies: SessionReport["anomalies"] = [];
    for (const [name, count] of this.nameCounts) {
      const pct = this.totalCount > 0 ? (count / this.totalCount) * 100 : 0;
      if (count >= 3 && pct > 30) {
        anomalies.push({ name, count, percentage: Math.round(pct) });
      }
    }
    return {
      totalIdentifications: this.totalCount,
      uniqueNames: this.nameCounts.size,
      anomalies,
    };
  }
}

/** Singleton for rapid scan / queue processor */
export const queueAnomalyDetector = new ScanAnomalyDetector();

/** Singleton for single-scan hook */
export const singleScanDetector = new ScanAnomalyDetector();


// ─── Import anomaly check ───────────────────────────────────────────

export interface ImportAnomalyResult {
  hasAnomaly: boolean;
  /** Name that appears most frequently */
  topName: string;
  topCount: number;
  topPercentage: number;
  /** true when >90% share one name — auto-reject */
  isCritical: boolean;
  message: string;
}

/**
 * Analyze an array of card names before import insertion.
 * Returns anomaly info if any single name dominates the batch.
 */
export function checkImportAnomaly(cardNames: string[]): ImportAnomalyResult {
  const freq = new Map<string, number>();
  for (const name of cardNames) {
    const n = name.trim().toLowerCase();
    freq.set(n, (freq.get(n) || 0) + 1);
  }

  let topName = "";
  let topCount = 0;
  for (const [name, count] of freq) {
    if (count > topCount) {
      topName = name;
      topCount = count;
    }
  }

  const total = cardNames.length;
  const pct = total > 0 ? (topCount / total) * 100 : 0;
  const hasAnomaly = total >= 5 && pct > 40;
  const isCritical = total >= 5 && pct > 90;

  let message = "";
  if (isCritical) {
    message = `"${topName}" accounts for ${Math.round(pct)}% of rows (${topCount}/${total}). This likely indicates a column-mapping error. Import rejected.`;
  } else if (hasAnomaly) {
    message = `"${topName}" appears ${topCount} times (${Math.round(pct)}% of ${total} rows). This may indicate corrupted data.`;
  }

  return { hasAnomaly, topName, topCount, topPercentage: Math.round(pct), isCritical, message };
}
