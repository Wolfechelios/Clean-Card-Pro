// src/lib/foilTrainer/multiFrameAnalyzer.ts
// Background multi-frame foil analyzer — collects frames during normal scanning,
// detects reflection variance across frames to classify foil type.
// Non-blocking: runs analysis off the main capture path.

import { detectFoilPresence, sparkleDensity } from "@/lib/yugioh/patternAnalysis";

export type FoilClassification = "normal" | "holo" | "reverse_holo" | "secret_rare";

export interface MultiFrameResult {
  rarity: FoilClassification;
  confidence: number;
  frameCount: number;
  reflectionVariance: number;
  specularScore: number;
  textureFrequency: number;
  guidance: string | null;
}

interface FrameSample {
  timestamp: number;
  brightness: Float32Array;
  specularCount: number;
  edgeEnergy: number;
  sparkle: number;
}

const MAX_FRAMES = 4;
const MIN_FRAMES_FOR_ANALYSIS = 2;
const FRAME_AGE_MS = 8000; // discard frames older than 8s
const SPECULAR_THRESHOLD = 240; // pixel brightness to count as specular highlight

export class MultiFrameFoilAnalyzer {
  private frames: FrameSample[] = [];
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;

  constructor() {
    try {
      this.canvas = new OffscreenCanvas(160, 224); // small analysis size
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true }) as any;
    } catch {
      // OffscreenCanvas not supported — fallback
    }
  }

  /** Feed a video frame for background analysis. Non-blocking. */
  addFrame(videoEl: HTMLVideoElement): void {
    if (!this.ctx || !this.canvas) return;
    const now = Date.now();

    // Prune old frames
    this.frames = this.frames.filter((f) => now - f.timestamp < FRAME_AGE_MS);
    if (this.frames.length >= MAX_FRAMES) this.frames.shift();

    try {
      this.ctx.drawImage(videoEl, 0, 0, 160, 224);
      const imageData = this.ctx.getImageData(0, 0, 160, 224);
      const data = imageData.data;
      const pixelCount = 160 * 224;

      // Extract brightness channel
      const brightness = new Float32Array(pixelCount);
      let specularCount = 0;

      for (let i = 0; i < pixelCount; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        brightness[i] = lum;
        if (lum > SPECULAR_THRESHOLD) specularCount++;
      }

      // Edge energy (simple Sobel-like horizontal gradient)
      let edgeEnergy = 0;
      for (let y = 1; y < 223; y++) {
        for (let x = 1; x < 159; x++) {
          const idx = y * 160 + x;
          const gx = Math.abs(brightness[idx + 1] - brightness[idx - 1]);
          const gy = Math.abs(brightness[idx + 160] - brightness[idx - 160]);
          edgeEnergy += gx + gy;
        }
      }
      edgeEnergy /= pixelCount;

      // Sparkle: count of isolated bright spots
      let sparkle = 0;
      for (let y = 2; y < 222; y++) {
        for (let x = 2; x < 158; x++) {
          const idx = y * 160 + x;
          if (brightness[idx] > 220) {
            const neighbors = [
              brightness[idx - 1], brightness[idx + 1],
              brightness[idx - 160], brightness[idx + 160],
            ];
            const avgNeighbor = neighbors.reduce((a, b) => a + b, 0) / 4;
            if (brightness[idx] - avgNeighbor > 40) sparkle++;
          }
        }
      }

      this.frames.push({
        timestamp: now,
        brightness,
        specularCount,
        edgeEnergy,
        sparkle,
      });
    } catch {
      // Frame extraction failed — skip
    }
  }

  /** Get current analysis result. Returns null if not enough frames. */
  analyze(): MultiFrameResult | null {
    if (this.frames.length < MIN_FRAMES_FOR_ANALYSIS) {
      return null;
    }

    // Compute reflection variance across frames
    const specularCounts = this.frames.map((f) => f.specularCount);
    const specularMean = specularCounts.reduce((a, b) => a + b, 0) / specularCounts.length;
    const specularVariance = specularCounts.reduce((sum, v) => sum + (v - specularMean) ** 2, 0) / specularCounts.length;
    const reflectionVariance = Math.sqrt(specularVariance);

    // Average metrics
    const avgEdge = this.frames.reduce((s, f) => s + f.edgeEnergy, 0) / this.frames.length;
    const avgSparkle = this.frames.reduce((s, f) => s + f.sparkle, 0) / this.frames.length;
    const maxSpecular = Math.max(...specularCounts);

    // Classification logic
    let rarity: FoilClassification = "normal";
    let confidence = 0;
    let guidance: string | null = null;

    // High reflection variance = foil (light changes across frames)
    const isLikelyFoil = reflectionVariance > 15 || maxSpecular > 50;
    const hasHighFreqTexture = avgEdge > 12;
    const hasSparkle = avgSparkle > 20;

    if (!isLikelyFoil && reflectionVariance < 5) {
      // Very low variance — likely normal card
      rarity = "normal";
      confidence = Math.min(95, 70 + (5 - reflectionVariance) * 5);
      
      if (this.frames.length < 3) {
        guidance = "Tilt card slightly to detect foil";
      }
    } else if (isLikelyFoil) {
      if (hasHighFreqTexture && hasSparkle && reflectionVariance > 30) {
        // High frequency + sparkle + high variance = secret rare diagonal pattern
        rarity = "secret_rare";
        confidence = Math.min(92, 55 + reflectionVariance * 0.5 + avgSparkle * 0.3);
      } else if (hasSparkle && !hasHighFreqTexture) {
        // Sparkle but low texture frequency = reverse holo (background-only foil)
        rarity = "reverse_holo";
        confidence = Math.min(88, 50 + avgSparkle * 0.5 + reflectionVariance * 0.3);
      } else {
        // General foil = holo
        rarity = "holo";
        confidence = Math.min(90, 50 + reflectionVariance * 0.6 + (hasSparkle ? 10 : 0));
      }
    } else {
      // Borderline — need more frames
      rarity = "normal";
      confidence = 40;
      guidance = "Tilt card slightly to detect foil";
    }

    return {
      rarity,
      confidence: Math.round(confidence),
      frameCount: this.frames.length,
      reflectionVariance: Math.round(reflectionVariance * 10) / 10,
      specularScore: Math.round(specularMean),
      textureFrequency: Math.round(avgEdge * 10) / 10,
      guidance,
    };
  }

  /** Reset the frame buffer (e.g., when switching to a new card) */
  reset(): void {
    this.frames = [];
  }

  get frameCount(): number {
    return this.frames.length;
  }
}

/** Singleton instance for use across the scanner */
let _instance: MultiFrameFoilAnalyzer | null = null;

export function getMultiFrameAnalyzer(): MultiFrameFoilAnalyzer {
  if (!_instance) _instance = new MultiFrameFoilAnalyzer();
  return _instance;
}

export function resetMultiFrameAnalyzer(): void {
  _instance?.reset();
}
