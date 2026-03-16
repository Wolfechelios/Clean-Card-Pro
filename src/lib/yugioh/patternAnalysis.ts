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
  /** Fraction of pixels above brightness threshold */
  brightFraction: number;
  /** Average luminance 0-255 */
  avgLuminance: number;
  /** Max luminance */
  maxLuminance: number;
  /** Standard deviation of luminance */
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

// ─── Sparkle Density ────────────────────────────────────

/**
 * Measure sparkle density: ratio of very bright isolated pixels.
 * Sparkles are bright pixels (>threshold) surrounded by darker pixels,
 * indicating specular reflections from foil surface.
 */
export function sparkleDensity(data: ImageData, threshold = 230): number {
  const d = data.data;
  const w = data.width;
  const h = data.height;
  let sparkleCount = 0;
  const total = w * h;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      const l = luminance(d[idx], d[idx + 1], d[idx + 2]);
      if (l < threshold) continue;

      // Check if surrounding pixels are significantly darker (isolated bright point)
      let darkerNeighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const ni = ((y + dy) * w + (x + dx)) * 4;
          const nl = luminance(d[ni], d[ni + 1], d[ni + 2]);
          if (nl < l - 40) darkerNeighbors++;
        }
      }
      if (darkerNeighbors >= 4) sparkleCount++;
    }
  }

  return sparkleCount / total;
}

// ─── Color Variance (Rainbow / Hue Spread) ─────────────

export interface ColorStats {
  /** Average saturation 0-1 */
  avgSaturation: number;
  /** Hue standard deviation (degrees) — high = rainbow-like */
  hueSpread: number;
  /** Fraction of pixels with saturation > 0.3 (chromatic) */
  chromaticFraction: number;
  /** Whether multiple distinct hue clusters exist (rainbow indicator) */
  isMultiHue: boolean;
}

export function analyzeColor(data: ImageData): ColorStats {
  const d = data.data;
  const total = data.width * data.height;
  let satSum = 0;
  let chromaticCount = 0;
  const hueBuckets = new Float32Array(12); // 30° buckets

  // Collect stats from a sample for speed
  const step = Math.max(1, Math.floor(total / 2000)) * 4;

  let sampleCount = 0;
  for (let i = 0; i < d.length; i += step) {
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    if (l < 0.1 || l > 0.95) continue; // skip near-black/white
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

  // Count hue buckets with significant representation
  const bucketThreshold = chromaticCount * 0.08;
  let activeBuckets = 0;
  for (let b = 0; b < 12; b++) {
    if (hueBuckets[b] > bucketThreshold) activeBuckets++;
  }

  // Compute circular hue variance
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

// ─── Diagonal Line Detection ────────────────────────────

/**
 * Detect diagonal line patterns (Secret Rare signature).
 * Uses Sobel-like gradient computation and angle histogram.
 * Returns strength 0-1 of diagonal frequency at ~45° and ~135°.
 */
export function detectDiagonalLines(data: ImageData): number {
  const d = data.data;
  const w = data.width;
  const h = data.height;

  // Convert to grayscale
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    const pi = i * 4;
    gray[i] = luminance(d[pi], d[pi + 1], d[pi + 2]);
  }

  // Compute gradients and build angle histogram (8 bins of 22.5°)
  const angleBins = new Float32Array(8);
  let totalMag = 0;

  // Sample every other pixel for speed
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
      if (mag < 15) continue; // skip low-gradient areas

      totalMag += mag;
      // angle 0-180
      let angle = (Math.atan2(gy, gx) * 180) / Math.PI;
      if (angle < 0) angle += 180;
      const bin = Math.floor(angle / 22.5) % 8;
      angleBins[bin] += mag;
    }
  }

  if (totalMag < 1) return 0;

  // Diagonal bins: 45° = bin 2, 135° = bin 6
  const diagonalStrength = (angleBins[2] + angleBins[6]) / totalMag;
  // Horizontal/vertical bins for comparison
  const hvStrength = (angleBins[0] + angleBins[4]) / totalMag;

  // Strong diagonal = diagonals dominate over H/V
  return Math.min(1, Math.max(0, (diagonalStrength - hvStrength) * 3 + diagonalStrength));
}

// ─── Lattice / Grid Detection ───────────────────────────

/**
 * Detect repeating grid/lattice pattern (Collector's Rare signature).
 * Uses horizontal and vertical autocorrelation to find periodic peaks.
 */
export function detectLatticePattern(data: ImageData): number {
  const d = data.data;
  const w = data.width;
  const h = data.height;

  // Compute luminance row/column projections
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

  // Simple autocorrelation peak detection
  function autocorrelationPeaks(signal: Float32Array): number {
    const n = signal.length;
    if (n < 10) return 0;

    // Remove mean
    let mean = 0;
    for (let i = 0; i < n; i++) mean += signal[i];
    mean /= n;

    const centered = new Float32Array(n);
    let variance = 0;
    for (let i = 0; i < n; i++) {
      centered[i] = signal[i] - mean;
      variance += centered[i] * centered[i];
    }
    if (variance < 1) return 0;

    // Count peaks in autocorrelation for lags 3..n/3
    let peakCount = 0;
    const maxLag = Math.min(Math.floor(n / 3), 60);
    let prev = 0, prevPrev = 0;

    for (let lag = 2; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i < n - lag; i++) {
        corr += centered[i] * centered[i + lag];
      }
      corr /= variance;

      if (lag > 3 && prev > prevPrev && prev > corr && prev > 0.15) {
        peakCount++;
      }
      prevPrev = prev;
      prev = corr;
    }

    return Math.min(1, peakCount / 3); // normalize: 3+ peaks = strong lattice
  }

  const rowScore = autocorrelationPeaks(rowProj);
  const colScore = autocorrelationPeaks(colProj);

  // Both directions need periodicity for a true lattice
  return Math.min(1, (rowScore + colScore) / 1.5);
}

