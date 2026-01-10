// src/lib/autoscan/FrameAnalyzer.ts
// Analyzes video frames for card detection, stability, and quality.
// Does NOT call any APIs - pure image processing only.

export type BBox = {
  cx: number;
  cy: number;
  w: number;
  h: number;
  area: number;
};

export type FrameAnalysis = {
  bbox?: BBox;
  inRoi: boolean;
  confidence: number;
  driftPx: number;
  sizeVar: number;
  sharpnessOk: boolean;
  exposureOk: boolean;
  glareOk: boolean;
  sharpnessValue: number;
  exposureValue: number;
  glareValue: number;
};

export type FrameAnalyzerConfig = {
  // ROI (region of interest) - center box where card should be
  roiPadding: number; // 0-1, how much padding from edges (0.1 = 10% inset)
  
  // Quality thresholds
  minSharpness: number;       // Laplacian variance threshold
  minExposure: number;        // 0-255
  maxExposure: number;        // 0-255
  maxGlareRatio: number;      // ratio of blown highlights (0-1)
  
  // Stability - rolling averages
  historySize: number;        // frames to track for rolling average
};

export const DEFAULT_ANALYZER_CONFIG: FrameAnalyzerConfig = {
  roiPadding: 0.15,          // 15% padding from edges
  minSharpness: 50,          // Lowered - less strict
  minExposure: 30,           // More tolerant of darker scenes
  maxExposure: 230,          // More tolerant of brighter scenes
  maxGlareRatio: 0.08,       // 8% glare tolerance
  historySize: 10,
};

export class FrameAnalyzer {
  private config: FrameAnalyzerConfig;
  private lastBbox?: BBox;
  private bboxHistory: BBox[] = [];
  private analysisCanvas: HTMLCanvasElement;
  private analysisCtx: CanvasRenderingContext2D;
  private sampleWidth = 160;
  private sampleHeight = 120;

  // ROI motion tracking (for stability / enter-exit behavior)
  private lastRoiGray?: Uint8Array;
  private motionEma = 999;

  constructor(config: Partial<FrameAnalyzerConfig> = {}) {
    this.config = { ...DEFAULT_ANALYZER_CONFIG, ...config };
    this.analysisCanvas = document.createElement("canvas");
    this.analysisCanvas.width = this.sampleWidth;
    this.analysisCanvas.height = this.sampleHeight;
    this.analysisCtx = this.analysisCanvas.getContext("2d", { 
      willReadFrequently: true 
    })!;
  }

  reset() {
    this.lastBbox = undefined;
    this.bboxHistory = [];
  }

  /**
   * Analyze a video frame for card presence and quality
   */
  analyze(video: HTMLVideoElement): FrameAnalysis {
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (vw === 0 || vh === 0) {
      return this.emptyResult();
    }

    // Draw downscaled frame for analysis
    this.analysisCtx.drawImage(video, 0, 0, this.sampleWidth, this.sampleHeight);
    const imageData = this.analysisCtx.getImageData(0, 0, this.sampleWidth, this.sampleHeight);

    // Detect presence inside the ROI (center box). This function also updates motion EMA.
    const bbox = this.detectCardBbox(imageData);

    // Check if card is in ROI (center region)
    const inRoi = bbox ? this.isInRoi(bbox) : false;

    // Calculate confidence based on bbox characteristics
    const confidence = bbox ? this.calculateConfidence(bbox) : 0;

    // Drift is ROI motion (not bbox-center drift) so "enter/exit" behaves reliably.
    const driftPx = this.calculateDrift(bbox);

    // Size variance from rolling average
    const sizeVar = this.calculateSizeVariance(bbox);

    // Quality checks
    const sharpnessValue = this.measureSharpness(imageData);
    const exposureValue = this.measureExposure(imageData);
    const glareValue = this.measureGlare(imageData);

    const sharpnessOk = sharpnessValue >= this.config.minSharpness;
    const exposureOk = exposureValue >= this.config.minExposure && 
                       exposureValue <= this.config.maxExposure;
    const glareOk = glareValue <= this.config.maxGlareRatio;

    // Update history
    if (bbox) {
      this.bboxHistory.push(bbox);
      if (this.bboxHistory.length > this.config.historySize) {
        this.bboxHistory.shift();
      }
    }
    this.lastBbox = bbox;

    return {
      bbox,
      inRoi,
      confidence,
      driftPx,
      sizeVar,
      sharpnessOk,
      exposureOk,
      glareOk,
      sharpnessValue,
      exposureValue,
      glareValue,
    };
  }

