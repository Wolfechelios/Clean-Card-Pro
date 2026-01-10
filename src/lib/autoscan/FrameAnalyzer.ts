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
  roiPadding: 0.1,
  minSharpness: 100,
  minExposure: 40,
  maxExposure: 220,
  maxGlareRatio: 0.05,
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

    // Detect card-like rectangle
    const bbox = this.detectCardBbox(imageData);
    
    // Check if card is in ROI (center region)
    const inRoi = bbox ? this.isInRoi(bbox) : false;
    
    // Calculate confidence based on bbox characteristics
    const confidence = bbox ? this.calculateConfidence(bbox) : 0;

    // Calculate drift from last frame
    const driftPx = this.calculateDrift(bbox);

    // Calculate size variance from rolling average
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
   * Simple edge-based card detection using Sobel-like gradient
   */
  private detectCardBbox(imageData: ImageData): BBox | undefined {
    const { width, height, data } = imageData;
    
    // Convert to grayscale and compute gradients
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i += 4) {
      const idx = i / 4;
      gray[idx] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    }

    // Find edges using simple gradient magnitude
    let edgeCount = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    
    const edgeThreshold = 30;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        
        // Simple Sobel-ish gradient
        const gx = gray[idx + 1] - gray[idx - 1];
        const gy = gray[idx + width] - gray[idx - width];
        const magnitude = Math.sqrt(gx * gx + gy * gy);

        if (magnitude > edgeThreshold) {
          edgeCount++;
          sumX += x;
          sumY += y;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    // Need minimum edges to consider it a card
    const minEdges = (width * height) * 0.02; // 2% of pixels should be edges
    if (edgeCount < minEdges) {
      return undefined;
    }

    // Bounding box must have reasonable aspect ratio (trading cards are ~2.5:3.5)
    const boxW = maxX - minX;
    const boxH = maxY - minY;
    const aspect = boxW / Math.max(boxH, 1);
    
    // Cards have aspect ratio roughly 0.5-0.9 (portrait) or 1.1-2.0 (landscape)
    const validAspect = (aspect > 0.4 && aspect < 1.0) || (aspect > 1.0 && aspect < 2.2);
    
    // Box must be at least 20% of frame in both dimensions
    const validSize = boxW > width * 0.2 && boxH > height * 0.2;

    if (!validAspect || !validSize) {
      return undefined;
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const area = boxW * boxH;

    return {
      cx: cx / width,   // Normalize to 0-1
      cy: cy / height,
      w: boxW / width,
      h: boxH / height,
      area: area / (width * height),
    };
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
    if (!bbox || !this.lastBbox) {
      return 999; // No comparison possible
    }

    // Drift in normalized coordinates, convert to approximate pixels
    // Assuming ~160px sample width
    const dx = (bbox.cx - this.lastBbox.cx) * this.sampleWidth;
    const dy = (bbox.cy - this.lastBbox.cy) * this.sampleHeight;
    
    return Math.sqrt(dx * dx + dy * dy);
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
