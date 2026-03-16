// src/lib/yugioh/patternAnalysis.ts
// Pure-JS pattern detection algorithms for foil rarity analysis
// Operates on ImageData — no external dependencies

// ─── Helpers ────────────────────────────────────────────

/** Convert RGB to HSL (h: 0-360, s: 0-1, l: 0-1) */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

/** Luminance of a pixel (0-255 scale) */
function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// ─── Specular / Brightness Analysis ─────────────────────

export interface BrightnessStats {
  brightFraction: number;
  avgLuminance: number;
  maxLuminance: number;
  stdLuminance: number;
}

export function analyzeBrightness(data: ImageData, threshold = 220): BrightnessStats {
  const d = data.data;
  const total = data.width * data.height;
  let sum = 0, sumSq = 0, brightCount = 0, maxL = 0;

  for (let i = 0; i < d.length; i += 4) {
    const l = luminance(d[i], d[i + 1], d[i + 2]);
    sum += l;
    sumSq += l * l;
    if (l > threshold) brightCount++;
    if (l > maxL) maxL = l;
  }

  const avg = sum / total;
  const variance = sumSq / total - avg * avg;

  return {
    brightFraction: brightCount / total,
    avgLuminance: avg,
    maxLuminance: maxL,
    stdLuminance: Math.sqrt(Math.max(0, variance)),
  };
}

// ─── Sparkle Density (Enhanced) ─────────────────────────

/**
 * Measure sparkle density with cluster analysis.
 * Sparkles are bright pixels surrounded by darker pixels.
 * Also tracks cluster sizes to distinguish Starlight (dense small clusters)
 * from general foil shine (large bright areas).
 */
export function sparkleDensity(data: ImageData, threshold = 230): {
  density: number;
  clusterCount: number;
  avgClusterSize: number;
} {
  const d = data.data;
  const w = data.width;
  const h = data.height;
  let sparkleCount = 0;
  const total = w * h;

  // Track bright pixel clusters
  const visited = new Uint8Array(w * h);
  let clusterCount = 0;
  let totalClusterSize = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      const l = luminance(d[idx], d[idx + 1], d[idx + 2]);
      if (l < threshold) continue;

      // Check isolated bright point (sparkle)
      let darkerNeighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const ni = ((y + dy) * w + (x + dx)) * 4;
          const nl = luminance(d[ni], d[ni + 1], d[ni + 2]);
          if (nl < l - 35) darkerNeighbors++;
        }
      }
      if (darkerNeighbors >= 4) sparkleCount++;

      // Cluster tracking via flood fill (simplified)
      const pi = y * w + x;
      if (!visited[pi] && l > threshold) {
        // BFS cluster
        let size = 0;
        const stack = [pi];
        visited[pi] = 1;
        while (stack.length > 0 && size < 50) {
          const p = stack.pop()!;
          size++;
          const px = p % w, py = Math.floor(p / w);
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = px + dx, ny = py + dy;
              if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
              const np = ny * w + nx;
              if (visited[np]) continue;
              const ni = np * 4;
              if (luminance(d[ni], d[ni + 1], d[ni + 2]) >= threshold) {
                visited[np] = 1;
                stack.push(np);
              }
            }
          }
        }
        clusterCount++;
        totalClusterSize += size;
      }
    }
  }

  return {
    density: sparkleCount / total,
    clusterCount,
    avgClusterSize: clusterCount > 0 ? totalClusterSize / clusterCount : 0,
  };
}

// ─── Color Variance (Rainbow / Hue Spread) ─────────────

export interface ColorStats {
  avgSaturation: number;
  hueSpread: number;
  chromaticFraction: number;
  isMultiHue: boolean;
}