// ─── Ghost / Holographic Transparency Detection ────────

/**
 * Detect ghost rare characteristics: faded artwork with high reflectivity variance.
 * Ghost rares have very low saturation but periodic bright reflections.
 */
export function detectGhostPattern(data: ImageData): number {
  const d = data.data;
  const total = data.width * data.height;
  let lowSatCount = 0;
  let highLumVarIndicator = 0;
  const lumValues: number[] = [];

  const step = Math.max(1, Math.floor(total / 3000)) * 4;
  let sampleCount = 0;

  for (let i = 0; i < d.length; i += step) {
    const [, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    const lum = luminance(d[i], d[i + 1], d[i + 2]);
    sampleCount++;

    // Ghost rares are desaturated
    if (s < 0.15 && l > 0.3 && l < 0.9) lowSatCount++;
    lumValues.push(lum);
  }

  if (sampleCount === 0) return 0;

  const lowSatFrac = lowSatCount / sampleCount;

  // Check luminance bimodality (faded art + mirror reflections)
  let mean = 0;
  for (const l of lumValues) mean += l;
  mean /= lumValues.length;
  let variance = 0;
  for (const l of lumValues) variance += (l - mean) * (l - mean);
  variance /= lumValues.length;
  const cv = Math.sqrt(variance) / (mean || 1); // coefficient of variation

  // Ghost = very desaturated + moderate luminance variation
  const ghostScore = lowSatFrac * 0.6 + Math.min(cv, 0.5) * 0.8;
  return Math.min(1, Math.max(0, ghostScore));
}

// ─── Emboss / Raised Texture Detection ──────────────────

/**
 * Detect embossed texture (Ultimate Rare signature).
 * Embossed areas create localized high-frequency luminance variations.
 */
export function detectEmbossTexture(data: ImageData): number {
  const d = data.data;
  const w = data.width;
  const h = data.height;

  // Compute Laplacian magnitude as measure of local texture
  let totalLap = 0;
  let pixelCount = 0;

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
    }
  }

  if (pixelCount === 0) return 0;

  const avgLap = totalLap / pixelCount;
  // Embossed cards have higher Laplacian than flat prints (~15+ is embossed)
  return Math.min(1, Math.max(0, (avgLap - 8) / 20));
}

// ─── Foil Reflectivity (general foil vs no-foil) ────────

/**
 * Detect general foil presence in a zone.
 * Foil surfaces show higher brightness variance and specular highlights.
 */
export function detectFoilPresence(data: ImageData): number {
  const bright = analyzeBrightness(data, 200);
  const color = analyzeColor(data);

  // Foil indicators: bright specular highlights + some color spread
  const specularScore = Math.min(1, bright.brightFraction * 8);
  const varianceScore = Math.min(1, bright.stdLuminance / 60);
  const chromaticBonus = color.chromaticFraction > 0.1 ? 0.15 : 0;

  return Math.min(1, specularScore * 0.4 + varianceScore * 0.5 + chromaticBonus);
}

// ─── Metal Color Detection (gold/silver/rainbow name) ───

export type MetalColor = "none" | "silver" | "gold" | "rainbow";

/**
 * Classify the dominant metallic color of a zone.
 */
export function classifyMetalColor(data: ImageData): { color: MetalColor; confidence: number } {
  const d = data.data;
  const total = data.width * data.height;
  let goldCount = 0, silverCount = 0, rainbowHues = new Set<number>();
  let brightPixels = 0;

  const step = Math.max(1, Math.floor(total / 2000)) * 4;
  let sampleCount = 0;

  for (let i = 0; i < d.length; i += step) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const [h, s, l] = rgbToHsl(r, g, b);
    const lum = luminance(r, g, b);
    sampleCount++;

    if (lum < 120) continue; // skip dark pixels
    brightPixels++;

    // Gold: warm hue (20-55°), moderate-high saturation, bright
    if (h >= 20 && h <= 55 && s > 0.25 && l > 0.4) {
      goldCount++;
    }
    // Silver: low saturation, high brightness
    else if (s < 0.15 && l > 0.55) {
      silverCount++;
    }

    // Track hue diversity for rainbow detection
    if (s > 0.2 && l > 0.3 && l < 0.85) {
      rainbowHues.add(Math.floor(h / 30));
    }
  }

  if (brightPixels < sampleCount * 0.1) {
    return { color: "none", confidence: 0.8 };
  }

  const goldFrac = goldCount / brightPixels;
  const silverFrac = silverCount / brightPixels;
  const hueSpread = rainbowHues.size;

  // Rainbow: 4+ distinct hue buckets among bright pixels
  if (hueSpread >= 4 && brightPixels > sampleCount * 0.2) {
    return { color: "rainbow", confidence: Math.min(1, hueSpread / 6) };
  }
  if (goldFrac > 0.25) {
    return { color: "gold", confidence: Math.min(1, goldFrac * 2) };
  }
  if (silverFrac > 0.3) {
    return { color: "silver", confidence: Math.min(1, silverFrac * 1.5) };
  }

  return { color: "none", confidence: 0.6 };
}