  private emptyResult(): FrameAnalysis {
    return {
      bbox: undefined,
      inRoi: false,
      confidence: 0,
      driftPx: 999,
      sizeVar: 1,
      sharpnessOk: false,
      exposureOk: false,
      glareOk: false,
      sharpnessValue: 0,
      exposureValue: 0,
      glareValue: 1,
    };
  }

  /**
   * ROI-based presence detection.
   *
   * Goal: make Auto-Scan behave like "enter the box -> hold still -> capture -> exit the box".
   *
   * We avoid full-frame bbox detection (expensive + unreliable) and instead:
   * - Look for enough edge density INSIDE the center ROI (means "something card-like entered")
   * - Track ROI motion via frame differencing (means "holding steady")
   */
  private detectCardBbox(imageData: ImageData): BBox | undefined {
    const { width, height, data } = imageData;

    const roi = this.getRoiRect();
    const roiW = roi.w;
    const roiH = roi.h;

    // Build ROI grayscale buffer
    const gray = new Uint8Array(roiW * roiH);
    let p = 0;
    for (let y = 0; y < roiH; y++) {
      const srcY = (roi.y + y) * width;
      for (let x = 0; x < roiW; x++) {
        const srcIdx = (srcY + (roi.x + x)) * 4;
        gray[p++] = Math.round(data[srcIdx] * 0.299 + data[srcIdx + 1] * 0.587 + data[srcIdx + 2] * 0.114);
      }
    }

    // Motion (mean absolute difference) inside ROI
    let motionMean = 255;
    if (this.lastRoiGray && this.lastRoiGray.length === gray.length) {
      let sum = 0;
      for (let i = 0; i < gray.length; i++) sum += Math.abs(gray[i] - this.lastRoiGray[i]);
      motionMean = sum / gray.length;
    }
    this.lastRoiGray = gray;

    // Smooth motion to avoid jittery stability
    if (this.motionEma === 999) this.motionEma = motionMean;
    else this.motionEma = this.motionEma * 0.7 + motionMean * 0.3;

    // Edge density inside ROI (fast gradient, no sqrt)
    const edgeThreshold = 28;
    let edgeCount = 0;
    const innerW = Math.max(0, roiW - 2);
    const innerH = Math.max(0, roiH - 2);
    const denom = Math.max(1, innerW * innerH);

    for (let y = 1; y < roiH - 1; y++) {
      for (let x = 1; x < roiW - 1; x++) {
        const idx = y * roiW + x;
        const gx = gray[idx + 1] - gray[idx - 1];
        const gy = gray[idx + roiW] - gray[idx - roiW];
        const mag = Math.abs(gx) + Math.abs(gy);
        if (mag > edgeThreshold) edgeCount++;
      }
    }

    const edgeDensity = edgeCount / denom;

    // Presence threshold tuned for 160x120 sampling ROI.
    // (Keeps false positives low while still triggering on a card entering the box.)
    if (edgeDensity < 0.045) return undefined;

    // Return a fixed bbox matching the ROI (centered), normalized 0..1
    const wN = roiW / width;
    const hN = roiH / height;

    return {
      cx: 0.5,
      cy: 0.5,
      w: wN,
      h: hN,
      area: wN * hN,
    };
  }

  private getRoiRect(): { x: number; y: number; w: number; h: number } {
    const pad = this.config.roiPadding;

    // Match the on-screen overlay: ~70% width, card aspect ratio.
    const roiWidthFrac = Math.max(0.2, 1 - 2 * pad);
    const cardAspect = 2.5 / 3.5; // width/height
    const roiHeightFrac = Math.min(1, roiWidthFrac / cardAspect);

    const w = Math.max(8, Math.round(this.sampleWidth * roiWidthFrac));
    const h = Math.max(8, Math.round(this.sampleHeight * roiHeightFrac));
    const x = Math.round((this.sampleWidth - w) / 2);
    const y = Math.round((this.sampleHeight - h) / 2);

    return { x, y, w, h };
  }