export function analyzeColor(data: ImageData): ColorStats {
  const d = data.data;
  const total = data.width * data.height;
  let satSum = 0;
  let chromaticCount = 0;
  const hueBuckets = new Float32Array(12);

  const step = Math.max(1, Math.floor(total / 2000)) * 4;
  let sampleCount = 0;

  for (let i = 0; i < d.length; i += step) {
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    if (l < 0.1 || l > 0.95) continue;
    satSum += s;
    sampleCount++;
    if (s > 0.3) {
      chromaticCount++;
      hueBuckets[Math.floor(h / 30) % 12]++;
    }
  }

  if (sampleCount === 0) {
    return { avgSaturation: 0, hueSpread: 0, chromaticFraction: 0, isMultiHue: false };
  }

  const avgSat = satSum / sampleCount;
  const chromaticFrac = chromaticCount / sampleCount;

  const bucketThreshold = chromaticCount * 0.08;
  let activeBuckets = 0;
  for (let b = 0; b < 12; b++) {
    if (hueBuckets[b] > bucketThreshold) activeBuckets++;
  }

  let sinSum = 0, cosSum = 0;
  for (let b = 0; b < 12; b++) {
    const angle = ((b * 30 + 15) * Math.PI) / 180;
    sinSum += hueBuckets[b] * Math.sin(angle);
    cosSum += hueBuckets[b] * Math.cos(angle);
  }
  const totalChromatic = chromaticCount || 1;
  const R = Math.sqrt(sinSum * sinSum + cosSum * cosSum) / totalChromatic;
  const hueSpread = Math.sqrt(-2 * Math.log(Math.max(R, 0.001))) * (180 / Math.PI);

  return {
    avgSaturation: avgSat,
    hueSpread: Math.min(hueSpread, 180),
    chromaticFraction: chromaticFrac,
    isMultiHue: activeBuckets >= 4,
  };
}

// ─── Diagonal Line Detection (Enhanced with Hough-like) ─

/**
 * Detect diagonal line patterns (Secret Rare signature).
 * Uses Sobel gradients + angle histogram with enhanced scoring.
 * Checks both 45° and 135° diagonal dominance over H/V edges.
 */
export function detectDiagonalLines(data: ImageData): number {
  const d = data.data;
  const w = data.width;
  const h = data.height;

  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    const pi = i * 4;
    gray[i] = luminance(d[pi], d[pi + 1], d[pi + 2]);
  }

  // 16 angle bins for finer resolution (11.25° each)
  const angleBins = new Float32Array(16);
  let totalMag = 0;
  let edgePixelCount = 0;

  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const gx =
        -gray[(y - 1) * w + (x - 1)] + gray[(y - 1) * w + (x + 1)] +
        -2 * gray[y * w + (x - 1)] + 2 * gray[y * w + (x + 1)] +
        -gray[(y + 1) * w + (x - 1)] + gray[(y + 1) * w + (x + 1)];
      const gy =
        -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x + 1)] +
        gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)];

      const mag = Math.sqrt(gx * gx + gy * gy);
      if (mag < 12) continue;

      totalMag += mag;
      edgePixelCount++;

      let angle = (Math.atan2(gy, gx) * 180) / Math.PI;
      if (angle < 0) angle += 180;
      const bin = Math.floor(angle / 11.25) % 16;
      angleBins[bin] += mag;
    }
  }

  if (totalMag < 1 || edgePixelCount < 20) return 0;

  // Diagonal bins: 45° = bins 3-4, 135° = bins 11-12
  const diag45 = (angleBins[3] + angleBins[4]) / totalMag;
  const diag135 = (angleBins[11] + angleBins[12]) / totalMag;
  const diagonalStrength = diag45 + diag135;

  // H/V bins: 0° = bins 0,15; 90° = bins 7,8
  const hvStrength = (angleBins[0] + angleBins[15] + angleBins[7] + angleBins[8]) / totalMag;

  // Repeating pattern check: consistent diagonals across image regions
  // Split into quadrants and check diagonal consistency
  const quadrantScores: number[] = [];
  const halfW = Math.floor(w / 2);
  const halfH = Math.floor(h / 2);
  for (let qy = 0; qy < 2; qy++) {
    for (let qx = 0; qx < 2; qx++) {
      let qDiag = 0, qTotal = 0;
      const sy = qy * halfH + 1, ey = Math.min((qy + 1) * halfH, h - 1);
      const sx = qx * halfW + 1, ex = Math.min((qx + 1) * halfW, w - 1);
      for (let y = sy; y < ey; y += 3) {
        for (let x = sx; x < ex; x += 3) {
          const gx =
            -gray[(y - 1) * w + (x - 1)] + gray[(y - 1) * w + (x + 1)] +
            -2 * gray[y * w + (x - 1)] + 2 * gray[y * w + (x + 1)] +
            -gray[(y + 1) * w + (x - 1)] + gray[(y + 1) * w + (x + 1)];
          const gy2 =
            -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x + 1)] +
            gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)];
          const m = Math.sqrt(gx * gx + gy2 * gy2);
          if (m < 12) continue;
          qTotal += m;
          let a = (Math.atan2(gy2, gx) * 180) / Math.PI;
          if (a < 0) a += 180;
          if ((a > 30 && a < 60) || (a > 120 && a < 150)) qDiag += m;
        }
      }
      if (qTotal > 0) quadrantScores.push(qDiag / qTotal);
    }
  }

  // Consistency bonus: all quadrants show similar diagonal strength
  let consistency = 0;
  if (quadrantScores.length >= 4) {
    const minQ = Math.min(...quadrantScores);
    const maxQ = Math.max(...quadrantScores);
    consistency = maxQ > 0 ? minQ / maxQ : 0;
  }

  const rawScore = Math.max(0, (diagonalStrength - hvStrength) * 2.5 + diagonalStrength * 0.5);
  const consistencyBonus = consistency > 0.5 ? 0.15 : 0;

  return Math.min(1, rawScore + consistencyBonus);
}

