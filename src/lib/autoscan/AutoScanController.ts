// src/lib/autoscan/AutoScanController.ts
// Failsafe state machine for auto-capture.
// Never does OCR/pricing - purely decides when to capture based on stability.

export type AutoScanState = "SEARCHING" | "STABILIZING" | "CAPTURED_LOCK" | "COOLDOWN";

export type FrameInput = {
  now: number;                // ms timestamp
  bbox?: { cx: number; cy: number; w: number; h: number; area: number };
  inRoi: boolean;
  confidence: number;         // 0..1
  driftPx: number;            // computed vs last frame
  sizeVar: number;            // computed vs rolling avg (0..1 as %)
  sharpnessOk: boolean;
  exposureOk: boolean;
  glareOk: boolean;
};

export type CaptureDecision = {
  action: "NONE" | "CAPTURE";
  state: AutoScanState;
  reason?: string;
  stableMs?: number;
  qualityIssue?: "sharpness" | "exposure" | "glare" | null;
};

export type AutoScanTuning = {
  minConfidence: number;
  requiredStableMs: number;
  maxDriftPx: number;
  maxSizeVar: number;
  lostMsToUnlock: number;
  cooldownMs: number;
};

export const DEFAULT_AUTOSCAN_TUNING: AutoScanTuning = {
  minConfidence: 0.70,
  requiredStableMs: 1000,
  maxDriftPx: 6,
  maxSizeVar: 0.03,     // 3%
  lostMsToUnlock: 250,
  cooldownMs: 250,
};

export class AutoScanController {
  state: AutoScanState = "SEARCHING";
  stableMs = 0;
  lastNow = 0;
  lastSeenNow = 0;
  cooldownUntil = 0;
  tuning: AutoScanTuning;

  constructor(tuning: Partial<AutoScanTuning> = {}) {
    this.tuning = { ...DEFAULT_AUTOSCAN_TUNING, ...tuning };
  }

  reset() {
    this.state = "SEARCHING";
    this.stableMs = 0;
    this.lastNow = 0;
    this.lastSeenNow = 0;
    this.cooldownUntil = 0;
  }

  onFrame(input: FrameInput, queueHasCapacity: boolean): CaptureDecision {
    const dt = this.lastNow ? input.now - this.lastNow : 16;
    this.lastNow = input.now;

    const hasCard = !!input.bbox && 
                    input.confidence >= this.tuning.minConfidence && 
                    input.inRoi;

    // COOLDOWN gate
    if (this.state === "COOLDOWN") {
      if (input.now >= this.cooldownUntil) {
        this.state = "SEARCHING";
      }
      return { action: "NONE", state: this.state, stableMs: this.stableMs };
    }

    // SEARCHING
    if (this.state === "SEARCHING") {
      this.stableMs = 0;
      if (hasCard) {
        this.state = "STABILIZING";
        this.lastSeenNow = input.now;
      }
      return { action: "NONE", state: this.state, stableMs: this.stableMs };
    }

    // STABILIZING
    if (this.state === "STABILIZING") {
      if (!hasCard) {
        this.stableMs = 0;
        this.state = "SEARCHING";
        return { action: "NONE", state: this.state, reason: "lost card", stableMs: 0 };
      }

      this.lastSeenNow = input.now;

      const stableThisFrame = input.driftPx <= this.tuning.maxDriftPx && 
                               input.sizeVar <= this.tuning.maxSizeVar;
      
      if (stableThisFrame) {
        this.stableMs += dt;
      } else {
        this.stableMs = 0;
      }

      // Check quality gates
      let qualityIssue: CaptureDecision["qualityIssue"] = null;
      if (!input.sharpnessOk) qualityIssue = "sharpness";
      else if (!input.exposureOk) qualityIssue = "exposure";
      else if (!input.glareOk) qualityIssue = "glare";

      const qualityOk = !qualityIssue;

      if (!queueHasCapacity) {
        return { 
          action: "NONE", 
          state: this.state, 
          reason: "queue full", 
          stableMs: this.stableMs,
          qualityIssue 
        };
      }

      if (this.stableMs >= this.tuning.requiredStableMs && qualityOk) {
        this.state = "CAPTURED_LOCK";
        this.stableMs = 0;
        return { 
          action: "CAPTURE", 
          state: this.state, 
          reason: "stable+quality ok",
          stableMs: this.tuning.requiredStableMs 
        };
      }

      return { 
        action: "NONE", 
        state: this.state, 
        stableMs: this.stableMs,
        qualityIssue 
      };
    }

    // CAPTURED_LOCK - wait for card to leave
    if (this.state === "CAPTURED_LOCK") {
      if (!input.bbox) {
        // Card gone - check if long enough
        if (input.now - this.lastSeenNow > this.tuning.lostMsToUnlock) {
          this.state = "COOLDOWN";
          this.cooldownUntil = input.now + this.tuning.cooldownMs;
        }
      } else {
        // Still seeing something, keep lock
        this.lastSeenNow = input.now;
      }
      return { action: "NONE", state: this.state, stableMs: 0 };
    }

    return { action: "NONE", state: this.state, stableMs: 0 };
  }

  getState(): AutoScanState {
    return this.state;
  }

  getStableMs(): number {
    return this.stableMs;
  }

  getProgress(): number {
    if (this.state !== "STABILIZING") return 0;
    return Math.min(1, this.stableMs / this.tuning.requiredStableMs);
  }
}