  private isInRoi(bbox: BBox): boolean {
    const pad = this.config.roiPadding;
    // Card center should be within the center region (with padding from edges)
    return bbox.cx >= pad && 
           bbox.cx <= (1 - pad) && 
           bbox.cy >= pad && 
           bbox.cy <= (1 - pad);
  }

  private calculateConfidence(bbox: BBox): number {
    // Confidence based on:
    // - Area coverage (bigger = more confident)
    // - Center alignment (centered = more confident)
    // - Aspect ratio (closer to card ratio = more confident)
    
    const areaCoverage = Math.min(bbox.area / 0.3, 1); // Caps at 30% coverage
    
    const centerDist = Math.sqrt(
      Math.pow(bbox.cx - 0.5, 2) + 
      Math.pow(bbox.cy - 0.5, 2)
    );
    const centerScore = Math.max(0, 1 - centerDist * 2);
    
    const aspect = bbox.w / Math.max(bbox.h, 0.001);
    const idealAspect = 0.714; // 2.5:3.5 standard card
    const aspectScore = Math.max(0, 1 - Math.abs(aspect - idealAspect) * 2);

    return (areaCoverage * 0.4 + centerScore * 0.4 + aspectScore * 0.2);
  }

  private calculateDrift(bbox?: BBox): number {
    // We intentionally use ROI motion (frame differencing) rather than bbox center drift.
    // This matches the desired behavior: "when something enters/exits the box".
    if (!bbox) {
      this.motionEma = 999;
      return 999;
    }

    // Map motion mean (0..255-ish) to a px-like scale for the controller thresholds.
    // (Lower is steadier.)
    const motion = this.motionEma === 999 ? 999 : this.motionEma;
    return motion === 999 ? 999 : motion / 6;
  }

  private calculateSizeVariance(bbox?: BBox): number {
    if (!bbox || this.bboxHistory.length < 2) {
      return 0; // No variance to measure
    }

    // Calculate average area
    const areas = this.bboxHistory.map(b => b.area);
    const avgArea = areas.reduce((a, b) => a + b, 0) / areas.length;
    
    if (avgArea === 0) return 0;

    // Current deviation from average
    return Math.abs(bbox.area - avgArea) / avgArea;
  }

  /**
   * Measure image sharpness using Laplacian variance
   */
  private measureSharpness(imageData: ImageData): number {
    const { width, height, data } = imageData;
    
    // Convert to grayscale
    const gray = new Float32Array(width * height);
    for (let i = 0; i < data.length; i += 4) {
      gray[i / 4] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    }

    // Apply Laplacian kernel and compute variance
    let sum = 0;
    let sumSq = 0;
    let count = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        
        // Laplacian: center * 4 - neighbors
        const laplacian = 
          4 * gray[idx] - 
          gray[idx - 1] - 
          gray[idx + 1] - 
          gray[idx - width] - 
          gray[idx + width];
        
        sum += laplacian;
        sumSq += laplacian * laplacian;
        count++;
      }
    }

    if (count === 0) return 0;
    
    const mean = sum / count;
    const variance = (sumSq / count) - (mean * mean);
    
    return Math.max(0, variance);
  }

  /**
   * Measure average brightness (exposure)
   */
  private measureExposure(imageData: ImageData): number {
    const { data } = imageData;
    let sum = 0;
    const pixels = data.length / 4;
    
    for (let i = 0; i < data.length; i += 4) {
      // Luminance
      sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    }
    
    return sum / pixels;
  }

  /**
   * Measure ratio of blown-out highlights (glare)
   */
  private measureGlare(imageData: ImageData): number {
    const { data } = imageData;
    let glarePixels = 0;
    const pixels = data.length / 4;
    const glareThreshold = 250;
    
    for (let i = 0; i < data.length; i += 4) {
      // Check if any channel is blown out
      if (data[i] > glareThreshold || 
          data[i + 1] > glareThreshold || 
          data[i + 2] > glareThreshold) {
        glarePixels++;
      }
    }
    
    return glarePixels / pixels;
  }
}