// ─── Lattice / Grid Detection (Enhanced with FFT-like) ──

/**
 * Detect repeating grid/lattice pattern (Collector's Rare signature).
 * Uses autocorrelation + spatial frequency peak detection.
 */
export function detectLatticePattern(data: ImageData): number {
  const d = data.data;
  const w = data.width;
  const h = data.height;

  const rowProj = new Float32Array(h);
  const colProj = new Float32Array(w);

  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      sum += luminance(d[idx], d[idx + 1], d[idx + 2]);
    }
    rowProj[y] = sum / w;
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y < h; y++) {
      const idx = (y * w + x) * 4;
      sum += luminance(d[idx], d[idx + 1], d[idx + 2]);
    }
    colProj[x] = sum / h;
  }

  function autocorrelationPeaks(signal: Float32Array): { score: number; peakSpacing: number } {
    const n = signal.length;
    if (n < 10) return { score: 0, peakSpacing: 0 };

    let mean = 0;
    for (let i = 0; i < n; i++) mean += signal[i];
    mean /= n;

    const centered = new Float32Array(n);
    let variance = 0;
    for (let i = 0; i < n; i++) {
      centered[i] = signal[i] - mean;
      variance += centered[i] * centered[i];
    }
    if (variance < 1) return { score: 0, peakSpacing: 0 };

    let peakCount = 0;
    const peakLags: number[] = [];
    const maxLag = Math.min(Math.floor(n / 3), 80);
    let prev = 0, prevPrev = 0;

    for (let lag = 2; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i < n - lag; i++) {
        corr += centered[i] * centered[i + lag];
      }
      corr /= variance;

      if (lag > 3 && prev > prevPrev && prev > corr && prev > 0.12) {
        peakCount++;
        peakLags.push(lag - 1);
      }
      prevPrev = prev;
      prev = corr;
    }

    // Check regularity of peak spacing
    let spacingRegularity = 0;
    if (peakLags.length >= 2) {
      const spacings = peakLags.slice(1).map((l, i) => l - peakLags[i]);
      const avgSpacing = spacings.reduce((a, b) => a + b, 0) / spacings.length;
      const spacingVar = spacings.reduce((a, s) => a + (s - avgSpacing) ** 2, 0) / spacings.length;
      spacingRegularity = avgSpacing > 0 ? 1 - Math.min(1, Math.sqrt(spacingVar) / avgSpacing) : 0;
    }

    const rawScore = Math.min(1, peakCount / 3);
    return {
      score: rawScore * 0.7 + spacingRegularity * 0.3,
      peakSpacing: peakLags.length > 0 ? peakLags[0] : 0,
    };
  }

  const rowResult = autocorrelationPeaks(rowProj);
  const colResult = autocorrelationPeaks(colProj);

  // Both directions need periodicity for a true lattice
  const combined = (rowResult.score + colResult.score) / 1.5;

  // Bonus if both row and col have similar peak spacing (square grid)
  let gridBonus = 0;
  if (rowResult.peakSpacing > 0 && colResult.peakSpacing > 0) {
    const ratio = Math.min(rowResult.peakSpacing, colResult.peakSpacing) /
                  Math.max(rowResult.peakSpacing, colResult.peakSpacing);
    if (ratio > 0.7) gridBonus = 0.15;
  }

  return Math.min(1, combined + gridBonus);
}

// ─── Ghost / Holographic Detection (Enhanced) ───────────

/**
 * Detect ghost rare: faded/washed-out art + holographic reflection.
 * Uses desaturation analysis + luminance bimodality + reflective gradient detection.
 */
export function detectGhostPattern(data: ImageData): number {
  const d = data.data;
  const total = data.width * data.height;
  let lowSatCount = 0;
  let midToneCount = 0;
  const lumValues: number[] = [];

  const step = Math.max(1, Math.floor(total / 3000)) * 4;
  let sampleCount = 0;

  for (let i = 0; i < d.length; i += step) {
    const [, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    const lum = luminance(d[i], d[i + 1], d[i + 2]);
    sampleCount++;

    if (s < 0.12 && l > 0.25 && l < 0.92) lowSatCount++;
    if (l > 0.4 && l < 0.8) midToneCount++;
    lumValues.push(lum);
  }

  if (sampleCount === 0) return 0;

  const lowSatFrac = lowSatCount / sampleCount;
  const midToneFrac = midToneCount / sampleCount;

  // Luminance bimodality check (faded art + mirror reflections)
  let mean = 0;
  for (const l of lumValues) mean += l;
  mean /= lumValues.length;
  let variance = 0;
  for (const l of lumValues) variance += (l - mean) * (l - mean);
  variance /= lumValues.length;
  const cv = Math.sqrt(variance) / (mean || 1);

  // Check for specular gradient (mirror-like glare)
  const bright = analyzeBrightness(data, 210);
  const specularIndicator = bright.brightFraction > 0.05 ? 0.15 : 0;

  // Ghost = very desaturated + mid-tones dominant + moderate variance + some specular
  const ghostScore =
    lowSatFrac * 0.5 +
    Math.min(cv, 0.5) * 0.6 +
    (midToneFrac > 0.4 ? 0.15 : 0) +
    specularIndicator;

  return Math.min(1, Math.max(0, ghostScore));
}

// ─── Emboss / Raised Texture Detection (Enhanced) ───────

/**
 * Detect embossed texture (Ultimate Rare signature).
 * Uses Laplacian + directional shadow analysis for depth estimation.
 */
export function detectEmbossTexture(data: ImageData): number {
  const d = data.data;
  const w = data.width;
  const h = data.height;

  let totalLap = 0;
  let pixelCount = 0;
  let shadowEdgeCount = 0;

  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const idx = (y * w + x) * 4;
      const c = luminance(d[idx], d[idx + 1], d[idx + 2]);
      const up = luminance(d[((y - 1) * w + x) * 4], d[((y - 1) * w + x) * 4 + 1], d[((y - 1) * w + x) * 4 + 2]);
      const down = luminance(d[((y + 1) * w + x) * 4], d[((y + 1) * w + x) * 4 + 1], d[((y + 1) * w + x) * 4 + 2]);
      const left = luminance(d[(y * w + x - 1) * 4], d[(y * w + x - 1) * 4 + 1], d[(y * w + x - 1) * 4 + 2]);
      const right = luminance(d[(y * w + x + 1) * 4], d[(y * w + x + 1) * 4 + 1], d[(y * w + x + 1) * 4 + 2]);

      const lap = Math.abs(4 * c - up - down - left - right);
      totalLap += lap;
      pixelCount++;

      // Shadow contour detection: bright pixel next to significantly darker pixel
      // indicates raised edge casting shadow (emboss characteristic)
      const maxNeighbor = Math.max(up, down, left, right);
      const minNeighbor = Math.min(up, down, left, right);
      if (maxNeighbor - minNeighbor > 40 && c > 100) {
        shadowEdgeCount++;
      }
    }
  }

  if (pixelCount === 0) return 0;

  const avgLap = totalLap / pixelCount;
  const shadowFrac = shadowEdgeCount / pixelCount;

  // Embossed cards: higher Laplacian + shadow contours
  const lapScore = Math.min(1, Math.max(0, (avgLap - 6) / 18));
  const shadowScore = Math.min(1, shadowFrac * 8);

  return Math.min(1, lapScore * 0.6 + shadowScore * 0.4);
}

// ─── Foil Reflectivity ──────────────────────────────────

export function detectFoilPresence(data: ImageData): number {
  const bright = analyzeBrightness(data, 200);
  const color = analyzeColor(data);

  const specularScore = Math.min(1, bright.brightFraction * 8);
  const varianceScore = Math.min(1, bright.stdLuminance / 55);
  const chromaticBonus = color.chromaticFraction > 0.1 ? 0.15 : 0;
  const multiHueBonus = color.isMultiHue ? 0.1 : 0;

  return Math.min(1, specularScore * 0.35 + varianceScore * 0.45 + chromaticBonus + multiHueBonus);
}

// ─── Metal Color Detection ──────────────────────────────

export type MetalColor = "none" | "silver" | "gold" | "rainbow";

export function classifyMetalColor(data: ImageData): { color: MetalColor; confidence: number } {
  const d = data.data;
  const total = data.width * data.height;
  let goldCount = 0, silverCount = 0;
  const rainbowHues = new Set<number>();
  let brightPixels = 0;

  const step = Math.max(1, Math.floor(total / 2000)) * 4;
  let sampleCount = 0;

  for (let i = 0; i < d.length; i += step) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const [h, s, l] = rgbToHsl(r, g, b);
    const lum = luminance(r, g, b);
    sampleCount++;

    if (lum < 100) continue;
    brightPixels++;

    // Gold: warm hue (18-58°), moderate+ saturation, bright
    if (h >= 18 && h <= 58 && s > 0.2 && l > 0.35) {
      goldCount++;
    }
    // Silver: low saturation, high brightness
    else if (s < 0.12 && l > 0.5) {
      silverCount++;
    }

    // Track hue diversity
    if (s > 0.18 && l > 0.25 && l < 0.88) {
      rainbowHues.add(Math.floor(h / 30));
    }
  }

  if (brightPixels < sampleCount * 0.08) {
    return { color: "none", confidence: 0.8 };
  }

  const goldFrac = goldCount / brightPixels;
  const silverFrac = silverCount / brightPixels;
  const hueSpread = rainbowHues.size;

  // Rainbow: 4+ distinct hue buckets
  if (hueSpread >= 4 && brightPixels > sampleCount * 0.15) {
    return { color: "rainbow", confidence: Math.min(1, hueSpread / 5) };
  }
  if (goldFrac > 0.2) {
    return { color: "gold", confidence: Math.min(1, goldFrac * 2.5) };
  }
  if (silverFrac > 0.25) {
    return { color: "silver", confidence: Math.min(1, silverFrac * 1.8) };
  }

  return { color: "none", confidence: 0.6 };
}
